// run.js — one QA phase. Records what happened; decides nothing.
// node <skill>/scripts/run.js --scenario=./scenario.js --phase=before|after --out=. --url=<fo> [--bo-url=<bo>]
//
// This file is the judge of a QA run: it decides what counts as a precondition, a bug assertion or
// a harness error. It is shipped, not retyped, and it is never edited for a run — scenario.js is
// the per-PR part. Its own hash goes into phase.json so a verdict can be traced to the exact
// program that produced it, and so two phases judged by different programs cannot be compared.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// playwright is required further down, once the arguments have been validated: a typo should print
// one usage line, not a forty-line module stack trace from a dependency.

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const RUNNER_SHA = sha256(__filename);

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const SCENARIO = path.resolve(arg('scenario', './scenario.js'));
const PHASE = arg('phase');
const FO = (arg('url', '') || '').replace(/\/$/, '');
const BO = (arg('bo-url', '') || '').replace(/\/$/, '');

// Validate before anything uses these. PHASE is checked against the two names it may take, not just
// for being present: `--phase=Before` would otherwise flow through to the flake rule below, where
// "is this the before phase" decides whether an intermittent symptom counts as a reproduction — a
// one-character typo would silently invert a verdict.
if (!PHASE || !FO) { console.error('usage: --phase=before|after --url=<front office> [--bo-url=<back office>] [--scenario=./scenario.js] [--out=.]'); process.exit(2); }
if (PHASE !== 'before' && PHASE !== 'after') { console.error(`--phase must be "before" or "after", got "${PHASE}"`); process.exit(2); }
const OUT = path.resolve(arg('out', '.'), PHASE);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright is not reachable. Run scripts/playwright-lab.sh and export the NODE_PATH it prints.');
  process.exit(2);
}
// Viewports. Desktop is the default: it is wide enough for the back-office layout, which collapses
// its columns below 1200px and would change what a scenario can see. A scenario whose ticket is
// about mobile sets `viewport: 'mobile'` so the bug is measured where it was reported.
// The two responsive widths are fixed, never derived from the PR, so both phases stay comparable:
//   375 is the reference phone width (iPhone SE/12/13/14 and most Android in CSS pixels), so it is
//       the width a merchant's customers actually browse at;
//   768 is Bootstrap's `md` boundary, which PrestaShop themes are built on, so a layout that
//       breaks exactly at the switch shows up there and nowhere else.
const VIEWS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
};
const RESPONSIVE = ['mobile', 'tablet'];
const HUD = '__qa_hud';
const FATAL = /Fatal error|Whoops, looks like something went wrong|Uncaught \w*Exception|Service Unavailable/i;

// Empty the phase directory rather than trusting whoever called us to have done it: a leftover
// screenshot from an earlier pass would be cited as this run's evidence, and the report cannot tell
// the two apart. The runner owns its own output.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const rec = { preconditions: [], bugs: [], details: [], steps: [], smoke: [], responsive: [], consoleErrors: [], netErrors: [], harness: [], notes: [] };
let stepNo = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);

