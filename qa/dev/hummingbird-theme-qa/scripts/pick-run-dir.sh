#!/bin/sh
# Picks the campaign folder, and refuses one that would put the evidence
# somewhere it could be committed into a pull request or served over HTTP.
#
#   RUN=$(sh pick-run-dir.sh <shop-url|-> <campaign-dir> [served-dir ...]) || exit 1
#
# Reasoning goes to stderr, the one result to stdout, so the command substitution
# above captures a path and nothing else.
#
# Exit 0 chosen, 2 refused (write nothing), 64 wrong arguments.
set -u

say()  { printf '%s\n' "$*" >&2; }
die()  { printf 'refusing: %s\n' "$*" >&2; exit 2; }
usage() {
  say "usage: pick-run-dir.sh <shop-url|-> <campaign-dir> [served-dir ...]"
  say "  pass - as the URL when nothing is served over HTTP yet"
  exit 64
}

[ $# -ge 2 ] || usage
URL=$1
WANT=$2
shift 2

# ---------------------------------------------------------------- placeholders
#
# The campaign folder is built from three values, and an unset one does not fail:
# it creates a real directory called "undefined" and the campaign quietly writes
# into it. Catch that here, before anything is created.
case $WANT in
  '') die "the campaign folder is empty. A variable was not set" ;;
  *'['*) die "the campaign folder still holds a placeholder: $WANT" ;;
  *']'*) die "the campaign folder still holds a placeholder: $WANT" ;;
  *'$'*) die "the campaign folder holds an unexpanded variable: $WANT" ;;
