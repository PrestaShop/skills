# Running the browser

Nothing in this skill is pre-installed. Each run writes `run.js` and `scenario.js` into the run
directory — `~/prestashop-pr-qa/[owner]-[repo]-pr-[number]/`, outside the shop and outside every git
work tree — and executes them there. `run.js` is the same every time — copy it verbatim from
below. `scenario.js` is written fresh from the PR being tested.

## 1. Stand up Playwright without touching the project

Playwright goes in a throwaway lab, never in the shop or in the repository being tested. Try what
is already on the machine first: a launch probe is a better test than comparing browser revisions
by hand, because it fails for the real reason.

```bash
LAB="${TMPDIR:-/tmp}/ps-pr-qa-lab"

# Prefer a Playwright already present on the machine, with browsers that actually launch.
for CAND in "$LAB/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
  [ -d "$CAND/playwright" ] || continue
  if NODE_PATH="$CAND" node -e "require('playwright').chromium.launch().then(b=>b.close())" 2>/dev/null; then
    export NODE_PATH="$CAND"; break
  fi
done

# Nothing usable: install into the lab, and check the exit status of both commands.
if [ -z "$NODE_PATH" ]; then
  mkdir -p "$LAB"
  ( cd "$LAB" && npm init -y >/dev/null && npm i playwright --no-audit --no-fund ) \
    || { echo "playwright install failed"; exit 2; }
  ( cd "$LAB" && npx playwright install chromium ffmpeg ) \
    || { echo "browser install failed"; exit 2; }
  export NODE_PATH="$LAB/node_modules"
fi

node -e "console.log('playwright', require('playwright/package.json').version)"
```

Keep every `cd` inside a subshell — a bare `cd` would move the session out of the repository and
break the `git` and `gh` commands that follow.

Run headless. The bundled headless shell needs no download on a machine that has ever run
Playwright, and video recording works headless. `--headed` needs the full Chromium build, which is
often absent: if the user wants to watch, print `npx playwright install chromium` and let them
decide, rather than starting a download on their machine unannounced.

## 2. `run.js` — one phase, no verdict

This script records; it does not judge. It knows nothing about "approved". Copy it as is.