(async () => {
  const scenario = require(SCENARIO);
  const VIEW = VIEWS[scenario.viewport] || VIEWS.desktop;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: OUT, size: VIEW }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // 15s per action: a cold PrestaShop page with an empty Symfony cache regularly takes over 5s,
  // and a timeout here is recorded as a harness error, so being generous costs nothing but time.
  page.setDefaultTimeout(15000);
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push({ step: stepNo, text: m.text() }); });
  page.on('pageerror', (e) => rec.consoleErrors.push({ step: stepNo, text: `pageerror: ${e.message}` }));
  page.on('response', (r) => { if (r.status() >= 400) rec.netErrors.push({ step: stepNo, text: `${r.status()} ${r.url()}` }); });

  // Never a fixed delay in a scenario: this is the only place allowed to wait.
  const settle = async () => {
    // networkidle can never arrive on a page that polls, so it is capped and the failure ignored:
    // the two animation frames below are what actually guarantee a settled frame to measure.
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
    // A bug assertion may be a function, so a failure is re-sampled after settling rather than
    // trusted at once. true means CORRECT behaviour was observed. `detail` may be a function too,
    // so the report quotes the reading the verdict rests on and not an earlier one.
    //
    // What a flip means depends on the phase, and the two are not the same finding:
    //   before — the symptom showed, then cleared. That is an INTERMITTENT reproduction: it was
    //            observed, so it stays a reproduction, flagged for the report to say intermittent.
    //   after  — the fix is in place and the first read was simply too early. The settled reading
    //            is the one that counts, so the phase passes.
    // Neither is a harness error. A flake is reported, never fatal: voiding a verdict because one
    // page was slow throws away a run that was valid, and calling it "ignored" while killing the
    // run was the worst of both.
    bug: async (name, cond, detail) => {
      const said = async () => (typeof detail === 'function' ? await detail() : detail);
      const pass = typeof cond === 'function' ? await cond() : cond;
      if (pass || typeof cond !== 'function') return put(rec.bugs, name, pass, await said());
      await settle();
      if (!(await cond())) return put(rec.bugs, name, false, await said());
      const intermittent = PHASE === 'before';
      rec.notes.push(intermittent
        ? `intermittent in before — the symptom appeared, then cleared on re-sample; kept as a reproduction: ${name}`
        : `flake in after — correct behaviour on re-sample; the settled reading counts: ${name}`);
      return put(rec.bugs, name, !intermittent, await said(), { flaky: true, intermittent });
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
  // Which front-office pages the scenario actually opened. The responsive net re-visits them, so it
  // checks the pages this PR is about instead of a fixed list that may miss them entirely.
  const visited = [];
  page.on('load', async () => {
    if (inSmoke) return;
    const u = page.url();
    if (u.startsWith(FO) && !visited.includes(u) && visited.length < 8) visited.push(u);
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
    let resp = await page.goto(BO, { waitUntil: 'domcontentloaded' });
    await settle();
    await preflight(resp, 'back office');
    if (await page.locator('input[name="passwd"]').count() > 0) {
      // Fill and submit the real form: it carries a CSRF token, so a POST would be rejected.
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="passwd"]', pass);
      // `.first()` on purpose: the login page also renders the hidden password-reset form, whose
      // submit button matches the same generic selector, and a locator resolving to two elements
      // fails outright. Scoped to the login form first, generic only as a fallback.
      const submit = page.locator('#submit_login, form#login_form button[type="submit"], form[name="login"] button[type="submit"]').first();
      // Wait for the navigation the click starts. `waitForLoadState` would return at once, because
      // the login page has already reached that state, and the assertions below would then read the
      // pre-login document and record a failed precondition on an environment that was fine.
      const [nav] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
        submit.click(),
      ]);
      // The real post-condition: the password field is gone. Cheap, and true on every version.
      await page.locator('input[name="passwd"]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await settle();
      if (nav) { resp = nav; await preflight(nav, 'back office login'); }
    }
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
    try { await smokeBody(); } finally { inSmoke = false; }
  };
  const smokeBody = async () => {
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
  };

  // Responsive net. Deliberately basic: it answers "does the shop still work narrow?", not "is the
  // design good?". Three binary facts per page and width — the page responds, it renders something,
  // it does not scroll sideways — so the net never produces a finding a human has to dismiss.
  // It runs in BOTH phases, which is what lets the report tell a regression this PR introduced from
  // a page that was already broken before it.
  // Screenshots are taken either way: they are the evidence for everything a machine cannot judge.
  const responsive = async () => {
    inSmoke = true;                       // findings belong in the net, never in the preconditions
    try { await responsiveBody(); } finally { inSmoke = false; await page.setViewportSize(VIEW); }
  };
  const responsiveBody = async () => {
    const targets = [FO + '/', ...visited.filter((u) => u !== FO + '/')].slice(0, 3);
    for (const name of RESPONSIVE) {
      await page.setViewportSize(VIEWS[name]);
      for (const target of targets) {
        const r = await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await settle();
        const fatal = FATAL.test(await page.content().catch(() => ''));
        const m = await page.evaluate(() => {
          // Does anything actually show? A media query that hides the layout at one width leaves a
          // document that responds 200 and shows nothing. Check that `body` is really rendered
          // FIRST: innerText falls back to textContent on an element that is not being rendered,
          // so `body { display: none }` would otherwise read as full of text. No height threshold —
          // a legitimately short page is not a bug. 20 characters is below any real shop page and
          // above the stray label an emptied layout leaves behind.
          const shown = !!document.body && document.body.getClientRects().length > 0
            && getComputedStyle(document.body).display !== 'none';
          const rendered = shown && (document.body.innerText || '').trim().length > 20;
          // clientWidth, not innerWidth: innerWidth includes a classic scrollbar where the browser
          // renders one, which would hide an overflow smaller than the scrollbar. Same measure as
          // the layout, so the comparison is exact.
          const vw = document.documentElement.clientWidth;
          const over = Math.round(document.documentElement.scrollWidth - vw);
          if (over <= 1) return { over: 0, worst: [], rendered };
          // Advisory only: name a few visible boxes that stick out, to save the developer the hunt.
          // `position: fixed` is skipped because a fixed element cannot create document overflow,
          // so an off-canvas menu parked to the right is not what made the page scroll.
          const worst = [...document.querySelectorAll('body *')].filter((el) => {
            const st = getComputedStyle(el);
            if (st.position === 'fixed' || st.visibility === 'hidden' || st.display === 'none') return false;
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && b.right > vw + 1;
          }).slice(0, 3).map((el) => {
            const cls = typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
            return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
          });
          return { over, worst, rendered };
        }).catch(() => ({ over: 0, worst: [], rendered: false }));
        // The pathname alone collides: with friendly URLs off every page is /index.php, so two
        // targets would write the same file and the report would show one page as evidence for two.
        // Four hex characters of the full URL are enough to keep them apart and still readable.
        const tag = target === FO + '/' ? 'home'
          : `${slug(where(target)) || 'page'}-${crypto.createHash('sha256').update(target).digest('hex').slice(0, 4)}`;
        const shot = `${name}-${tag}.png`;
        await page.screenshot({ path: path.join(OUT, shot), fullPage: false }).catch(() => {});
        const status = r ? r.status() : 0;
        rec.responsive.push({
          viewport: name, size: `${VIEWS[name].width}x${VIEWS[name].height}`, url: target,
          status, responds: status > 0 && status < 400 && !fatal, rendered: m.rendered,
          overflowPx: m.over, worst: m.worst, shot,
          ok: status > 0 && status < 400 && !fatal && m.rendered && m.over === 0,
        });
      }
    }
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

  await step('responsive: 375 and 768 wide', responsive);

  // Playwright's video encoder trails the page by a few frames; without this the recording can end
  // mid-transition. The video ends on the responsive pass, which is deliberate: the reviewer sees
  // the narrow layouts being visited rather than having to trust the screenshots alone.
  await page.waitForTimeout(800);
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
    scenarioSha256: sha256(SCENARIO),
    runner: __filename,
    runnerSha256: RUNNER_SHA,
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
      { phase: PHASE, url: FO, outcome: 'harness', runner: __filename, runnerSha256: RUNNER_SHA,
        ...rec, harness: [...rec.harness, `runner failed: ${e.message}`] }, null, 2));
  } catch (_) { /* nothing left to do */ }
  process.exit(2);
});
