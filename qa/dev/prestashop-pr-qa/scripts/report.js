// report.js — render the run directory as one self-contained HTML page for the developer who asked
// for the QA. It presents; it never decides.
//
//   node <skill>/scripts/report.js --run . [--out report.html]
//
// Reads, from the run directory: verdict.json (written by the agent — the judgement), before/phase.json
// and after/phase.json (written by run.js — the measurements). Either phase may be absent; the page
// then says so rather than implying a run that did not happen.
//
// The style follows references/design.md, which specifies every token used below. No
// external request: the page is opened from disk, often offline, and it is attached to tickets.
const fs = require('fs');
const path = require('path');

const arg = (n, d) => {
  // Accept both `--name=value` and `--name value`: the second is what everyone types by reflex, and
  // silently falling back to a default there is how a run ends up measuring the wrong directory.
  const a = process.argv.slice(2);
  const eq = a.find((x) => x.startsWith(`--${n}=`));
  if (eq !== undefined) return eq.slice(n.length + 3);
  const i = a.indexOf(`--${n}`);
  if (i !== -1 && a[i + 1] !== undefined && !a[i + 1].startsWith('--')) return a[i + 1];
  return d;
};
const RUN = path.resolve(arg('run', '.'));
const OUT = path.resolve(RUN, arg('out', 'report.html'));

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(RUN, p), 'utf8')); } catch (e) { return null; }
};
const verdict = readJson('verdict.json');
if (!verdict) {
  console.error(`no verdict.json in ${RUN}. Write it first: it carries the judgement, this script only renders it.`);
  process.exit(2);
}
const before = readJson('before/phase.json');
const after = readJson('after/phase.json');

const e = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The four verdicts, each with the semantic pair that carries it and the word a reader needs anyway.
const VERDICTS = {
  'approved': { label: 'Approved', tone: 'ok', mark: '🟢' },
  'not-approved': { label: 'Not approved', tone: 'bad', mark: '🔴' },
  'not-reproducible': { label: 'Not reproducible', tone: 'warn', mark: '🟡' },
  'not-applicable': { label: 'Not applicable', tone: 'flat', mark: '⚫' },
};
const V = VERDICTS[verdict.verdict] || { label: e(verdict.verdict || 'unknown'), tone: 'flat', mark: '' };

const badge = (tone, text) => `<span class="badge ${tone}">${e(text)}</span>`;
// A section is a full-bleed band; `tone` picks its surface. The rhythm light -> parchment -> dark
// is what separates them, so no band ever draws a rule against the next one.
const band = (tone, title, sub, body) => `<section class="band ${tone}"><div class="inner">
  <h2>${e(title)}</h2>${sub ? `<p class="sub">${e(sub)}</p>` : ''}${body}</div></section>`;
