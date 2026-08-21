#!/bin/sh
# Find or build a working Playwright, without touching the shop or the repository under test.
#
#   NODE_PATH=$(playwright-lab.sh) || exit 1
#   export NODE_PATH
#
# Prints a directory to put on NODE_PATH on stdout; progress goes to stderr. Exit 2 if no working
# Playwright could be obtained. Playwright lives in a throwaway lab under $TMPDIR: installing it
# into the shop or the checkout would leave node_modules/ in a pull request.
set -u

say() { echo "$@" >&2; }
command -v node >/dev/null 2>&1 || { say "node is not on PATH — install Node.js first"; exit 2; }
command -v npm  >/dev/null 2>&1 || { say "npm is not on PATH — install Node.js first"; exit 2; }
LAB="${TMPDIR:-/tmp}/ps-pr-qa-lab"

# A launch probe, not a version comparison: browsers can be missing or stale, and only launching
# tells the truth. Try what the machine already has before downloading anything.
for CAND in "$LAB/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
  [ -d "$CAND/playwright" ] || continue
  if NODE_PATH="$CAND" node -e "require('playwright').chromium.launch().then(b=>b.close())" 2>/dev/null; then
    say "reusing the Playwright already installed in $CAND"
    echo "$CAND"; exit 0
  fi
done

say "installing Playwright into $LAB (nothing is written to the shop or the repository)"
mkdir -p "$LAB" || { say "cannot create $LAB"; exit 2; }
( cd "$LAB" && npm init -y >/dev/null && npm i playwright --no-audit --no-fund >&2 ) \
  || { say "playwright install failed"; exit 2; }
# ffmpeg is what records the video; chromium alone would give screenshots and no proof of the run.
( cd "$LAB" && npx playwright install chromium ffmpeg >&2 ) \
  || { say "browser install failed"; exit 2; }

NODE_PATH="$LAB/node_modules" node -e "require('playwright').chromium.launch().then(b=>b.close())" \
  || { say "Playwright installed but Chromium does not launch"; exit 2; }
echo "$LAB/node_modules"
