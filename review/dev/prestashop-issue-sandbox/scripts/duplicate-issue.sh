#!/usr/bin/env bash
# Duplicates an upstream issue onto a fork, so triage tools can work on the copy.
# Usage: duplicate-issue.sh <issue> [--fork O/R] [--suffix S] [--enable-issues] [--no-labels]
#                           [--reporter-comments] [--pin-before-fix] [--dry-run]
#   <issue>              https://github.com/O/R/issues/N, O/R#N, or N (PrestaShop/PrestaShop)
#   --fork               target repository, default <gh user>/<repo>
#   --suffix             extra copy of the same issue (stability runs)
#   --enable-issues      turn issues on for the fork when they are off (off by default on forks)
#   --no-labels          do not copy the upstream label set to the fork
#   --reporter-comments  append the reporter's comments posted before anyone else answered
#   --pin-before-fix     create sandbox-base/issue-N at the code state before the fix PR was merged
# The copy gets no label: upstream labels are the triage reference, printed in the JSON summary (last line).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ISSUE_ARG= FORK= SUFFIX= ENABLE=0 LABELS=1 REPORTER=0 PIN=0 DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fork) FORK=$2; shift 2 ;;
    --suffix) SUFFIX=$2; shift 2 ;;
    --enable-issues) ENABLE=1; shift ;;
    --no-labels) LABELS=0; shift ;;
    --reporter-comments) REPORTER=1; shift ;;
    --pin-before-fix) PIN=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) ISSUE_ARG=$1; shift ;;
  esac
done
[ -n "$ISSUE_ARG" ] || { sed -n '2,12p' "$0"; exit 1; }