// Every table carries its own horizontal scroll: the regression net has five columns, one of them a
// URL, and a page that scrolls sideways is the very defect the net asserts against on the shop.
const rows = (head, body) => !body.length ? '<p class="sub">Nothing recorded.</p>' : `<div class="scroll"><table>
  <thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead>
  <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

// ── the decisive evidence: the same step, both phases, side by side ──
// Every screenshot is a link to itself: on the page it is 330px wide, which is enough to see a
// layout break but not to read a price. `cls` caps the tall narrow captures, which would otherwise
// each take a screenful, and anchors them to the top of the page where breaks show.
const shot = (src, label, phase, cls) => src
  ? `<span class="ph">${e(phase)}</span><a href="${e(src)}" title="open full size"><img loading="lazy"
     class="${e(cls || '')}" src="${e(src)}" alt="${e(label)}, ${e(phase)}"></a>`
  : `<span class="ph">${e(phase)}</span><p class="sub">not measured</p>`;

const shotPair = (label, b, a, cls) => `<figure class="pair">
  <figcaption>${e(label)}</figcaption>
  <div class="two">
    <div>${shot(b, label, 'before', cls)}</div>
    <div>${shot(a, label, 'after', cls)}</div>
  </div></figure>`;

// A clip exists only if the scenario marked a region and it resolved in that phase. Pair them
// by label, so a region present in one phase and absent in the other still shows what was there.
const clipPairs = () => {
  const map = new Map();
  const id = (f) => `${f.step}\u00b7${f.label}`;   // two clips may share a label; the step separates them
  ((before && before.clips) || []).forEach((f) => map.set(id(f), { b: f }));
  ((after && after.clips) || []).forEach((f) => map.set(id(f), { ...(map.get(id(f)) || {}), a: f }));
  return [...map.entries()].map(([k, v]) => [(v.a || v.b).label, v]);
};

const stepShot = (phase, dir) => phase && phase.steps ? phase.steps.map((s) => `${dir}/${s.shot}`) : [];
const bugStepNumbers = [...new Set([...(before ? before.bugs : []), ...(after ? after.bugs : [])].map((b) => b.step))];
const stepName = (n) => {
  const s = ((after || before || {}).steps || []).find((x) => Number(x.n) === Number(n));
  return s ? s.name : `step ${n}`;
};
const shotFor = (phase, dir, n) => {
  const s = phase && phase.steps ? phase.steps.find((x) => Number(x.n) === Number(n)) : null;
  return s ? `${dir}/${s.shot}` : null;
};

const bugRows = (phase, dir) => (phase ? phase.bugs : []).map((b) => [
  e(b.name),
  b.passed ? badge('ok', 'correct behaviour') : badge('bad', 'symptom observed'),
  b.flaky ? badge('warn', b.intermittent ? 'intermittent' : 'settled on re-read') : '',
  `<code translate="no">${e(b.detail || '')}</code>`,
]);

// ── the regression net: what the comparison makes attributable ──
const key = (r) => `${r.viewport} · ${r.url}`;
// Attribution needs BOTH phases. A page the scenario only reached in one of them — the smoke net
// skips a product page it cannot find, the responsive net follows wherever the scenario went — has
// no counterpart to compare against, and calling that "introduced by this PR" accuses a PR of a
// regression on a page nobody measured before it.
const attribute = (b, a) => {
  const bad = (r) => !!r && !r.ok;
  if (!b && !a) return badge('flat', 'not measured');
  if (!b) return badge('flat', bad(a) ? 'only measured after — cannot attribute' : 'only measured after');
  if (!a) return badge('flat', 'only measured before');
  if (bad(b) && bad(a)) return badge('warn', 'pre-existing');
  if (!bad(b) && bad(a)) return badge('bad', 'introduced by this PR');
  if (bad(b) && !bad(a)) return badge('ok', 'fixed by this PR');
  return badge('ok', 'fine');
};

const netRows = () => {
  const map = new Map();
  (before ? before.responsive : []).forEach((r) => map.set(key(r), { b: r }));
  (after ? after.responsive : []).forEach((r) => map.set(key(r), { ...(map.get(key(r)) || {}), a: r }));
  return [...map.entries()].map(([k, { b, a }]) => {
    const state = attribute(b, a);
    const why = (r) => !r ? 'not measured' : r.ok ? 'ok'
      : [!r.responds ? 'did not respond' : '', !r.rendered ? 'rendered nothing' : '',
         r.overflowPx ? `scrolls sideways by ${r.overflowPx}\u00a0px` : ''].filter(Boolean).join(', ');
    const worst = (a && a.worst || []).concat(b && b.worst || []);
    return [e(k.replace(/^([a-z]+) · /, '$1 · ')), state, e(why(b)), e(why(a)),
            worst.length ? `<code translate="no">${e([...new Set(worst)].join(' '))}</code>` : ''];
  });
};
const smokeRows = () => {
  const map = new Map();
  (before ? before.smoke : []).forEach((r) => map.set(r.label, { b: r }));
  (after ? after.smoke : []).forEach((r) => map.set(r.label, { ...(map.get(r.label) || {}), a: r }));
  return [...map.entries()].map(([label, { b, a }]) =>
    [e(label), attribute(b, a), e(b ? b.status : 'not measured'), e(a ? a.status : 'not measured')]);
};

// ── the honesty checks: the reasons a verdict could be void, each answered ──
const same = (k) => before && after ? before[k] === after[k] : null;
const checks = [
  ['The same scenario ran in both phases', same('scenarioSha256'), before && before.scenarioSha256],
  ['The same runner judged both phases', same('runnerSha256'), before && before.runnerSha256],
  ['No precondition failed', !before && !after ? null
    : [before, after].filter(Boolean).every((p) => p.preconditions.every((c) => c.passed)), null],
  ['No harness error', !before && !after ? null
    : [before, after].filter(Boolean).every((p) => !p.harness.length), null],
  ['The shop really changed between the phases', verdict.canary ? verdict.canary.before !== verdict.canary.after : null,
    verdict.canary ? `${verdict.canary.before} → ${verdict.canary.after}` : null],
];

// The narrow screenshots, paired by viewport and page. Nothing asserts what they show: they are
// here because a human has to look at them, which is the whole reason the net takes them.
const narrowShots = () => {
  const map = new Map();
  (before ? before.responsive : []).forEach((r) => map.set(key(r), { b: r }));
  (after ? after.responsive : []).forEach((r) => map.set(key(r), { ...(map.get(key(r)) || {}), a: r }));
  const pairs = [...map.entries()].map(([k, { b, a }]) => [k, shotPair(k,
    b ? `before/${b.shot}` : null, a ? `after/${a.shot}` : null, 'narrow')]);
  if (!pairs.length) return '<p class="sub">No narrow pass recorded.</p>';
  // The front page at both widths is shown; the rest folds away, because the list grows with the
  // number of pages the scenario opened and the reader came for the verdict, not a contact sheet.
  // Pick it by URL: the rows are grouped by viewport, so the first two are both the same width.
  const home = (k) => /\/$/.test(k) || /^[a-z]+ \u00b7 [^/]+\/?$/.test(k);
  const shown = pairs.filter(([k]) => home(k)).map(([, html]) => html).join('')
    || pairs.slice(0, 2).map(([, html]) => html).join('');
  const rest = pairs.filter(([k]) => !home(k)).map(([, html]) => html);
  return shown + (rest.length
    ? `<details><summary>The other narrow pages (${rest.length})</summary>${rest.join('')}</details>` : '');
};

// Counted, never estimated: every number here comes from the two phase.json files.
const countShots = (p) => p ? (p.steps || []).length + (p.responsive || []).length + (p.clips || []).length : 0;
const STATS = [
  [String([before, after].filter(Boolean).length), 'code states measured'],
  [String(((before && before.steps) || []).length + ((after && after.steps) || []).length), 'browser steps recorded'],
  [String(countShots(before) + countShots(after)), 'screenshots kept'],
  [String(((after || before || {}).bugs || []).length), 'checks that can prove the bug'],
  [String(((before && before.harness) || []).length + ((after && after.harness) || []).length), 'harness errors'],
];

const video = (dir, phase) => phase
  ? `<div><span class="ph">${e(dir)}</span><video controls preload="metadata" src="${e(dir)}/video.webm"></video></div>`
  : `<div><span class="ph">${e(dir)}</span><p class="sub">phase not run</p></div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA · ${e(verdict.pr && verdict.pr.title || 'pull request')}</title>
