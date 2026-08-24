// run.js: one QA phase, observed in a browser. Records what happened; decides nothing.
// node <skill>/scripts/run.js --scenario=./scenario.js --phase=before|after --out=. --url=<fo> [--bo-url=<bo>]
//
// This is one of three probes. record.js holds everything they share: what counts as a precondition,
// what can prove a bug, what a flake means in each phase, and what phase.json looks like. This file
// only knows how to look at an environment through Chromium, driven by Playwright.
//
// It is shipped, not retyped, and never edited for a run. scenario.js is the per-PR part. Both
// hashes go into phase.json, so a verdict can be traced to the exact code that produced it and two
// phases judged by different programs cannot be compared.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { commonArgs, startPhase, slug } = require('./record.js');

const USAGE = 'usage: --phase=before|after --url=<front office> [--bo-url=<back office>] [--scenario=./scenario.js] [--out=.]';
const { phase: PHASE, scenarioPath: SCENARIO, out: OUT, arg } = commonArgs(USAGE);
const FO = (arg('url', '') || '').replace(/\/$/, '');
const BO = (arg('bo-url', '') || '').replace(/\/$/, '');
if (!FO) { console.error(USAGE); process.exit(2); }

// playwright is required once the arguments have been validated: a typo should print one usage line,
// not a forty-line module stack trace from a dependency.
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