```js
// run.js — one QA phase. Records what happened; decides nothing.
// node run.js --scenario=./scenario.js --phase=before|after --out=. --url=<fo> [--bo-url=<bo>]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const SCENARIO = path.resolve(arg('scenario', './scenario.js'));
const PHASE = arg('phase');
const OUT = path.resolve(arg('out', '.'), PHASE);
const FO = (arg('url', '') || '').replace(/\/$/, '');
const BO = (arg('bo-url', '') || '').replace(/\/$/, '');
const VIEW = { width: 1280, height: 900 };
const HUD = '__qa_hud';
const FATAL = /Fatal error|Whoops, looks like something went wrong|Uncaught \w*Exception|Service Unavailable/i;

if (!PHASE || !FO) { console.error('--phase and --url are required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const rec = { preconditions: [], bugs: [], details: [], steps: [], smoke: [], consoleErrors: [], netErrors: [], harness: [], notes: [] };
let stepNo = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);

(async () => {
  const scenario = require(SCENARIO);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: OUT, size: VIEW }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push({ step: stepNo, text: m.text() }); });
  page.on('pageerror', (e) => rec.consoleErrors.push({ step: stepNo, text: `pageerror: ${e.message}` }));
  page.on('response', (r) => { if (r.status() >= 400) rec.netErrors.push({ step: stepNo, text: `${r.status()} ${r.url()}` }); });

  // Never a fixed delay in a scenario: this is the only place allowed to wait.
  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter((a) => a.playState === 'running').map((a) => a.finished.catch(() => {})))).catch(() => {});
  };
  const hudOn = (t) => page.evaluate(([id, text]) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#101418;color:#fff;'
        + 'font:14px/1.6 ui-monospace,monospace;padding:8px 14px;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
  }, [HUD, t]).catch(() => {});
  const hudOff = () => page.evaluate((id) => { const e = document.getElementById(id); if (e) e.remove(); }, HUD).catch(() => {});

  const put = (bucket, name, passed, detail, extra) => {
    bucket.push({ step: stepNo, name, passed: !!passed, detail: detail === undefined ? null : String(detail), ...extra });
    return !!passed;
  };
  const assert = {
    ok: (name, cond, detail) => put(rec.preconditions, name, cond, detail),
    detail: (name, cond, d) => put(rec.details, name, cond, d),
    // A bug assertion may be a function so a failure can be re-sampled: a flip is a flake,
    // not a reproduction. true means CORRECT behaviour was observed.
    bug: async (name, cond, detail) => {
      let pass = typeof cond === 'function' ? await cond() : cond;
      if (!pass && typeof cond === 'function') {
        await settle();
        if (await cond()) {
          rec.harness.push(`flaky bug assertion, ignored: ${name}`);
          return put(rec.bugs, name, false, detail, { flaky: true });
        }
      }
      return put(rec.bugs, name, pass, detail);
    },
  };
  // Every document navigation is preflighted automatically, whatever the scenario remembers to do:
  // a 404, a redirect to the login form or a fatal page still returns a document that assertions
  // would happily evaluate.
  // Smoke visits record their own results in rec.smoke; a smoke miss belongs in the regression net,
  // not in the preconditions, where it would void the verdict for the wrong reason.
  let inSmoke = false;
  const where = (u) => { try { return new URL(u).pathname; } catch (_) { return u; } };
  page.on('response', (r) => {
    if (inSmoke) return;
    const req = r.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame() && r.status() >= 400) {
      put(rec.preconditions, `navigation to ${where(r.url())} responded`, false, String(r.status()));
    }
  });
  page.on('load', async () => {
    if (inSmoke) return;
    const body = await page.content().catch(() => '');
    const hit = FATAL.exec(body);
    if (hit) put(rec.preconditions, `${where(page.url())} is not an error page`, false, hit[0]);
  });

  // A selector matching nothing makes every check pass. Count before you assert.
  const count = async (sel, o = {}) => {
    const min = o.min === undefined ? 1 : o.min;
    const max = o.max === undefined ? Infinity : o.max;
    const loc = page.locator(sel);
    const n = await loc.count();
    if (n < min || n > max) rec.harness.push(`selector matched ${n}, expected ${min}..${max === Infinity ? 'any' : max}: ${sel}`);
    return loc;
  };
  const note = (t) => { rec.notes.push(t); };

  const preflight = async (resp, label) => {
    const status = resp ? resp.status() : 0;
    assert.ok(`${label} responded`, status > 0 && status < 400, String(status || 'no response'));
    const body = await page.content();
    assert.ok(`${label} is not an error page`, !FATAL.test(body), FATAL.exec(body) ? FATAL.exec(body)[0] : 'clean');
  };

  const loginBO = async () => {
    if (!BO) { rec.harness.push('the scenario needs the back office but --bo-url was not given'); return; }
    const email = process.env.QA_BO_EMAIL;
    const pass = process.env.QA_BO_PASSWORD;
    if (!email || !pass) { rec.harness.push('QA_BO_EMAIL / QA_BO_PASSWORD are not set in the environment'); return; }
    const resp = await page.goto(BO, { waitUntil: 'domcontentloaded' });
    await settle();
    if (await page.locator('input[name="passwd"]').count() > 0) {
      // Fill and submit the real form: it carries a CSRF token, so a POST would be rejected.
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="passwd"]', pass);
      await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('#submit_login, button[type="submit"]')]);
      await settle();
    }
    await preflight(resp, 'back office');
    assert.ok('back office is logged in', (await page.locator('input[name="passwd"]').count()) === 0, page.url());
    assert.ok('back office token is valid', !/Invalid security token|Invalid token/i.test(await page.content()));
  };

  const step = async (name, fn) => {
    stepNo += 1;
    const n = String(stepNo).padStart(2, '0');
    const before = rec.consoleErrors.length + rec.netErrors.length;
    const t0 = Date.now();
    await hudOn(`${PHASE} · ${n} ${name}`);
    try {
      await fn();
      await settle();
    } catch (e) {
      rec.harness.push(`step ${n} "${name}" threw: ${e.message}`);
    }
    await hudOn(`${PHASE} · ${n} ${name}`);
    const shot = `${n}-${slug(name)}.png`;
    await hudOff();
    await page.screenshot({ path: path.join(OUT, shot), fullPage: false }).catch(() => {});
    await hudOn(`${PHASE} · ${n} ${name}`);
    rec.steps.push({ n, name, shot, ms: Date.now() - t0, newProblems: rec.consoleErrors.length + rec.netErrors.length - before });
  };

  // Fixed regression net. Not configurable: it is the floor under "we only tested the happy path".
  const smoke = async () => {
    inSmoke = true;
    const visit = async (label, target) => {
      const r = await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await settle();
      const status = r ? r.status() : 0;
      const clean = !FATAL.test(await page.content());
      rec.smoke.push({ label, url: target, status, ok: status > 0 && status < 400 && clean });
    };
    await visit('front page', FO + '/');
    const first = page.locator('a[href*="id_product"], .product-title a, .products a').first();
    if (await first.count() > 0) {
      const href = await first.getAttribute('href');
      if (href) await visit('product page', new URL(href, FO + '/').toString());
    }
    await visit('cart', FO + '/index.php?controller=cart&action=show');
    if (BO) await visit('back office', BO);
    inSmoke = false;
  };

  const startedAt = new Date().toISOString();
  await step('smoke: shop renders', smoke);
  // A scenario throwing between steps must not cost us the run: record it and carry on to the
  // teardown, so phase.json and the video always exist.
  try {
    await scenario.run({ page, context, phase: PHASE, url: FO, boUrl: BO, step, assert, count, settle, loginBO, note, preflight });
  } catch (e) {
    rec.harness.push(`scenario threw outside a step: ${e.message}`);
  }

  await page.waitForTimeout(800); // let the video end on a settled frame
  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs(path.join(OUT, 'video.webm')).catch((e) => rec.harness.push(`video: ${e.message}`));
    await video.delete().catch(() => {}); // saveAs copies: drop the auto-named original
  }
  await browser.close();

  const out = {
    phase: PHASE,
    scenarioName: scenario.name || null,
    kind: scenario.kind || null,
    where: scenario.where || 'fo',
    bug: scenario.bug || null,
    scenarioSha256: crypto.createHash('sha256').update(fs.readFileSync(SCENARIO)).digest('hex'),
    url: FO,
    boUrl: BO || null,
    playwright: require('playwright/package.json').version,
    viewport: VIEW,
    startedAt,
    finishedAt: new Date().toISOString(),
    video: 'video.webm',
    ...rec,
  };
  fs.writeFileSync(path.join(OUT, 'phase.json'), JSON.stringify(out, null, 2));
  const f = (a) => a.filter((x) => !x.passed).length;
  console.log(`${PHASE}: ${rec.steps.length} steps, preconditions ${f(rec.preconditions)} failed, `
    + `bug assertions ${f(rec.bugs)} failed, harness ${rec.harness.length}`);
  rec.harness.forEach((h) => console.log(`  harness: ${h}`));
  const preFailed = rec.preconditions.some((c) => !c.passed);
  process.exit(rec.harness.length || preFailed ? 2 : 0);
})().catch((e) => {
  // Even a runner that dies leaves a machine-readable record: the report reads phase.json.
  console.error('HARNESS ERROR', e);
  try {
    fs.writeFileSync(path.join(OUT, 'phase.json'), JSON.stringify(
      { phase: PHASE, url: FO, outcome: 'harness', ...rec, harness: [...rec.harness, `runner failed: ${e.message}`] }, null, 2));
  } catch (_) { /* nothing left to do */ }
  process.exit(2);
});
```