<style>
:root{
  color-scheme:light;
  --action:#0066cc; --action-focus:#0071e3; --action-on-dark:#2997ff;
  --canvas:#fff; --parchment:#f5f5f7; --tile:#272729;
  --ink:#1d1d1f; --ink-muted:#7a7a7a; --on-dark:#fff; --on-dark-muted:#ccc;
  --hairline:#e0e0e0;
  --ok:#1d8a4e; --bad:#c8102e; --warn:#8a6100;
  --sans:system-ui,-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  /* The only shadow in the system. It belongs to the evidence, never to the interface. */
  --lift:rgba(0,0,0,.22) 3px 5px 30px 0;
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);
  font:400 17px/1.47 var(--sans);letter-spacing:-.374px;font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased}
/* Bands stack edge to edge with no gap and no border: the change of surface is the divider. */
.band{padding:80px 24px}
.band.parchment{background:var(--parchment)}
.band.dark{background:var(--tile);color:var(--on-dark)}
.band.dark .sub,.band.dark dt{color:var(--on-dark-muted)}
.band.dark a{color:var(--action-on-dark)}
.inner{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
h1{margin:0;font-size:56px;line-height:1.07;font-weight:600;letter-spacing:-.28px;text-wrap:balance}
h2{margin:0;font-size:34px;line-height:1.15;font-weight:600;letter-spacing:-.374px;text-wrap:balance}
h3{margin:0;font-size:21px;line-height:1.19;font-weight:600;letter-spacing:.231px}
p{margin:0}
.lead{font-size:28px;line-height:1.14;font-weight:400;letter-spacing:.196px}
.sub{color:var(--ink-muted);font-size:14px;line-height:1.43;letter-spacing:-.224px}
.fine{font-size:12px;line-height:1.4;letter-spacing:-.12px;color:var(--ink-muted)}
.dot{display:inline-block;width:.62em;height:.62em;border-radius:9999px;margin-right:.28em;
  vertical-align:.06em}
.dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)}
.dot.warn{background:var(--warn)} .dot.flat{background:var(--action)}
/* A card is set apart by one hairline, never by depth. */
.card{background:var(--canvas);border:1px solid var(--hairline);border-radius:18px;padding:24px;
  display:flex;flex-direction:column;gap:12px}