if [[ $ISSUE_ARG =~ github\.com/([^/]+/[^/]+)/issues/([0-9]+) ]]; then UPSTREAM=${BASH_REMATCH[1]}; N=${BASH_REMATCH[2]}
elif [[ $ISSUE_ARG =~ ^([^/#]+/[^/#]+)#([0-9]+)$ ]]; then UPSTREAM=${BASH_REMATCH[1]}; N=${BASH_REMATCH[2]}
elif [[ $ISSUE_ARG =~ ^#?([0-9]+)$ ]]; then UPSTREAM=PrestaShop/PrestaShop; N=${BASH_REMATCH[1]}
else echo "ERROR cannot parse issue reference: $ISSUE_ARG" >&2; exit 1; fi

[ -n "$FORK" ] || FORK="$(gh api user --jq .login)/${UPSTREAM#*/}"
run() { if [ $DRY_RUN = 1 ]; then echo "DRY-RUN $*"; else "$@"; fi; }

# --- Upstream issue ----------------------------------------------------------
ISSUE_JSON=$(gh api "repos/$UPSTREAM/issues/$N")
iss() { jq -r "$1" <<<"$ISSUE_JSON"; }
[ "$(iss '.pull_request != null')" = false ] || { echo "ERROR $UPSTREAM#$N is a pull request, use prestashop-pr-sandbox" >&2; exit 1; }
TITLE=$(iss .title) AUTHOR=$(iss .user.login) STATE=$(iss '.state + (if .state_reason then " (" + .state_reason + ")" else "" end)')
UP_LABELS=$(iss '[.labels[].name]')

OWNER=${UPSTREAM%%/*} NAME=${UPSTREAM#*/}
FIX_PRS=$(gh api graphql -f query="{repository(owner:\"$OWNER\",name:\"$NAME\"){issue(number:$N){closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number merged baseRefName}}}}}" \
  --jq '[.data.repository.issue.closedByPullRequestsReferences.nodes[] | select(.merged)]')

echo "Upstream: $UPSTREAM#$N [$STATE] \"$TITLE\""
echo "  labels: $(jq -r 'join(", ") | if . == "" then "none" else . end' <<<"$UP_LABELS")"
echo "  merged fix PRs: $(jq -r 'map("#\(.number) on \(.baseRefName)") | join(", ") | if . == "" then "none" else . end' <<<"$FIX_PRS")"

# --- Fork --------------------------------------------------------------------
FORK_JSON=$(gh api "repos/$FORK" 2>/dev/null) || {
  echo "ERROR $FORK does not exist. Create it with: gh repo fork $UPSTREAM --clone=false" >&2; exit 3; }
echo "Fork: $FORK"

if [ "$(jq -r .has_issues <<<"$FORK_JSON")" != true ]; then
  if [ $ENABLE = 0 ]; then
    echo "ERROR issues are disabled on $FORK. Rerun with --enable-issues to turn them on." >&2; exit 7
  fi
  echo "  enabling issues"
  run gh repo edit "$FORK" --enable-issues >/dev/null
fi

# Labels the tool can choose from, not the ones of this issue.
if [ $LABELS = 1 ]; then
  up_count=$(gh label list -R "$UPSTREAM" --limit 1000 --json name --jq length)
  fork_count=$(gh label list -R "$FORK" --limit 1000 --json name --jq length 2>/dev/null || echo 0)
  if [ "$fork_count" -lt "$up_count" ]; then
    echo "  copying the upstream label set ($up_count labels, $fork_count on the fork)"
    run gh label clone "$UPSTREAM" -R "$FORK" >/dev/null
  fi
fi

# --- Base before the fix -----------------------------------------------------
PINNED=
FIX_COUNT=$(jq length <<<"$FIX_PRS")
if [ $PIN = 1 ]; then
  [ "$FIX_COUNT" -gt 0 ] || { echo "ERROR --pin-before-fix: no merged PR closes $UPSTREAM#$N" >&2; exit 8; }
  FIX_N=$(jq -r '.[0].number' <<<"$FIX_PRS")
  read -r base_sha head_sha < <(gh api "repos/$UPSTREAM/pulls/$FIX_N" --jq '"\(.base.sha) \(.head.sha)"')
  MERGE_BASE=$(gh api "repos/$UPSTREAM/compare/$base_sha...$head_sha" --jq .merge_base_commit.sha)
  PINNED="sandbox-base/issue-$N"
  current=$(gh api "repos/$FORK/git/ref/heads/$PINNED" --jq .object.sha 2>/dev/null) || current=
  if [ "$current" = "$MERGE_BASE" ]; then
    echo "  $PINNED already at ${MERGE_BASE:0:10}"
  elif [ -n "$current" ]; then
    echo "ERROR $FORK:$PINNED exists at ${current:0:10}, expected ${MERGE_BASE:0:10}" >&2; exit 5
  else
    echo "  creating $PINNED at ${MERGE_BASE:0:10} (before fix PR #$FIX_N)"
    run gh api -X POST "repos/$FORK/git/refs" -f "ref=refs/heads/$PINNED" -f "sha=$MERGE_BASE" --silent
  fi
elif [ "$FIX_COUNT" -gt 0 ]; then
  echo "WARNING the fork's base branches may already contain the fix: a tool asked to fix the issue could find" \
       "nothing to change. Use --pin-before-fix for a branch frozen before the fix."
fi

# --- Issue -------------------------------------------------------------------
MARKER="<!-- sandbox copy of $UPSTREAM issue $N${SUFFIX:+ copy $SUFFIX} -->"
EXISTING=$(gh issue list -R "$FORK" --state all --limit 1000 --json url,body 2>/dev/null \
  | jq -r --arg m "$MARKER" '[.[] | select(.body | contains($m))][0].url // empty' || true)

if [ -n "$EXISTING" ]; then
  FORK_ISSUE_URL=$EXISTING
  echo "Fork issue already exists: $FORK_ISSUE_URL"
else
  BODY_FILE=$(mktemp)
  {
    iss '.body // ""'
    if [ $REPORTER = 1 ]; then
      # Only what the reporter added before anyone answered: later comments carry the maintainers' triage.
      gh api "repos/$UPSTREAM/issues/$N/comments" --paginate --jq '.[]' | jq -rs --arg a "$AUTHOR" '
        (map(.user.login != $a) | index(true)) as $first_other
        | (if $first_other == null then . else .[:$first_other] end)
        | map("\n\n---\n**Additional information from the reporter:**\n\n" + .body) | join("")'
    fi
    printf '\n\n<!-- reported upstream by %s -->\n%s\n' "$AUTHOR" "$MARKER"
  } | python3 "$SCRIPT_DIR/defuse-body.py" "$UPSTREAM" >"$BODY_FILE"

  if [ $DRY_RUN = 1 ]; then
    echo "DRY-RUN gh issue create -R $FORK --title \"$TITLE\""
    echo "----- body -----"; command cat "$BODY_FILE"; echo "----------------"
    FORK_ISSUE_URL=
  else
    FORK_ISSUE_URL=$(gh issue create -R "$FORK" --title "$TITLE" --body-file "$BODY_FILE")
    echo "Fork issue created: $FORK_ISSUE_URL"
  fi
  command rm -f "$BODY_FILE"
fi

jq -cn --arg upstream "https://github.com/$UPSTREAM/issues/$N" --arg fork_issue "$FORK_ISSUE_URL" \
  --arg state "$STATE" --argjson labels "$UP_LABELS" --argjson fix_prs "$FIX_PRS" --arg pinned_base "$PINNED" \
  '{upstream:$upstream, fork_issue:$fork_issue, upstream_state:$state, upstream_labels:$labels,
    fix_prs:($fix_prs | map(.number)), pinned_base:$pinned_base}'
