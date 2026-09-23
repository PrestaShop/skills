#!/usr/bin/env node
'use strict';
//
// Runs one section of the checklist in a real browser.
//
//   NODE_PATH=$(sh playwright-lab.sh) node run-suite.js \
//     --suite=./suite.js --out=<campaign>/suites/<id> --label=pass \
//     --url=<front office> [--bo-url=<back office>] \
//     --profile=b2c --viewport=desktop
//
// Nothing about the shop is assumed: every address comes from an argument, and
// back-office credentials come from QA_BO_EMAIL and QA_BO_PASSWORD in the
// environment, never from an argument, because arguments end up in the report.
//
// Exit 0 the run can be trusted, 2 it cannot, 64 wrong arguments.

const fs = require('fs');
const path = require('path');
const { startSuite, arg, sha256File, slug } = require('./record.js');

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
};
const FATAL = /Fatal error|Whoops, looks like something went wrong|Uncaught \w*(Exception|Error)|Service Unavailable|Internal Server Error/i;
const HUD = '__hbqa_hud';

function usage(why) {
  if (why) console.error(why);
  console.error('usage: run-suite.js --suite=<file> --out=<dir> --label=<pass|triage-REF>');
  console.error('       --url=<front office> [--bo-url=<back office>] --profile=<name> --viewport=<desktop|mobile|tablet>');
  console.error('       [--only=3.2/07,3.2/12] answer only these points, for comparing against an older theme version');
  process.exit(64);
}

const suitePath = arg('suite') && path.resolve(arg('suite'));
const outRoot = arg('out') && path.resolve(arg('out'));
const label = arg('label', 'pass');
const url = (arg('url') || '').replace(/\/+$/, '');
const boUrl = (arg('bo-url') || '').replace(/\/+$/, '') || null;
const only = (arg('only') || '').split(',').map((x) => x.trim()).filter(Boolean);
const profile = arg('profile', 'b2c');
const viewportName = arg('viewport', 'desktop');