.badge{display:inline-block;padding:3px 12px;border-radius:9999px;font-size:14px;line-height:20px;
  letter-spacing:-.224px;background:var(--parchment);color:var(--ink);white-space:nowrap}
.band.dark .badge{background:rgba(255,255,255,.12);color:var(--on-dark)}
.badge.ok{color:var(--ok)} .badge.bad{color:var(--bad)}
.badge.warn{color:var(--warn)} .badge.flat{color:var(--action)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;letter-spacing:-.224px}
th{text-align:left;font-weight:600;color:var(--ink-muted);white-space:nowrap}
th,td{padding:12px;border-bottom:1px solid var(--hairline);vertical-align:top}
.band.dark th,.band.dark td{border-color:rgba(255,255,255,.16)}
tbody tr:last-child td{border-bottom:0}
code{font-family:var(--mono);font-size:14px;letter-spacing:0;word-break:break-word}
dl{display:grid;grid-template-columns:auto 1fr;gap:12px 24px;margin:0;font-size:17px}
dt{color:var(--ink-muted);font-size:14px;letter-spacing:-.224px}
dd{margin:0}
a{color:var(--action);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--action-focus);outline-offset:2px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}
figure{margin:0;display:flex;flex-direction:column;gap:12px}
.two>*{min-width:0}   /* grid children default to min-width:auto and refuse to shrink under an image */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:24px;border-top:1px solid var(--hairline);
  padding-top:24px}
.stat b{display:block;font-size:40px;line-height:1.1;font-weight:600;letter-spacing:-.374px}
.stat span{font-size:14px;line-height:1.43;letter-spacing:-.224px;color:var(--ink-muted)}
.band.parchment:first-child{padding:120px 24px 96px}
.ph{font-size:14px;letter-spacing:-.224px;color:var(--ink-muted)}
.band.dark .ph{color:var(--on-dark-muted)}
/* The evidence is the subject: rectangular, unframed, and the one shadow gives it weight. */
img,video{width:100%;display:block;border-radius:0;box-shadow:var(--lift)}
img.narrow{max-height:420px;object-fit:contain;object-position:top;background:var(--canvas)}
/* A clipped region is shown at its own size, never stretched to the column: enlarging a 200px band
   to 480px turns crisp evidence into a blur. */
img.clip{width:auto;max-width:100%}
a:has(img){display:block}
a:has(img):hover{text-decoration:none}
pre{background:var(--canvas);border:1px solid var(--hairline);border-radius:18px;padding:24px;
  overflow-x:auto;font-family:var(--mono);font-size:14px;letter-spacing:0;margin:0;white-space:pre-wrap}