esac
case $WANT in
  /*) ;;
  *) die "the campaign folder must be an absolute path: $WANT" ;;
esac
# $WANT starts with / already, so only a trailing / has to be added to make every
# segment sit between two slashes.
case $WANT/ in
  */undefined/*) die "the campaign folder has an 'undefined' segment, so a value was not set: $WANT" ;;
  */null/*)      die "the campaign folder has a 'null' segment, so a value was not set: $WANT" ;;
  *//*)          die "the campaign folder has an empty segment, so a value was not set: $WANT" ;;
esac

# ------------------------------------------------------------------- resolving
#
# Resolve without creating: walk up to the deepest folder that exists, resolve
# that, then put the missing tail back. A folder we cannot enter must not
# collapse the path to /.
resolve_unmade() {
  _tail=''
  _head=$1
  while [ ! -d "$_head" ] && [ "$_head" != '/' ] && [ -n "$_head" ]; do
    _tail=$(basename "$_head")${_tail:+/$_tail}
    _head=$(dirname "$_head")
  done
  [ -d "$_head" ] || { printf '%s\n' "$1"; return 0; }
  _real=$(cd "$_head" 2>/dev/null && pwd -P) || { printf '%s\n' "$1"; return 0; }
  printf '%s\n' "${_real%/}${_tail:+/$_tail}"
}

RUN=$(resolve_unmade "$WANT")

# --------------------------------------------------------------- what to guard
#
# Anything the evidence must stay out of: the checkout we were invoked from, the
# folders the running shop serves, and whatever the caller names.
GUARDS=$(mktemp "${TMPDIR:-/tmp}/hb-qa-guards.XXXXXX") || die "cannot create a temporary file"
trap 'rm -f "$GUARDS"' EXIT INT TERM

add_guard() {
  [ -n "${1:-}" ] || return 0
  [ -d "$1" ] || return 0
  _g=$(cd "$1" 2>/dev/null && pwd -P) || { say "note: cannot enter $1, not guarding it"; return 0; }
  printf '%s\n' "$_g" >> "$GUARDS"
}

if TOP=$(git rev-parse --show-toplevel 2>/dev/null); then
  add_guard "$TOP"
  say "guarding the checkout we were run from: $TOP"
fi

for extra in "$@"; do
  add_guard "$extra"
  say "guarding the folder you named: $extra"
done

# The shop's own folders, found through Docker: whatever container publishes the
# shop's port, then every host folder that project mounts. A theme mounted into
# the container is exactly the folder the evidence must not land in.
if [ "$URL" != '-' ] && [ -n "$URL" ]; then
  # The campaign folder gets a full placeholder check above, and the URL deserves
  # the same one: a URL nobody filled in reads as a real address, the
  # port falls back to 80, and whatever else on this machine answers on 80 has
  # its folders guarded instead of the shop's.
  case $URL in
    *' '*|*'<'*|*'>'*|*'$'*)
      die "the shop URL still holds a placeholder or an unexpanded variable: $URL" ;;
    *://undefined*|*://null*)
      die "the shop URL points at '$URL', so a value was never set" ;;
    *://) die "the shop URL has no host: $URL" ;;
  esac
  # Brackets alone cannot tell "[::1]" from "[front office URL]", but what sits
  # between them can: an IPv6 literal is hex digits and colons and nothing else.
  case $URL in
    *'['*)
      INSIDE=${URL#*[}
      INSIDE=${INSIDE%%]*}
      case $INSIDE in
        '') die "the shop URL has empty brackets: $URL" ;;
        *[!0-9A-Fa-f:]*) die "the shop URL still holds a placeholder: $URL" ;;
      esac
      ;;
    *']'*) die "the shop URL still holds a placeholder: $URL" ;;
  esac
  HOSTPORT=${URL#*://}
  HOSTPORT=${HOSTPORT%%/*}
  # An IPv6 host is full of colons, so "does it have a colon" cannot find the
  # port. Take the brackets off first: what is left after them is the port, or
  # nothing at all and the scheme decides.
  case $HOSTPORT in
    '['*)
      AFTER=${HOSTPORT##*]}
      case $AFTER in
        :*) PORT=${AFTER#:} ;;
        *)  case $URL in https://*) PORT=443 ;; *) PORT=80 ;; esac ;;
      esac
      ;;
    *:*) PORT=${HOSTPORT##*:} ;;
    *) case $URL in https://*) PORT=443 ;; *) PORT=80 ;; esac ;;
  esac
  case $PORT in
    ''|*[!0-9]*) die "cannot read a port from the shop URL: $URL" ;;
  esac

  if command -v docker >/dev/null 2>&1; then
    CID=$(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null | grep ":$PORT->" | awk '{print $1; exit}')
    if [ -n "${CID:-}" ]; then
      PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CID" 2>/dev/null)
      if [ -n "${PROJECT:-}" ]; then
        say "port $PORT is served by the compose project '$PROJECT'"
        for c in $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null); do
          docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}' "$c" 2>/dev/null
        done | while read -r src; do
          [ -n "$src" ] || continue
          printf '%s\n' "$src"
        done >> "$GUARDS.raw" 2>/dev/null || true
        if [ -f "$GUARDS.raw" ]; then
          while read -r src; do add_guard "$src"; done < "$GUARDS.raw"
          rm -f "$GUARDS.raw"
        fi
      else
        say "note: the container on port $PORT is not part of a compose project"
        for src in $(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}' "$CID" 2>/dev/null); do
          add_guard "$src"
        done
      fi
    else
      if [ $# -eq 0 ]; then
        say "nothing on this machine publishes port $PORT, so the folders the shop"
        say "serves cannot be discovered."
        die "tell me which folder the web server serves, as a third argument"
      fi
      say "note: nothing publishes port $PORT, relying on the folders you named"
    fi
  else
    if [ $# -eq 0 ]; then
      say "Docker is not available, so the folders the shop serves cannot be discovered."
      die "tell me which folder the web server serves, as a third argument"
    fi
    say "note: no Docker here, relying on the folders you named"
  fi
fi

sort -u "$GUARDS" -o "$GUARDS"
[ -s "$GUARDS" ] || die "no folder to guard was found, so nothing could be checked"

# ---------------------------------------------------------------- the decision
while read -r guard; do
  [ -n "$guard" ] || continue
  case "$RUN/" in
    "$guard"/*) die "$RUN is inside $guard, where the evidence could be committed or served. Pick a folder outside it, under \$HOME for instance" ;;
  esac
done < "$GUARDS"

mkdir -p "$RUN" || die "cannot create $RUN"
cp "$GUARDS" "$RUN/guarded-folders.txt"

[ -f "$RUN/report.html" ] && say "note: this campaign folder already holds a report, so this is a repeat run"

say "campaign folder: $RUN"
printf '%s\n' "$RUN"