The exit code says nothing about the PR: `0` means the phase ran cleanly, `2` means the harness
could not produce trustworthy observations — a harness fault, or a failed precondition, which voids
the verdict just the same. Bug assertions failing in the `before` phase is the expected outcome, not
an error, and does not change the exit code.

Note what the script deliberately does **not** write into `phase.json`: its own argv. Credentials
reach it only through the environment, and the report is a file people paste into GitHub.

## 3. `scenario.js` — written fresh for each PR

```js
/**
 * QA scenario. The SAME file runs in both phases, unchanged — its hash is recorded in each
 * phase.json and a mismatch voids the verdict.
 *
 * Three rules, in order of importance:
 *  1. assert.bug() is the ONLY thing that can prove the bug. Write it in the reporter's words.
 *     Never name a class, id, attribute or file the PR ADDS: in the pre-fix state it is absent,
 *     the check fails, and you would report a reproduction you never made.
 *  2. assert.ok() is a precondition. It must hold in BOTH phases. If one fails, the environment
 *     is unusable and there is no verdict — not a failed PR.
 *  3. Never branch on `phase` for an assertion. Branch on it only to create data the pre-fix
 *     code cannot create on its own, and say so with note().
 *
 * Every selector goes through count(). No waitForTimeout: use settle().
 */
module.exports = {
  name: 'what the ticket says is wrong, one line',
  pr: 'owner/repo#0000',
  issue: 'owner/repo#0000 or null',
  kind: 'bugfix',          // 'bugfix' | 'feature'
  where: 'fo',             // 'fo' | 'bo' | 'both'
  bug: 'the user-visible symptom, in the reporter\'s words',

  async run({ page, phase, url, step, assert, count, settle, loginBO, note, preflight }) {
    // await step('log in to the back office', async () => { await loginBO(); });

    await step('open the page from the ticket', async () => {
      const resp = await page.goto(`${url}/<path from the ticket>`, { waitUntil: 'domcontentloaded' });
      await settle();
      await preflight(resp, 'the page from the ticket');
      await count('<a selector that exists in BOTH phases>', { min: 1 });
    });

    await step('<the action from the reproduction steps>', async () => {
      const target = await count('<selector present in both phases>', { min: 1 });
      await target.first().click();
      await settle();
    });

    await step('observe the symptom', async () => {
      const shown = (await page.locator('<selector present in both phases>').first().innerText()).trim();
      await assert.bug(
        '<the symptom, in the words of the ticket>',
        async () => shown === '<what a correct shop shows>',
        `observed "${shown}"`,
      );
      assert.detail('<markup the PR introduces — information only>',
        (await page.locator('<the new selector>').count()) === 1);
    });
  },
};
```