button{font:400 17px/1 var(--sans);letter-spacing:-.374px;padding:11px 22px;border:0;
  border-radius:9999px;background:var(--action);color:#fff;cursor:pointer}
@media (prefers-reduced-motion:no-preference){button:active{transform:scale(.95)}}
details{border-top:1px solid var(--hairline);padding-top:16px;margin-top:8px}
summary{cursor:pointer}
ul{margin:0;padding-left:24px;display:flex;flex-direction:column;gap:8px}
@media (max-width:833px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .band.parchment:first-child{padding:64px 20px 48px}
  .band{padding:48px 20px}.two{grid-template-columns:1fr}
  h1{font-size:34px;line-height:1.1}h2{font-size:28px}.lead{font-size:21px}
}
</style></head>
<body><main>

<section class="band parchment"><div class="inner">
  <p class="sub">QA of ${e(verdict.pr && verdict.pr.repo || '')}${verdict.pr && verdict.pr.number ? ` #${e(verdict.pr.number)}` : ''}${verdict.pr && verdict.pr.title ? ` &middot; ${e(verdict.pr.title)}` : ''}</p>
  <h1><span class="dot ${V.tone}" aria-hidden="true"></span>${e(V.label)}</h1>
  ${verdict.caveat ? `<p class="lead">${e(verdict.caveat)}</p>` : ''}
  ${verdict.why ? `<p>${e(verdict.why)}</p>` : ''}
  ${clipPairs().slice(0, 1).map(([label, { b, a }]) => `<figure class="two">
    <div>${shot(b ? `before/${b.shot}` : null, label, 'before', 'clip')}</div>
    <div>${shot(a ? `after/${a.shot}` : null, label, 'after', 'clip')}</div>
  </figure><p class="sub">${e(label)} &mdash; the same region of the same page, in both states, at
  full size.</p>`).join('')}
  <div class="stats">${STATS.map(([n, c]) => `<div class="stat"><b>${e(n)}</b><span>${e(c)}</span></div>`).join('')}</div>
  <p class="fine">AI-generated QA review. The tooling is still being tested &mdash; sanity-check the
  verdict before acting on it. Everything below was measured in a real browser; the screenshots and
  the video are the raw recording, not an illustration.</p>
</div></section>

${band('canvas', 'What was tested', null, `<dl>
  <dt>Shop</dt><dd><code>${e(verdict.shop && verdict.shop.fo || '')}</code></dd>
  ${verdict.shop && verdict.shop.bo ? `<dt>Back office</dt><dd><code>${e(verdict.shop.bo)}</code></dd>` : ''}
  ${verdict.shop && verdict.shop.versions ? `<dt>Versions</dt><dd>${e(verdict.shop.versions)}</dd>` : ''}
  <dt>Kind</dt><dd>${e(verdict.classification || '')}</dd>
  <dt>Test steps</dt><dd>${e(verdict.stepsFrom || 'not stated')}</dd>
  <dt>before</dt><dd>${e(verdict.states && verdict.states.before || 'not run')}</dd>
  <dt>after</dt><dd>${e(verdict.states && verdict.states.after || 'not run')}</dd>
  <dt>Browser</dt><dd>Chromium via Playwright ${e((after || before || {}).playwright || '')}, viewport
    ${e(JSON.stringify((after || before || {}).viewport || {}))}</dd>
</dl>`)}

${band('parchment', 'The bug', 'The only checks that can prove or disprove the ticket. Written in the reporter’s words, never in the diff’s.', `
<h3>before — the bug must show</h3>
${before ? rows(['Check', 'Result', '', 'Observed'], bugRows(before, 'before')) : '<p class="sub">Phase not run.</p>'}
<h3>after — the bug must be gone</h3>
${after ? rows(['Check', 'Result', '', 'Observed'], bugRows(after, 'after')) : '<p class="sub">Phase not run.</p>'}`)}

${band('canvas', 'The evidence', 'The same moment in both states. This pairing is the argument; everything else is context.',
  clipPairs().map(([label, { b, a }]) => shotPair(label, b ? `before/${b.shot}` : null, a ? `after/${a.shot}` : null, 'clip')).join('')
  + `<details><summary>The whole page at each of those moments</summary>${
      (bugStepNumbers.length ? bugStepNumbers : [(after || before || { steps: [] }).steps.length])
        .map((n) => shotPair(stepName(n), shotFor(before, 'before', n), shotFor(after, 'after', n))).join('')}</details>`
  + `<details><summary>Every step, both phases</summary>${
      ((after || before || {}).steps || []).map((s) => shotPair(`${s.n}. ${s.name}`,
        shotFor(before, 'before', s.n), shotFor(after, 'after', s.n))).join('')}</details>`)}

${band('dark', 'The runs, recorded', 'Both phases end to end, at the speed they happened.',
  `<div class="two">${video('before', before)}${video('after', after)}</div>`)}

${band('canvas', 'Regression net', 'Checks the ticket never asked for, run in both phases so a finding can be blamed on the PR or cleared of it.', `
<h3>Pages still work</h3>
${rows(['Page', 'Verdict', 'before', 'after'], smokeRows())}
<h3>Narrow viewports — 375 and 768 wide</h3>
${rows(['Viewport and page', 'Verdict', 'before', 'after', 'Boxes sticking out'], netRows())}
<p class="sub">Only three things are asserted narrow: the page responds, it renders visible content,
it does not scroll sideways. A cramped price, a two-line button or a stretched image is not
measured — that is what the screenshots below are for.</p>
<p class="sub">Click any screenshot to open it full size.</p>
${narrowShots()}`)}

${(() => {
  const said = [];
  [['before', before], ['after', after]].forEach(([dir, p]) => {
    if (!p) return;
    (p.notes || []).forEach((n) => said.push([dir, badge('flat', 'note'), n]));
    (p.harness || []).forEach((h) => said.push([dir, badge('bad', 'harness error'), h]));
  });
  return said.length ? band('canvas', 'What the run said',
    'Notes and faults the runner recorded. A harness error means the measurement itself cannot be trusted.',
    rows(['Phase', '', 'Message'], said.map(([d, b, m]) => [e(d), b, `<code translate="no">${e(String(m).split('\n')[0].slice(0, 300))}</code>`]))) : '';
})()}

${band('parchment', 'Honesty checks', 'Each of these can void a verdict. This is what they said.',
  rows(['Check', 'Result', 'Value'], checks.map(([name, ok, val]) => [
    e(name),
    ok === null ? badge('flat', 'not applicable') : ok ? badge('ok', 'yes') : badge('bad', 'no'),
    val ? `<code translate="no">${e(String(val).length === 64 ? String(val).slice(0, 12) : String(val))}</code>` : '',
  ])))}

${(verdict.notTested && verdict.notTested.length) ? band('canvas', 'What was not tested',
  'Stated so nobody reads this report as more than it is.',
  `<ul>${verdict.notTested.map((t) => `<li>${e(t)}</li>`).join('')}</ul>`) : ''}

${verdict.comment ? band('parchment', 'Comment to post', 'Copy this into the pull request. Nothing was posted automatically.',
  `<pre id="c">${e(verdict.comment)}</pre>
   <button onclick="navigator.clipboard.writeText(document.getElementById('c').innerText)">Copy</button>`) : ''}

<section class="band canvas"><div class="inner">
  <p class="fine">Generated by prestashop-pr-qa. Runner
  <code translate="no">${e(((after || before || {}).runnerSha256 || '').slice(0, 12))}</code>, scenario
  <code translate="no">${e(((after || before || {}).scenarioSha256 || '').slice(0, 12))}</code>. Share the whole
  run directory: this page points at the screenshots and the video next to it.</p>
</div></section>

</main></body></html>`;

// Three bands are conditional — the notes, what was not tested, the comment — so hand-assigned
// surfaces drift the moment one of them is absent, and two identical surfaces touching read as a
// single section. The surface change is the only divider this design has, so the alternation is
// normalised once, here, instead of being reasoned about at nine call sites. Dark bands keep their
// own surface and do not take a turn.
let light = 'canvas';   // flipped before the first use, so the page opens on parchment
const paged = html.replace(/class="band (canvas|parchment)"/g, () => {
  light = light === 'canvas' ? 'parchment' : 'canvas';
  return `class="band ${light}"`;
});

fs.writeFileSync(OUT, paged);
console.log(OUT);
