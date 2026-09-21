#!/bin/sh
# Finds or installs the browser tooling this skill drives, outside the shop and
# outside the theme folder, so a node_modules/ never ends up in a pull request.
#
#   NODE_PATH=$(sh playwright-lab.sh) || exit 1
#   export NODE_PATH
#
# Reasoning goes to stderr, the one result to stdout.
# Exit 0 ready, 2 could not get a working one.
set -u

say() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 2; }

LAB="${TMPDIR:-/tmp}/hummingbird-theme-qa-lab"

command -v node >/dev/null 2>&1 || die "node is not on PATH. If it comes from nvm or asdf, run this from a shell where 'node -v' works"
command -v npm  >/dev/null 2>&1 || die "npm is not on PATH. Same fix as for node"

# Launching Chromium proves Chromium is there. It does not prove ffmpeg is, and
# ffmpeg is what records the video a finding leans on. So the probe records one
# frame and checks a real file came out. Single-quoted below, so no single quote
# may appear inside it.
PROBE='
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-probe-"));
  const b = await chromium.launch();
  const c = await b.newContext({ recordVideo: { dir } });
  const p = await c.newPage();
  await p.goto("about:blank");
  await c.close();
  await b.close();
  const shot = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
  if (!shot.length || fs.statSync(path.join(dir, shot[0])).size === 0) {
    throw new Error("Chromium launched but nothing was recorded, so ffmpeg is missing");
  }
  require("axe-core");
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
'

works() {
  [ -d "$1/playwright" ] || return 1
  [ -d "$1/axe-core" ] || return 1
  NODE_PATH="$1" node -e "$PROBE" 2>/dev/null
}

for candidate in "$LAB/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
  [ -d "$candidate" ] || continue
  if works "$candidate"; then
    say "reusing the browser tooling already at $candidate"
    printf '%s\n' "$candidate"
    exit 0
  fi
done

say "installing the browser tooling into $LAB, outside the shop and outside the theme folder"
mkdir -p "$LAB" || die "cannot create $LAB"
cd "$LAB" || die "cannot enter $LAB"
[ -f package.json ] || npm init -y >/dev/null 2>&1 || die "npm init failed in $LAB"

npm i playwright axe-core --no-audit --no-fund >&2 || die "could not install playwright and axe-core"
npx playwright install chromium ffmpeg >&2 || die "could not install Chromium and ffmpeg"

# Two checklist points read as impossible without these, and both are a download
# away: the Safari row needs WebKit, which is the engine Safari ships, and the
# Lighthouse row needs Lighthouse. Neither is required to drive a pass, so a
# failure here is said out loud and the lab still works without them.
if [ "${QA_SKIP_EXTRAS:-0}" != "1" ]; then
  if npx playwright install webkit >&2; then
    say "WebKit installed: the Safari half of the matrix can be driven (iOS still needs the device)"
  else
    say "could not install WebKit, so the Safari row stays a question for a person"
  fi
  if npm i lighthouse --no-audit --no-fund >&2; then
    say "Lighthouse installed: its scores can be recorded, which is what the checklist asks (record, never fail on them)"
  else
    say "could not install Lighthouse, so its row stays a question for a person"
  fi
fi

if works "$LAB/node_modules"; then
  say "browser tooling ready"
  printf '%s\n' "$LAB/node_modules"
  exit 0
fi

NODE_PATH="$LAB/node_modules" node -e "$PROBE" >&2
die "the browser tooling installed but cannot launch Chromium and record a video"
