#!/usr/bin/env bash
# Fast-forwards base branches of a fork to the upstream repository.
# Usage: sync-bases.sh [--upstream O/R] [--fork O/R] [--dry-run] [branch ...]
# Defaults: upstream PrestaShop/PrestaShop, fork <gh user>/<repo>, branches develop 9.2.x 8.2.x.
# Never forces: a diverged branch is reported, not overwritten.
set -euo pipefail

UPSTREAM=PrestaShop/PrestaShop
FORK=
DRY_RUN=0
BRANCHES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) UPSTREAM=$2; shift 2 ;;
    --fork) FORK=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) BRANCHES+=("$1"); shift ;;
  esac
done

[ -n "$FORK" ] || FORK="$(gh api user --jq .login)/${UPSTREAM#*/}"
if [ ${#BRANCHES[@]} -eq 0 ]; then
  if [ "$UPSTREAM" = PrestaShop/PrestaShop ]; then
    BRANCHES=(develop 9.2.x 8.2.x)
  else
    BRANCHES=("$(gh api "repos/$UPSTREAM" --jq .default_branch)")
  fi
fi

# Prints the field, or nothing on error (gh prints the error body on stdout).
api_get() { local out; out=$(gh api "$1" --jq "$2" 2>/dev/null) && echo "$out" || true; }

[ -n "$(api_get "repos/$FORK" .full_name)" ] || { echo "ERROR fork $FORK does not exist" >&2; exit 3; }

status=0
for b in "${BRANCHES[@]}"; do
  up_sha=$(api_get "repos/$UPSTREAM/branches/$b" .commit.sha)
  [ -n "$up_sha" ] || { echo "$b: SKIP not on $UPSTREAM"; continue; }
  fork_sha=$(api_get "repos/$FORK/branches/$b" .commit.sha)

  if [ -z "$fork_sha" ]; then
    echo "$b: MISSING on $FORK, creating at ${up_sha:0:10}"
    [ $DRY_RUN = 1 ] || gh api -X POST "repos/$FORK/git/refs" -f "ref=refs/heads/$b" -f "sha=$up_sha" --silent
    continue
  fi
  if [ "$fork_sha" = "$up_sha" ]; then
    echo "$b: UP TO DATE (${up_sha:0:10})"
    continue
  fi

  # base...head with head = upstream: "ahead" means the fork only lags behind.
  read -r st ahead behind < <(gh api "repos/$FORK/compare/$b...${UPSTREAM%%/*}:$b" --jq '"\(.status) \(.ahead_by) \(.behind_by)"')
  case "$st" in
    ahead)
      echo "$b: BEHIND by $ahead, fast-forwarding to ${up_sha:0:10}"
      [ $DRY_RUN = 1 ] || gh api -X PATCH "repos/$FORK/git/refs/heads/$b" -f "sha=$up_sha" -F force=false --silent
      ;;
    behind)
      echo "$b: AHEAD of upstream by $behind commit(s), left untouched"
      ;;
    *)
      echo "$b: DIVERGED ($behind own commit(s), $ahead missing), left untouched. Reset only with the owner's consent."
      status=4
      ;;
  esac
done
exit $status