Run it once per phase, from the run directory (`cd "$RUN"`), so every relative path below stays
inside it:

```bash
node run.js --scenario=./scenario.js --phase=before --out=. --url="$FO_URL" --bo-url="$BO_URL"
node run.js --scenario=./scenario.js --phase=after  --out=. --url="$FO_URL" --bo-url="$BO_URL"
```

## 4. The tokens the diff adds

Used to catch a bug assertion that only restates the diff:

```bash
gh pr diff "$PR" --repo "$REPO" > env/diff.patch
grep '^+' env/diff.patch | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u > env/added
grep '^-' env/diff.patch | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u > env/removed
# Renamed things are fair game to mention, so subtract what the diff also removed.
# Then keep only code-shaped names — snake_case, kebab-case, camelCase, PascalCase — because
# plain English words the diff happens to add would otherwise flood the comparison.
comm -23 env/added env/removed | grep -E '_|-|[a-z][A-Z]|^[A-Z]' > env/diff-added-tokens.txt
```

Then check the scenario against it, looking only inside the bug assertions:

```bash
awk '/assert\.bug\(/,/\);/' scenario.js \
  | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u \
  | comm -12 - env/diff-added-tokens.txt
```

Any name printed has to be rewritten in user-visible terms before the run. Hits inside
`assert.detail` do not matter — that is what `detail` is for, which is why the check is scoped to
`assert.bug` blocks.

The grep is an aid, not the rule. A single lowercase word the PR introduces — a new class called
`hidden` — slips through it, and the rule still stands: a bug assertion says what the person who
filed the ticket would see.

## Checks that pass for the wrong reason

These are the ways a browser check reports success while proving nothing. Every one has been paid
for at least once.

Four of them the runner now guarantees, so they are listed only so you know they are handled and
do not need guarding again: a document navigation returning 400 or worse, or landing on a fatal
page, is recorded as a failed precondition whether or not the scenario calls `preflight`;
screenshots are taken after `settle()`; and the video is saved by name rather than by picking the
newest file in the directory.

The rest are yours. Nothing in the runner can prevent them, because they are choices made while
writing assertions:

- **A selector matching nothing makes every "is absent" check pass.** `count()` reports it, but only for selectors you actually pass through `count()`. A bare `page.locator()` is unguarded.
- **A diff-derived selector fakes a reproduction.** In the pre-fix state, markup the PR adds is missing; the check fails and looks exactly like the bug. Only user-visible symptoms prove a bug.
- **`element.focus()` proves nothing** about keyboard access. Walk `Tab` from the top and see where focus actually lands.
- **A focus ring read too early is not there yet.** Let transitions finish before measuring outline or box-shadow — `step()` settles at its end, which does not help you mid-step.
- **`event.defaultPrevented` does not prove handling** on a native control: the browser may have acted anyway.
- **An attribute without a visible effect is not a feature.** Assert the attribute *and* what the user sees — the attribute alone belongs in `assert.detail`.
- **Panel height is not visibility.** A drawer hidden by `transform` keeps its full height.
- **An element's own `display` says nothing about a hidden ancestor.** Ask the browser whether it is really visible.
- **Icon-font glyphs live in the Unicode private use area** and are not visible text: they will never match a text assertion.
- **Built assets and `vendor/` do not follow a git checkout.** For themes this is the norm rather than an edge case — see `prestashop.md`, "A theme's built assets do not follow a git checkout".
