#!/bin/sh
# Pick the directory the QA evidence is written to, and refuse any directory that would leak it.
#
#   pick-run-dir.sh <front-office-url> <run-directory> [extra-served-directory ...]
#
# Prints the resolved run directory on stdout. Everything else goes to stderr, so callers can do:
#   RUN=$(pick-run-dir.sh "$FO" "$HOME/prestashop-pr-qa/owner-repo-pr-42") || exit 1
#
# Why this exists: a video of a back-office session must never land in the shop or in the checkout.
# Inside the checkout it gets committed into the pull request by accident. Inside a directory the
# web server serves — which includes a bind-mounted theme or module — it is downloadable by anyone.
# Exit 2 means "refused, do not write anything"; exit 64 means the arguments are wrong.
set -u

say() { echo "$@" >&2; }
die() { echo "refusing: $@" >&2; exit 2; }

[ $# -ge 2 ] || { say "usage: $0 <front-office-url> <run-directory> [extra-served-directory ...]"; exit 64; }
FO=$1; RUN=$2; shift 2

case "$FO$RUN" in *'['*) die "a placeholder was left unsubstituted in '$FO' or '$RUN'" ;; esac

# The URL names the port, the port is published by one container, and that container declares what
# it mounts. Nothing to ask the developer for as long as the shop runs in Docker.
HOSTPORT=$(printf '%s' "$FO" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')
case "$HOSTPORT" in
  *:*) PORT=${HOSTPORT##*:} ;;
  *)   case "$FO" in https://*) PORT=443 ;; *) PORT=80 ;; esac ;;
esac

CID=$(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null | grep -E ":$PORT->" | awk '{print $1}' | head -1)
CIDS=""
if [ -n "$CID" ]; then
  # The whole compose project, not just that container: nginx publishes the port while php-fpm and
  # the theme mount the code, and all of it is the same shop.
  PROJECT=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$CID" 2>/dev/null)
  if [ -n "$PROJECT" ]; then
    CIDS=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
  else
    CIDS=$CID
  fi
  say "port $PORT is served by $(docker inspect --format '{{.Name}}' "$CID" | sed 's#^/##')${PROJECT:+, compose project $PROJECT}"
elif [ $# -eq 0 ]; then
  # Not in Docker: nothing on this machine knows what the web server serves. This is the only case
  # that needs a question. Ask which directory is served and pass it as a third argument.
  die "nothing publishes port $PORT — ask which directory the web server serves, then pass it as an extra argument"
fi

# Every host directory the shop bind-mounts, the checkout this was invoked from, and anything the
# developer named. Not just the document root: a mounted theme or module is served too.
GUARDS=$(
  git rev-parse --show-toplevel 2>/dev/null
  printf '%s\n' "$@"
  [ -n "$CIDS" ] && docker inspect \
    --format '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}' $CIDS 2>/dev/null
)
GUARDS=$(printf '%s\n' "$GUARDS" | sed '/^$/d' | sort -u)
[ -n "$GUARDS" ] || die "no directory to guard was found — an empty list is never a pass"

# Resolve $RUN without creating it, so the decision happens before anything is written: walk up to
# the deepest ancestor that does exist, resolve that, then put the missing tail back.
LEAF=""; PROBE=$RUN
while [ ! -d "$PROBE" ]; do
  LEAF="$(basename "$PROBE")${LEAF:+/$LEAF}"; PROBE=$(dirname "$PROBE")
done
RUN_REAL="$(cd "$PROBE" && pwd -P)${LEAF:+/$LEAF}"

# Read the list from a file rather than a pipe: the loop must run in this shell for `exit` to stop
# the script, and a `case` pattern inside `$(...)` does not parse on the bash macOS still ships.
LIST="${TMPDIR:-/tmp}/qa-guards.$$"
printf '%s\n' "$GUARDS" > "$LIST"
say "keeping the evidence out of:"; sed 's/^/  /' "$LIST" >&2
while IFS= read -r G; do
  [ -d "$G" ] || continue
  case "$RUN_REAL/" in "$(cd "$G" && pwd -P)"/*)
    rm -f "$LIST"; die "$RUN_REAL is inside $G" ;;
  esac
done < "$LIST"

mkdir -p "$RUN_REAL/env" || die "cannot create $RUN_REAL"
mv "$LIST" "$RUN_REAL/env/guarded-paths.txt"
[ -f "$RUN_REAL/report.md" ] && say "note: reusing this run directory — a previous pass left report.md in it"

# Inside any other git work tree — a dotfiles repository, say — is untidy, not dangerous: warn.
TOP=$(git -C "$RUN_REAL" rev-parse --show-toplevel 2>/dev/null) &&
  say "note: inside the git work tree $TOP — keep it out of commits"

echo "$RUN_REAL"