if (!suitePath || !fs.existsSync(suitePath)) usage(`no suite file at ${arg('suite')}`);
if (!outRoot) usage('--out is required: the folder this section writes into');
if (!url) usage('--url is required: the front office address, which is never guessed');
if (!VIEWPORTS[viewportName]) usage(`--viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);
if (!/^(pass|triage-.+)$/.test(label)) usage('--label must be "pass" or "triage-<ref>"');

let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('playwright is not reachable. Run scripts/playwright-lab.sh and export the NODE_PATH it prints');
  process.exit(2);
}

const suite = require(suitePath);
const view = VIEWPORTS[viewportName];
const out = path.join(outRoot, label, `${profile}-${viewportName}`);
// One recording folder per run, not one per section: two matrix cells running at
// the same time would otherwise write into the same place.
const videoTmp = path.join(outRoot, `.video-${label}-${profile}-${viewportName}`);

(async () => {
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({
    viewport: view,
    recordVideo: { dir: videoTmp, size: view },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const probe = {
    name: 'browser',
    runnerFile: __filename,
    settle,
    // Nothing is caught here on purpose: record.js turns a capture that fails
    // into a fault on the run, naming why, rather than a run that carries on
    // with nothing to show.
    capture: async (n, name) => {
      const file = `${n}-${slug(name)}.png`;
      await hudOff();
      await page.screenshot({ path: path.join(out, file) });
      return file;
    },
    meta: () => ({
      url, boUrl,
      viewportSize: view,
      playwright: require('playwright/package.json').version,
      axeCore: safeVersion('axe-core'),
    }),
  };

  const S = startSuite({
    suite: suite.section || path.basename(suitePath),
    section: suite.section || null,
    out, label, profile, viewport: viewportName,
    checklist: arg('checklist-sha'),
    only,
    probe,
  });
  if (only.length) console.error(`answering only ${only.join(', ')}, the rest of this suite still runs to get there`);
  S.state.suiteSha256 = sha256File(suitePath);

  // Everything the page reports, whether the suite looked or not.
  page.on('console', (m) => { if (m.type() === 'error') S.rec.consoleErrors.push({ text: m.text().slice(0, 400), step: S.state.stepNo }); });
  page.on('pageerror', (e) => S.rec.consoleErrors.push({ text: String(e.message).slice(0, 400), step: S.state.stepNo }));
  page.on('response', (r) => {
    if (r.status() >= 400) S.rec.netErrors.push({ status: r.status(), url: r.url().slice(0, 300), step: S.state.stepNo });
  });

  function safeVersion(mod) {
    try { return require(`${mod}/package.json`).version; } catch { return null; }
  }

  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Fonts change widths, so anything measured before they land is measured on
    // a page that no longer exists.
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))).catch(() => {});
  }

  async function hudOn(text) {
    await page.evaluate(([id, t]) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111;color:#fff;font:14px system-ui;padding:6px 10px;pointer-events:none';
        document.documentElement.appendChild(el);
      }
      el.textContent = t;
    }, [HUD, text]).catch(() => {});
  }
  const hudOff = () => page.evaluate((id) => { const e = document.getElementById(id); if (e) e.remove(); }, HUD).catch(() => {});

  // -------------------------------------------------------------- what a suite gets
  //
  // Everything here either answers a checklist point outright, or measures
  // something and hands it to a person. Nothing pretends to the first when it is
  // the second.

  async function open(target, item = null) {
    const dest = /^https?:\/\//.test(target) ? target : `${url}${target.startsWith('/') ? '' : '/'}${target}`;
    let resp = null;
    try {
      resp = await page.goto(dest, { waitUntil: 'domcontentloaded' });
    } catch (e) {
      if (item) S.observe(item, 'inconclusive', { reason: `the page never answered: ${String(e.message).slice(0, 120)}` });
      return null;
    }
    await settle();
    const status = resp ? resp.status() : 0;
    const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : '').catch(() => '');
    const fatal = FATAL.test(body);
    if (item) {
      if (status >= 400 || fatal) {
        S.observe(item, 'fail', {
          assertion: 'the page answers and is not an error page',
          detail: fatal ? `it answered ${status} and shows an error page` : `it answered ${status}`,
        });
      } else {
        S.observe(item, 'pass', { assertion: `the page answered ${status} and is not an error page` });
      }
    }
    return { status, fatal, body };
  }

  // Really visible: it has a box on the page and no ancestor hides it. An
  // element's own display says nothing about a hidden parent, and a panel kept
  // off-screen by a transform keeps its full height.
  const isVisible = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hiddenAncestor = (() => {
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
      }
      return false;
    })();
    return { found: true, w: r.width, h: r.height, hiddenAncestor, display: cs.display };
  }, selector);

  async function see(item, selector, what) {
    const v = await isVisible(selector);
    if (!v.found) return S.observe(item, 'fail', { assertion: `${what} is on the page`, detail: `nothing matches ${selector}` });
    const visible = v.w > 0 && v.h > 0 && !v.hiddenAncestor;
    return S.observe(item, visible ? 'pass' : 'fail', {
      assertion: `${what} is on the page and really visible`,
      detail: visible ? `${Math.round(v.w)}x${Math.round(v.h)}` : v.hiddenAncestor ? 'hidden by a parent' : 'has no size',
    });
  }

  // A selector matching nothing makes every "is absent" check pass, so a zero
  // match is a fault in the run, not a quiet success.
  async function count(item, selector, { min = 1, max = Infinity } = {}) {
    const n = await page.locator(selector).count();
    if (n === 0 && min > 0) {
      S.observe(item, 'inconclusive', { reason: `nothing matches ${selector}, so nothing was actually checked` });
      return n;
    }
    const ok = n >= min && n <= max;
    S.observe(item, ok ? 'pass' : 'fail', {
      assertion: `${selector} matches ${min}${max === Infinity ? ' or more' : ` to ${max}`}`,
      detail: `found ${n}`,
    });
    return n;
  }

  // A module that renders nothing is two different situations wearing the same
  // face: it has no content configured, which the checklist explicitly asks to
  // test, or its hook is not firing, which is a defect. The page cannot tell
  // them apart, so it reports what it can see and hands the choice over.
  async function moduleRenders(item, moduleName, selector, where) {
    const assets = await page.evaluate((name) => {
      const hit = (u) => u && u.includes(`/${name}/`);
      const css = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => hit(l.href));
      const js = [...document.querySelectorAll('script[src]')].some((sc) => hit(sc.src));
      return { css, js };
    }, moduleName);
    const nodes = await page.locator(selector).count();
    const visible = nodes ? await isVisible(selector) : { found: false };
    const shows = nodes > 0 && visible.found && visible.w > 0 && visible.h > 0 && !visible.hiddenAncestor;

    if (shows) {
      return S.observe(item, 'pass', {
        assertion: `${moduleName} renders ${where} and is really visible`,
        detail: `${nodes} node(s) matching ${selector}`,
      });
    }
    if (assets.css || assets.js) {
      return S.observe(item, 'needs-human', {
        measurement: { assetsLoaded: assets, nodesFound: nodes },
        detail: `${moduleName} is installed here, its ${[assets.css && 'stylesheet', assets.js && 'script'].filter(Boolean).join(' and ')} loads, and it renders nothing ${where}`,
        reason: 'either it has nothing configured to show, which the checklist asks to test, or its hook is not firing. Read its configuration to tell which',
        evidence: [await snap(`${moduleName}-${slug(where)}`)],
      });
    }
    // A node that exists but cannot be seen is a different situation from a node
    // that was never rendered, and saying "no markup" for both sends the reader
    // hunting a dead hook when the truth is a closed drawer or a collapsed
    // accordion. On a narrow screen that is where half the header lives.
    if (nodes > 0) {
      return S.observe(item, 'needs-human', {
        measurement: { nodesFound: nodes, visible, assetsLoaded: assets },
        detail: `${moduleName} rendered ${nodes} node(s) matching ${selector} ${where}, but none of them is really visible`
          + `${visible.hiddenAncestor ? ': an ancestor is hiding it, which on a narrow screen usually means a drawer or an accordion that is still closed' : ''}`,
        reason: 'the module did render, so this is not a dead hook. Open whatever is covering it, which is itself the check the checklist asks for on a narrow screen, or say why it should be visible as it stands',
        evidence: [await snap(`${moduleName}-${slug(where)}`)],
      });
    }

    return S.observe(item, 'fail', {
      assertion: `${moduleName} is on this page`,
      detail: `nothing matches ${selector} ${where}, and neither its stylesheet nor its script is loaded, so it is not hooked here at all`,
      evidence: [await snap(`${moduleName}-${slug(where)}`)],
    });
  }

  async function noPageErrors(item) {
    const consoleN = S.rec.consoleErrors.length;
    const netN = S.rec.netErrors.length;
    const assets = S.rec.netErrors.filter((e) => /\.(css|js|woff2?|png|jpe?g|svg|webp|gif)(\?|$)/i.test(e.url));
    return S.observe(item, consoleN + netN === 0 ? 'pass' : 'fail', {
      assertion: 'nothing broke in the console and nothing the page asked for was missing',
      detail: consoleN + netN === 0 ? 'clean' : `${consoleN} console error(s), ${netN} failed request(s), ${assets.length} of them images, styles or scripts`,
      measurement: { consoleErrors: consoleN, failedRequests: netN, failedAssets: assets.length },
    });
  }

  // ------------------------------------------------------------------ measured, not judged

  async function overflow(item, where) {
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const over = Math.max(0, Math.round(d.scrollWidth - d.clientWidth));
      const worst = [];
      if (over > 0) {
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          // A fixed element cannot make the document scroll, so an off-canvas
          // menu parked to the right is never the culprit.
          if (cs.position === 'fixed' || cs.display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const past = Math.round(r.right - d.clientWidth);
          if (past > 1) worst.push({ past, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60) });
        }
        worst.sort((a, b) => b.past - a.past);
      }
      return { over, worst: worst.slice(0, 3), viewport: d.clientWidth };
    });
    const shot = await snap(`overflow-${slug(where)}`);
    // Nothing past the edge is not ambiguous. The reason this measurement is
    // handed to a person is that a fixed panel parked off-screen reads the same
    // as a real overflow -- and that only arises once something IS past the
    // edge. A reading of zero has nothing in it to mistake, so it is settled.
    if (m.over === 0) {
      return S.observe(item, 'pass', {
        assertion: `nothing overflows the viewport sideways at ${m.viewport} wide`,
        measurement: m,
        evidence: [shot],
        detail: `the document is exactly as wide as the ${m.viewport}px viewport, so no element is past the edge and there is nothing to tell a real overflow from a parked panel`,
      });
    }
    return S.observe(item, 'needs-human', {
      assertion: null,
      measurement: m,
      evidence: [shot],
      detail: `${m.over}px past the edge at ${m.viewport} wide, worst: ${m.worst.map((w) => `${w.tag}.${w.cls}`).join(', ')}`,
      reason: 'a fixed menu or a slider gives the same number as a real overflow, so a person decides',
    });
  }

  async function contrast(item, where) {
    const axe = await runAxe(['color-contrast']);
    if (!axe) return S.observe(item, 'inconclusive', { reason: 'the accessibility checker could not run on this page' });
    const shot = await snap(`contrast-${slug(where)}`);
    const violations = axe.violations.reduce((n, v) => n + v.nodes.length, 0);
    const cannotTell = axe.incomplete.reduce((n, v) => n + v.nodes.length, 0);
    if (violations > 0) {
      return S.observe(item, 'fail', {
        assertion: 'text has enough contrast against its background',
        detail: `${violations} place(s) below the threshold`,
        measurement: { violations, cannotTell }, evidence: [shot],
      });
    }
    return S.observe(item, 'needs-human', {
      measurement: { violations: 0, cannotTell },
      evidence: [shot],
      detail: cannotTell
        ? `nothing failed outright, but ${cannotTell} place(s) could not be judged: text over an image, a gradient or a see-through layer`
        : 'nothing failed outright, and nothing was left undecided',
      reason: 'the checker only judges plain text on a plain background, and hover, focus and disabled states were not visited',
    });
  }

  // outline: none is normal in a theme; the ring is drawn with a shadow, a border
  // or a pseudo-element. So look at the pixels rather than at one property.
  async function focusRing(item, selector, what) {
    const el = page.locator(selector).first();
    if (!(await el.count())) return S.observe(item, 'inconclusive', { reason: `nothing matches ${selector}` });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const before = await el.screenshot().catch(() => null);
    await el.focus().catch(() => {});
    await settle();
    const after = await el.screenshot().catch(() => null);
    if (!before || !after) return S.observe(item, 'inconclusive', { reason: 'could not photograph the control' });
    const changed = Buffer.compare(before, after) !== 0;
    const shot = await snap(`focus-${slug(what)}`);
    return S.observe(item, 'needs-human', {
      measurement: { somethingChanged: changed },
      evidence: [shot],
      detail: changed ? `${what} looks different when it takes focus` : `${what} looks identical when it takes focus`,
      reason: 'whether the change is strong enough to see is a judgement, and a control keyboard focus never reaches is a separate question',
    });
  }

  // Compare against the pixels the screen actually has, not against CSS width,
  // or every image on a high-density screen reads as stretched.
  async function imageScale(item, where) {
    const m = await page.evaluate(() => {
      const dpr = window.devicePixelRatio || 1;
      const rows = [];
      for (const img of document.querySelectorAll('img')) {
        if (!img.complete || !img.naturalWidth) continue;         // not loaded yet, or an SVG
        const r = img.getBoundingClientRect();
        if (r.width === 0) continue;
        const needed = r.width * dpr;
        rows.push({ src: img.currentSrc.split('/').pop().slice(0, 50), ratio: +(needed / img.naturalWidth).toFixed(2) });
      }
      rows.sort((a, b) => b.ratio - a.ratio);
      return { dpr, worst: rows.slice(0, 5), counted: rows.length };
    });
    const shot = await snap(`images-${slug(where)}`);
    const stretched = m.worst.filter((w) => w.ratio > 1.15);
    // Same reasoning as overflow(): the judgement this asks for is whether a
    // picture stretched a little still looks right, and that question only
    // exists once one has been stretched. Nothing over the threshold settles it.
    if (!stretched.length) {
      return S.observe(item, 'pass', {
        assertion: `every loaded image has at least as many pixels as the size it is drawn at, measured against a device pixel ratio of ${m.dpr}`,
        measurement: m,
        evidence: [shot],
        detail: `all ${m.counted} images are within the 1.15x threshold, so none is being upscaled and there is no stretch to judge`,
      });
    }
    return S.observe(item, 'needs-human', {
      measurement: m, evidence: [shot],
      detail: `${stretched.length} of ${m.counted} images are asked for more pixels than they have, worst ${stretched[0].ratio}x`,
      reason: 'a picture asked to grow slightly can still look right, and the browser may have picked a source for another screen',
    });
  }

  async function accessibility(item, where) {
    const axe = await runAxe();
    if (!axe) return S.observe(item, 'inconclusive', { reason: 'the accessibility checker could not run on this page' });
    const shot = await snap(`a11y-${slug(where)}`);
    // Name the element, not just the rule: "link-name (1)" sends nobody
    // anywhere, and an accessibility finding is only actionable with the thing
    // that broke it in hand.
    const violations = axe.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      why: v.help,
      places: v.nodes.length,
      where: v.nodes.slice(0, 3).map((n) => ({
        selector: [].concat(n.target).join(' '),
        markup: String(n.html || '').replace(/\s+/g, ' ').slice(0, 160),
      })),
    }));
    const total = violations.reduce((n, v) => n + v.places, 0);
    return S.observe(item, total ? 'fail' : 'pass', {
      assertion: 'the automatic accessibility rules all hold on this page',
      detail: total
        ? violations.map((v) => `${v.why} [${v.rule}, ${v.impact}] at ${v.where.map((w) => w.selector).join(', ')}`).join('; ')
        : 'no rule broken',
      measurement: { violations, cannotTell: axe.incomplete.length },
      evidence: [shot],
    });
  }

  async function runAxe(only) {
    try {
      const source = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      await page.evaluate(source);
      return await page.evaluate((rules) => window.axe.run(document, rules
        ? { runOnly: { type: 'rule', values: rules } }
        : { resultTypes: ['violations', 'incomplete'] }), only || null);
    } catch {
      return null;
    }
  }

  async function snap(name) {
    const file = `x-${slug(name)}.png`;
    await hudOff();
    try {
      await page.screenshot({ path: path.join(out, file) });
    } catch (err) {
      // A missing picture is never silent: the checks that call snap() are the
      // ones handing a judgement to a person, and a person cannot judge a
      // screenshot that was never taken.
      S.fault(`the screenshot "${name}" could not be taken: ${String((err && err.message) || err).slice(0, 160)}`);
      return null;
    }
    return file;
  }

  async function loginBO(item) {
    if (!boUrl) return S.observe(item, 'skipped', { reason: 'no back office address was given' });
    const email = process.env.QA_BO_EMAIL;
    const password = process.env.QA_BO_PASSWORD;
    if (!email || !password) {
      return S.observe(item, 'skipped', { reason: 'QA_BO_EMAIL and QA_BO_PASSWORD are not set in the environment' });
    }
    await page.goto(boUrl, { waitUntil: 'domcontentloaded' });
    await settle();
    await page.fill('input[name="email"]', email).catch(() => {});
    await page.fill('input[name="passwd"]', password).catch(() => {});
    await page.locator('#submit_login, form button[type="submit"]').first().click().catch(() => {});
    await settle();
    const stillAsking = await page.locator('input[name="passwd"]').count();
    return S.observe(item, stillAsking ? 'fail' : 'pass', {
      assertion: 'the back office accepts the credentials it was given',
      detail: stillAsking ? 'it is still asking for a password' : 'signed in',
    });
  }

  const api = {
    page, context, url, boUrl, profile, viewport: viewportName, label,
    step: (name, fn) => S.step(name, async () => { await hudOn(name); await fn(); }),
    observe: S.observe, note: S.note, fault: S.fault,
    open, see, count, noPageErrors, moduleRenders, settle, snap,
    overflow, contrast, focusRing, imageScale, accessibility, loginBO,
    fixtureCreated: S.fixtureCreated, fixtureRemoved: S.fixtureRemoved, fixtureLeft: S.fixtureLeft,
    // A suite that changes a shop-wide setting has to write it down before the
    // change and read it back after, and record.js has always been able to do
    // that. Without these two on the api a suite could only journal by hand,
    // and what it journalled never reached the report's own settings section.
    settingOpened: S.settingOpened, settingRestored: S.settingRestored,
  };

  // A suite that throws is the run that most needs its recording kept, so the
  // crash is recorded and the closing down carries on rather than exiting here.
  let crashed = null;
  try {
    await suite.run(api);
  } catch (e) {
    crashed = String((e && e.stack) || e);
    S.fault(`the suite stopped: ${crashed.slice(0, 300)}`);
  }

  const result = S.finish(crashed ? { outcome: 'the run did not finish' } : {});

  // A browser starts recording when it opens, not when a problem appears, so
  // every section is recorded and the ones that found nothing have their
  // recording thrown away.
  const video = page.video();
  await context.close();          // the recording is only finished once the context is
  const keep = result.wentWrong || S.rec.harness.length > 0 || !!crashed;
  if (video && keep) {
    // Saving has to happen before the browser goes away, and a failure here is
    // said out loud: a recording that vanished quietly is a missing piece of
    // evidence, not a tidy run.
    try {
      await video.saveAs(path.join(out, 'recording.webm'));
      console.error('recording kept: something went wrong in this section');
    } catch (e) {
      S.fault(`the recording of this section could not be saved: ${String(e.message || e).slice(0, 160)}`);
      S.flush();
      process.exitCode = 2;
    }
  } else if (video) {
    console.error('recording dropped: nothing went wrong in this section');
  } else {
    S.note('no recording was made, so a finding here has screenshots only');
    S.flush();
  }
  try { if (video) await video.delete(); } catch { /* the temp folder goes next anyway */ }
  await browser.close();
  fs.rmSync(videoTmp, { recursive: true, force: true });
  if (crashed) process.exitCode = 2;
})().catch((e) => {
  console.error(`the run stopped before it could record anything: ${String((e && e.stack) || e)}`);
  process.exit(2);
});
