#!/usr/bin/env bash
# Duplicates an upstream pull request onto a fork, so review tools can run on the copy.
# Usage: duplicate-pr.sh <pr> [--fork O/R] [--suffix S] [--pin-base] [--no-sync] [--repo-dir DIR] [--dry-run]
#   <pr>          https://github.com/O/R/pull/N, O/R#N, or N (PrestaShop/PrestaShop)
#   --fork        target repository, default <gh user>/<repo>
#   --suffix      extra copy of the same PR (stability runs): branch sandbox/pr-N-S
#   --pin-base    target a branch frozen at the PR's merge base instead of the live base branch
#   --no-sync     do not fast-forward the fork's base branch first
#   --repo-dir    local clone used to push when the API cannot create the branch
# Last stdout line is a JSON summary.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PR_ARG= FORK= SUFFIX= PIN=0 SYNC=1 REPO_DIR= DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fork) FORK=$2; shift 2 ;;
    --suffix) SUFFIX=$2; shift 2 ;;
    --pin-base) PIN=1; shift ;;
    --no-sync) SYNC=0; shift ;;
    --repo-dir) REPO_DIR=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) PR_ARG=$1; shift ;;
  esac
done
[ -n "$PR_ARG" ] || { sed -n '2,10p' "$0"; exit 1; }