let R = null;   // hoisted so the crash handler below can still write phase.json
(async () => {
  const scenario = require(SCENARIO);
  const VIEW = VIEWS[scenario.viewport] || VIEWS.desktop;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: OUT, size: VIEW }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // 15s per action: a cold PrestaShop page with an empty Symfony cache regularly takes over 5s, and
  // a timeout here is recorded as a harness error, so being generous costs nothing but time.
  page.setDefaultTimeout(15000);

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

  // The browser probe hands the core three things: how to wait, how to end a step, and the fields
  // only it can fill in. Everything else about recording is the core's business.
  R = startPhase({
    phase: PHASE, out: OUT, scenarioPath: SCENARIO,
    probe: {
      name: 'browser',
      runnerFile: __filename,
      settle,
      // The HUD labels the step in the video, but it must not appear in the screenshot: it is
      // fixed to the bottom of the viewport and would paint over the page. Down for the capture,
      // back up straight after so the recording keeps its caption.
      capture: async (n, name) => {
        const shot = `${n}-${slug(name)}.png`;
        await hudOff();
        await page.screenshot({ path: path.join(OUT, shot), fullPage: false }).catch(() => {});
        await hudOn(`${PHASE} \u00b7 ${n} ${name}`);
        return shot;
      },
      meta: async () => ({
        url: FO, boUrl: BO || null, viewport: VIEW, video: 'video.webm',
        playwright: require('playwright/package.json').version,
      }),
    },
  });
  const { rec, state, assert, step, note } = R;
  const put = R.put;

  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push({ step: state.stepNo, text: m.text() }); });
  page.on('pageerror', (e) => rec.consoleErrors.push({ step: state.stepNo, text: `pageerror: ${e.message}` }));
  page.on('response', (r) => { if (r.status() >= 400) rec.netErrors.push({ step: state.stepNo, text: `${r.status()} ${r.url()}` }); });

  // Every document navigation is preflighted automatically, whatever the scenario remembers to do:
  // a 404, a redirect to the login form or a fatal page still returns a document that assertions
  // would happily evaluate.
  // Smoke visits record their own results in rec.smoke; a smoke miss belongs in the regression net,
  // not in the preconditions, where it would void the verdict for the wrong reason.
  // True while the regression net is running, the smoke pass and the narrow viewports both. Its
  // findings belong in rec.smoke and rec.responsive, where they are attributed by comparing the two
  // phases. Letting them reach the preconditions instead would void the verdict over a page the
  // ticket never mentioned.
  let inRegressionNet = false;
  const where = (u) => { try { return new URL(u).pathname; } catch (_) { return u; } };
  page.on('response', (r) => {
    if (inRegressionNet) return;
    const req = r.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame() && r.status() >= 400) {
      put(rec.preconditions, `navigation to ${where(r.url())} responded`, false, String(r.status()));
    }
  });
  // Which front-office pages the scenario actually opened. The responsive net re-visits them, so it
  // checks the pages this PR is about instead of a fixed list that may miss them entirely.
  const visited = [];
  page.on('load', async () => {
    if (inRegressionNet) return;
    const u = page.url();
    // The back office sits under the front-office URL (…/admin-dev), so `startsWith(FO)` alone would
    // send the responsive net to admin pages, where the URL carries a per-session token and a
    // re-visit lands on the login form.
    if (u.startsWith(FO) && (!BO || !u.startsWith(BO)) && !visited.includes(u) && visited.length < 8) visited.push(u);
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

  // The part of the page that changed is what a reader looks at; the rest is context. A scenario
  // marks that region once and the runner clips it, at full size, in BOTH phases, so the report
  // leads with the pair instead of two full pages where nothing is legible.
  // Named clip(), not focus(): `element.focus()` already means something else in a browser, and a
  // scenario author reading both in one file would have to guess which is which.
  // The selector must exist in both phases, like a bug assertion: name the container, never the
  // markup the PR adds. A miss is a note, never a harness error, because voiding a verdict over a
  // missing screenshot would be worse than the missing screenshot.
  const clip = async (sel, label) => {
    const loc = page.locator(sel).first();
    if (!(await loc.count().catch(() => 0))) { note(`clip: nothing matches ${sel}`); return; }
    // Scroll first, then read the box. boundingBox() is viewport-relative and does not scroll, so a
    // symptom below the fold yields a y beyond the viewport and the screenshot is rejected outright
    // with "clipped area is either empty or outside the resulting image", and the lead evidence of the
    // report would vanish into a note for every long page.
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await settle();
    const box = await loc.boundingBox().catch(() => null);
    if (!box) { note(`clip: ${sel} matched but has no box`); return; }
    const pad = 24;   // a region read with no margin is hard to place on the page
    const top = Math.max(0, box.y - pad);
    const left = Math.max(0, box.x - pad);
    const area = {
      x: left, y: top,
      width: Math.min(VIEW.width - left, box.width + pad * 2),
      height: Math.min(VIEW.height - top, box.height + pad * 2),
    };
    const shot = `clip-${String(state.stepNo).padStart(2, '0')}-${slug(label || sel)}.png`;
    // The HUD is fixed to the bottom of the viewport: without taking it down first it paints over
    // any region low on the screen, in the one screenshot the report leads with. It is not raised
    // again here because capture() does it at the end of this same step.
    await hudOff();
    await page.screenshot({ path: path.join(OUT, shot), clip: area })
      .then(() => rec.clips.push({ step: state.stepNo, label: label || sel, selector: sel, shot }))
      .catch((e) => note(`clip: ${e.message}`));
  };
  // Fixed regression net. Not configurable: it is the floor under "we only tested the happy path".
  const smoke = async () => {
    inRegressionNet = true;
    try { await smokeBody(); } finally { inRegressionNet = false; }
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
  // design good?". Three binary facts per page and width: the page responds, it renders something,
  // it does not scroll sideways, so the net never produces a finding a human has to dismiss.
  // It runs in BOTH phases, which is what lets the report tell a regression this PR introduced from
  // a page that was already broken before it.
  // Screenshots are taken either way: they are the evidence for everything a machine cannot judge.
  const responsive = async () => {
    inRegressionNet = true;
    try { await responsiveBody(); } finally { inRegressionNet = false; await page.setViewportSize(VIEW); }
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
          // so `body { display: none }` would otherwise read as full of text. No height threshold:
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
  await step('smoke: shop renders', smoke);
  // A scenario throwing between steps must not cost us the run: record it and carry on to the
  // teardown, so phase.json and the video always exist.
  try {
    await scenario.run({ page, context, phase: PHASE, url: FO, boUrl: BO, step, assert, count, settle, loginBO, note, preflight, clip });
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

  await R.finish(scenario);
})().catch((e) => {
  // A runner that dies still owes a record. report.js reads phase.json, and a missing file is
  // indistinguishable from a phase nobody ran, so die() writes what it has and exits 2. Before
  // startPhase there is nothing to write with, hence the guard.
  if (R) R.die(e);
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
