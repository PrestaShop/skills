// run.js — one QA phase. Records what happened; decides nothing.
// node <skill>/scripts/run.js --scenario=./scenario.js --phase=before|after --out=. --url=<fo> [--bo-url=<bo>]
//
// This file is the judge of a QA run: it decides what counts as a precondition, a bug assertion or
// a harness fault. It is shipped, not retyped, and it is never edited for a run — scenario.js is
// the per-PR part. Its own hash goes into phase.json so a verdict can be traced to the exact
// program that produced it, and so two phases judged by different programs cannot be compared.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const RUNNER_SHA = sha256(__filename);

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
    // A bug assertion may be a function, so a failure is re-sampled after settling rather than
    // trusted at once. true means CORRECT behaviour was observed. `detail` may be a function too,
    // so the report quotes the reading the verdict rests on and not an earlier one.
    //
    // What a flip means depends on the phase, and the two are not the same finding:
    //   before — the symptom showed, then cleared. That is an INTERMITTENT reproduction: it was
    //            observed, so it stays a reproduction, flagged for the report to say intermittent.
    //   after  — the fix is in place and the first read was simply too early. The settled reading
    //            is the one that counts, so the phase passes.
    // Neither is a harness fault. A flake is reported, never fatal: voiding a verdict because one
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