if [[ $PR_ARG =~ github\.com/([^/]+/[^/]+)/pull/([0-9]+) ]]; then UPSTREAM=${BASH_REMATCH[1]}; N=${BASH_REMATCH[2]}
elif [[ $PR_ARG =~ ^([^/#]+/[^/#]+)#([0-9]+)$ ]]; then UPSTREAM=${BASH_REMATCH[1]}; N=${BASH_REMATCH[2]}
elif [[ $PR_ARG =~ ^#?([0-9]+)$ ]]; then UPSTREAM=PrestaShop/PrestaShop; N=${BASH_REMATCH[1]}
else echo "ERROR cannot parse PR reference: $PR_ARG" >&2; exit 1; fi

[ -n "$FORK" ] || FORK="$(gh api user --jq .login)/${UPSTREAM#*/}"
run() { if [ $DRY_RUN = 1 ]; then echo "DRY-RUN $*"; else "$@"; fi; }

# --- Upstream PR ---------------------------------------------------------------
PR_JSON=$(gh api "repos/$UPSTREAM/pulls/$N")
pr() { jq -r "$1" <<<"$PR_JSON"; }
TITLE=$(pr .title) BASE=$(pr .base.ref) BASE_SHA=$(pr .base.sha) HEAD_SHA=$(pr .head.sha)
STATE=$(pr 'if .merged then "merged" else .state end') AUTHOR=$(pr .user.login)
UP_FILES=$(pr .changed_files) UP_ADD=$(pr .additions) UP_DEL=$(pr .deletions)
MERGE_BASE=$(gh api "repos/$UPSTREAM/compare/$BASE_SHA...$HEAD_SHA" --jq .merge_base_commit.sha)

echo "Upstream: $UPSTREAM#$N [$STATE] \"$TITLE\""
echo "  base $BASE, head ${HEAD_SHA:0:10}, merge base ${MERGE_BASE:0:10}, $UP_FILES files +$UP_ADD -$UP_DEL"

# --- Fork --------------------------------------------------------------------
FORK_JSON=$(gh api "repos/$FORK" 2>/dev/null) || {
  echo "ERROR $FORK does not exist. Create it with: gh repo fork $UPSTREAM --clone=false" >&2; exit 3; }
FORK_SOURCE=$(jq -r '.source.full_name // .full_name' <<<"$FORK_JSON")
SAME_NETWORK=0; [ "$FORK_SOURCE" = "$UPSTREAM" ] && SAME_NETWORK=1
echo "Fork: $FORK (network of $FORK_SOURCE)"

# gh prints the error body on stdout, hence the explicit status check.
ref_sha() { local out; out=$(gh api "repos/$FORK/git/ref/heads/$1" --jq .object.sha 2>/dev/null) && echo "$out" || true; }

# Creates or checks branch $1 at $2 on the fork. API first (objects shared in the fork network), git push otherwise.
put_branch() {
  local branch=$1 sha=$2 fetch_ref=$3 current
  current=$(ref_sha "$branch")
  if [ "$current" = "$sha" ]; then echo "  $branch already at ${sha:0:10}"; return; fi
  if [ -n "$current" ]; then
    echo "ERROR $FORK:$branch exists at ${current:0:10}, expected ${sha:0:10}. Delete it or use --suffix." >&2; exit 5
  fi
  echo "  creating $branch at ${sha:0:10}"
  [ $DRY_RUN = 1 ] && return
  if [ $SAME_NETWORK = 1 ] && gh api -X POST "repos/$FORK/git/refs" -f "ref=refs/heads/$branch" -f "sha=$sha" --silent 2>/dev/null; then
    return
  fi
  echo "  API could not create the ref, pushing with git"
  local dir=$REPO_DIR
  if [ -z "$dir" ]; then
    dir=$(mktemp -d)/repo
    git clone -q --bare --filter=blob:none --no-tags "https://github.com/$UPSTREAM.git" "$dir"
  fi
  git -C "$dir" fetch -q --no-tags "https://github.com/$UPSTREAM.git" "$fetch_ref"
  git -C "$dir" push -q "https://github.com/$FORK.git" "$sha:refs/heads/$branch"
}

# --- Base branch -------------------------------------------------------------
if [ $PIN = 1 ]; then
  TARGET_BASE="sandbox-base/pr-$N"
  put_branch "$TARGET_BASE" "$MERGE_BASE" "$MERGE_BASE"
else
  TARGET_BASE=$BASE
  if [ $SYNC = 1 ]; then
    sync_out=$("$SCRIPT_DIR/sync-bases.sh" --upstream "$UPSTREAM" --fork "$FORK" $([ $DRY_RUN = 1 ] && echo --dry-run) "$BASE") || {
      echo "$sync_out"; echo "ERROR could not sync $FORK:$BASE. Use --pin-base, or --no-sync to keep it as is." >&2; exit 4; }
    echo "  $sync_out"
  fi
fi

# --- Head branch -------------------------------------------------------------
HEAD_BRANCH="sandbox/pr-$N${SUFFIX:+-$SUFFIX}"
put_branch "$HEAD_BRANCH" "$HEAD_SHA" "pull/$N/head"

# A merged PR (merge commit) is already in the live base: the copy would be empty.
if [ $PIN = 0 ] && [ $DRY_RUN = 0 ]; then
  st=$(gh api "repos/$FORK/compare/$TARGET_BASE...$HEAD_BRANCH" --jq .status)
  if [ "$st" = behind ] || [ "$st" = identical ]; then
    echo "ERROR $FORK:$TARGET_BASE already contains the PR (status $st). Rerun with --pin-base." >&2; exit 6
  fi
fi

# --- Pull request ------------------------------------------------------------
EXISTING=$(gh pr list -R "$FORK" --head "$HEAD_BRANCH" --state all --json url --jq '.[0].url // empty')
if [ -n "$EXISTING" ]; then
  FORK_PR_URL=$EXISTING
  echo "Fork PR already exists: $FORK_PR_URL"
else
  BODY_FILE=$(mktemp)
  pr '.body // ""' | python3 "$SCRIPT_DIR/defuse-body.py" "$UPSTREAM" >"$BODY_FILE"
  printf '\n\n<!-- sandbox copy of %s PR %s by %s, head %s, merge base %s -->\n' \
    "$UPSTREAM" "$N" "$AUTHOR" "$HEAD_SHA" "$MERGE_BASE" >>"$BODY_FILE"
  if [ $DRY_RUN = 1 ]; then
    echo "DRY-RUN gh pr create -R $FORK --base $TARGET_BASE --head $HEAD_BRANCH --title \"$TITLE\""
    echo "----- body -----"; command cat "$BODY_FILE"; echo "----------------"
    FORK_PR_URL=
  else
    FORK_PR_URL=$(gh pr create -R "$FORK" --base "$TARGET_BASE" --head "$HEAD_BRANCH" --title "$TITLE" --body-file "$BODY_FILE")
    echo "Fork PR created: $FORK_PR_URL"
  fi
  command rm -f "$BODY_FILE"
fi

# --- Check the copy shows the same diff ----------------------------------------
DIFF_MATCH=null
if [ -n "$FORK_PR_URL" ]; then
  M=${FORK_PR_URL##*/}
  for _ in 1 2 3 4 5 6; do
    stats=$(gh api "repos/$FORK/pulls/$M" --jq '"\(.changed_files) \(.additions) \(.deletions)"')
    [ "$stats" != "0 0 0" ] && break; sleep 5
  done
  if [ "$stats" = "$UP_FILES $UP_ADD $UP_DEL" ]; then DIFF_MATCH=true; echo "Diff matches upstream ($stats)."
  else DIFF_MATCH=false; echo "WARNING diff differs: upstream $UP_FILES $UP_ADD $UP_DEL, fork $stats (files additions deletions)."; fi
fi

jq -cn --arg upstream "https://github.com/$UPSTREAM/pull/$N" --arg fork_pr "$FORK_PR_URL" \
  --arg base "$TARGET_BASE" --arg head "$HEAD_BRANCH" --arg head_sha "$HEAD_SHA" \
  --arg merge_base "$MERGE_BASE" --arg state "$STATE" --argjson diff_match "$DIFF_MATCH" \
  '{upstream:$upstream, fork_pr:$fork_pr, base:$base, head:$head, head_sha:$head_sha, merge_base:$merge_base, upstream_state:$state, diff_match:$diff_match}'
