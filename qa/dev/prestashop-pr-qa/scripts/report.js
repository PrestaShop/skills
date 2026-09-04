// report.js: render the run directory as one self-contained HTML page for the developer who asked
// for the QA. It presents; it never decides.
//
//   node <skill>/scripts/report.js --run . [--out report.html]
//
// Reads, from the run directory: verdict.json (the judgement, written by the agent), before/phase.json
// and after/phase.json (the measurements, written by whichever runner ran). Either phase may be
// absent; the page then says so rather than implying a run that did not happen.
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
// The probe decides what the evidence looks like: paired screenshots for a browser run, paired
// transcripts for a command line or an endpoint. Everything else on the page is identical, because
// the measurements share a shape whatever produced them.
const PROBE = ((after || before || {}).probe) || 'browser';
const isBrowser = PROBE === 'browser';
// The comment is written by hand and pasted on a public pull request, so the one claim in it that
// can be checked mechanically is checked here: a command-line run must not tell the world a browser
// was used. Refusing costs one line of retyping; publishing the wrong claim costs the report its
// credibility, and nobody rereads a comment they already trusted.
const CLAIMS = {
  browser: /drove a real browser|in a real browser|through the steps below/i,
  cli: /ran the commands|on the command line|in a shell/i,
  http: /made the requests|over HTTP|against the running/i,
};
if (verdict.comment) {
  const wrong = Object.keys(CLAIMS).filter((k) => k !== PROBE && CLAIMS[k].test(verdict.comment));
  if (wrong.length) {
    console.error(`the comment claims a ${wrong.join(' and ')} run, but these measurements came from the `
      + `${PROBE} probe. Fix the line in verdict.json before this is pasted anywhere.`);
    process.exit(2);
  }
  if (!/AI-assisted QA/i.test(verdict.comment)) {
    console.error('warning: the comment does not say the review was AI-assisted. See references/reporting.md.');
  }
}

const HOW = isBrowser ? 'drove a real browser through the steps below'
  : PROBE === 'cli' ? 'ran the commands below in a shell'
    : 'made the requests below against the running environment';

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
// Every screenshot is a link to itself. In the page it sits in one of two equal columns inside the
// content width, so it is about half of that: enough to see a layout break, not enough to read a
// price, which is exactly why the link to the full size matters. `cls` caps the tall narrow captures, which would otherwise
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

// Commands and requests pair by what they are, not by their order: a phase can make one call more
// than the other, and the flake re-sample is exactly that case.
const pairBy = (key, pick) => {
  const map = new Map();
  (before ? pick(before) : []).forEach((x, i) => map.set(`${key(x)}#${i}`, { b: x }));
  (after ? pick(after) : []).forEach((x, i) => {
    const k = `${key(x)}#${i}`;
    map.set(k, { ...(map.get(k) || {}), a: x });
  });
  return [...map.entries()].map(([k, v]) => [k.replace(/#\d+$/, ''), v]);
};

const transcriptPair = (label, b, a, render) => `<figure class="pair">
  <figcaption><code translate="no">${e(label)}</code></figcaption>
  <div class="two">
    <div><span class="ph">before</span>${b ? render(b) : '<p class="sub">not measured</p>'}</div>
    <div><span class="ph">after</span>${a ? render(a) : '<p class="sub">not measured</p>'}</div>
  </div></figure>`;

const showCommand = (c) => `<p class="sub">exit <strong>${e(c.code)}</strong> in ${e(c.ms)} ms</p>
  <pre>${e((c.stdout || '').trim() || '(no output)')}${c.stderr ? '\n[stderr]\n' + e(c.stderr.trim()) : ''}</pre>`;
const showRequest = (r) => `<p class="sub">${e(r.status || 'no answer')} ${e(r.contentType || '')} in ${e(r.ms)} ms${r.location ? `, redirects to <code translate="no">${e(r.location)}</code>` : ''}</p>
  <pre>${e((r.body || '').trim() || '(empty body)')}</pre>`;

const commandPairs = () => pairBy((c) => c.command, (p) => p.commands || []);
const requestPairs = () => pairBy((r) => `${r.method} ${new URL(r.url).pathname}`, (p) => p.requests || []);

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
// Attribution needs BOTH phases. A page the scenario only reached in one of them, because the smoke net
// skips a product page it cannot find or the responsive net followed the scenario elsewhere, has
// no counterpart to compare against, and calling that "introduced by this PR" accuses a PR of a
// regression on a page nobody measured before it.
const attribute = (b, a) => {
  const bad = (r) => !!r && !r.ok;
  if (!b && !a) return badge('flat', 'not measured');
  if (!b) return badge('flat', bad(a) ? 'only measured after, cannot attribute' : 'only measured after');
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

// The surfaces this PR touches, on both sides of the shop. A surface that answered before and
// fails after is a regression this PR introduced, whatever the bug assertions say. One case is not:
// a legacy back-office URL is token-signed, so it cannot be opened directly, and the runner says
// "could not be measured" rather than failing a PR over a URL it was never able to build.
const surfaceRows = () => {
  const k = (r) => `${r.side}:${r.ref}`;
  const map = new Map();
  (before ? before.surfaces || [] : []).forEach((r) => map.set(k(r), { b: r }));
  (after ? after.surfaces || [] : []).forEach((r) => map.set(k(r), { ...(map.get(k(r)) || {}), a: r }));
  const why = (r) => {
    if (!r) return 'not measured';
    if (r.unreachable) return r.unreachable;
    if (r.ok) return `${r.status}, renders`;
    return [r.status ? `answered ${r.status}` : 'no response',
            r.status > 0 && r.status < 400 && !r.rendered ? 'rendered nothing' : ''].filter(Boolean).join(', ');
  };
  return [...map.entries()].map(([label, { b, a }]) => {
    const blocked = (b && b.unreachable) || (a && a.unreachable);
    const side = label.startsWith('bo:') ? 'back office' : 'front office';
    return [`${e(side)} <code translate="no">${e(label.slice(3))}</code>`,
            blocked ? badge('flat', 'could not be measured') : attribute(b, a),
            e(why(b)), e(why(a))];
  });
};

// ── the honesty checks: the reasons a verdict could be void, each answered ──
const same = (k) => before && after ? before[k] === after[k] : null;
const checks = [
  ['The same scenario ran in both phases', same('scenarioSha256'), before && before.scenarioSha256],
  ['The same runner judged both phases', same('runnerSha256'), before && before.runnerSha256],
  ['The same recording rules applied to both', same('recordSha256'), before && before.recordSha256],
  ['No precondition failed', !before && !after ? null
    : [before, after].filter(Boolean).every((p) => p.preconditions.every((c) => c.passed)), null],
  ['No harness error', !before && !after ? null
    : [before, after].filter(Boolean).every((p) => !p.harness.length), null],
  ['The environment really changed between the phases', verdict.canary ? verdict.canary.before !== verdict.canary.after : null,
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

// The opening band leads with the decisive evidence, whatever the probe recorded: the marked region
// for a browser run, the command or the request the bug assertion rests on otherwise. A reader who
// stops at the first screen has still seen the proof.
const lead = () => {
  if (isBrowser) {
    return clipPairs().slice(0, 1).map(([label, { b, a }]) => `<figure class="two">
      <div>${shot(b ? `before/${b.shot}` : null, label, 'before', 'clip')}</div>
      <div>${shot(a ? `after/${a.shot}` : null, label, 'after', 'clip')}</div>
    </figure><p class="sub">${e(label)}: the same region of the same page, in both states, at full
    size.</p>`).join('');
  }
  const pairs = PROBE === 'cli' ? commandPairs() : requestPairs();
  const render = PROBE === 'cli' ? showCommand : showRequest;
  // The one the verdict rests on: the step that carries a bug assertion, or failing that the last.
  const first = ((after || before || {}).bugs || [])[0];
  const chosen = pairs.find(([, v]) => (v.a || v.b).step === (first || {}).step) || pairs[pairs.length - 1];
  return chosen ? transcriptPair(chosen[0], chosen[1].b, chosen[1].a, render) : '';
};

// Counted, never estimated: every number here comes from the two phase.json files.
const countShots = (p) => p ? (p.steps || []).filter((x) => x.shot).length + (p.responsive || []).length + (p.clips || []).length : 0;
const both = (pick) => ((before ? pick(before) : []).length + (after ? pick(after) : []).length);
const OBSERVED = isBrowser
  ? [String(countShots(before) + countShots(after)), 'screenshots kept']
  : PROBE === 'cli'
    ? [String(both((p) => p.commands || [])), 'commands run']
    : [String(both((p) => p.requests || [])), 'requests made'];
// `shop` is the older name for the same object. A command-line run has no shop URL at all, so
// every row is conditional: an empty "Shop" line would state that the field was measured and blank.
const ENV = verdict.environment || verdict.shop || {};
const ENVIRONMENT = [
  ['Front office', ENV.fo, true],
  ['Back office', ENV.bo, true],
  ['Working directory', ENV.cwd, true],
  ['Versions', ENV.versions, false],
].filter(([, v]) => v).map(([k, v, code]) =>
  `<dt>${e(k)}</dt><dd>${code ? `<code>${e(v)}</code>` : e(v)}</dd>`).join('\n  ')
  || '<dt>Environment</dt><dd>not stated</dd>';

const STATS = [
  [String([before, after].filter(Boolean).length), 'code states measured'],
  [String(both((p) => p.steps || [])), 'steps recorded'],
  OBSERVED,
  [String(((after || before || {}).bugs || []).length), 'checks that can prove the bug'],
  [String(both((p) => p.harness || [])), 'harness errors'],
];

// What the evidence band holds depends on the probe. The pairing is the argument in all three: the
// same moment, or the same command, or the same request, in both states.
const evidenceSub = () => isBrowser
  ? 'The same moment in both states. This pairing is the argument; everything else is context.'
  : PROBE === 'cli'
    ? 'Every command, run in both states. The pairing is the argument; the full transcript sits next to this page.'
    : 'Every request, made in both states. The pairing is the argument; the full transcript sits next to this page.';

const evidence = () => {
  if (isBrowser) {
    return clipPairs().map(([label, { b, a }]) => shotPair(label, b ? `before/${b.shot}` : null, a ? `after/${a.shot}` : null, 'clip')).join('')
      + `<details><summary>The whole page at each of those moments</summary>${
        (bugStepNumbers.length ? bugStepNumbers : [(after || before || { steps: [] }).steps.length])
          .map((n) => shotPair(stepName(n), shotFor(before, 'before', n), shotFor(after, 'after', n))).join('')}</details>`
      + `<details><summary>Every step, both phases</summary>${
        ((after || before || {}).steps || []).map((x) => shotPair(`${x.n}. ${x.name}`,
          shotFor(before, 'before', x.n), shotFor(after, 'after', x.n))).join('')}</details>`;
  }
  const pairs = PROBE === 'cli' ? commandPairs() : requestPairs();
  const render = PROBE === 'cli' ? showCommand : showRequest;
  if (!pairs.length) return '<p class="sub">Nothing recorded.</p>';
  return pairs.map(([label, { b, a }]) => transcriptPair(label, b, a, render)).join('')
    + '<p class="sub">Output longer than a few thousand characters is cut here and kept whole in '
    + '<code translate="no">before/transcript.txt</code> and <code translate="no">after/transcript.txt</code>.</p>';
};

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
  --ink:#1d1d1f; --ink-muted:#6b6b70; --on-dark:#fff; --on-dark-muted:#ccc;
  --hairline:#e0e0e0; --code-bg:rgba(0,0,0,.045); --code-bg-dark:rgba(255,255,255,.12);
  --ok:#1d8a4e; --ok-bg:#e6f4ec; --bad:#c8102e; --bad-bg:#fbe9ec;
  --warn:#8a6100; --warn-bg:#fdf3e0; --flat-bg:#e8f0fb;
  --sans:system-ui,-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  /* The only shadow in the system. It belongs to the evidence, never to the interface. */
  --lift:rgba(0,0,0,.22) 0.1875rem 0.3125rem 1.875rem 0;
}
*{box-sizing:border-box}
/* Every length is in rem, so the whole page scales with the reader's font size. Tracking is in em,
   which is the only relative unit that follows the size of the text it applies to. */
body{margin:0;background:var(--canvas);color:var(--ink);
  font:400 1.0625rem/1.47 var(--sans);letter-spacing:-.022em;font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased}
.band{padding:5rem 1.5rem}
.band.parchment{background:var(--parchment)}
.band.dark{background:var(--tile);color:var(--on-dark)}
.band.dark .sub,.band.dark dt,.band.dark .ph{color:var(--on-dark-muted)}
.band.dark a{color:var(--action-on-dark)}
.inner{max-width:61.25rem;margin:0 auto;display:flex;flex-direction:column;gap:1.5rem}
h1{margin:0;font-size:3.5rem;line-height:1.07;font-weight:600;letter-spacing:-.005em;text-wrap:balance}
h2{margin:0;font-size:2.125rem;line-height:1.15;font-weight:600;letter-spacing:-.011em;text-wrap:balance}
h3{margin:0;font-size:1.3125rem;line-height:1.19;font-weight:600;letter-spacing:.011em}
p{margin:0}
.lead{font-size:1.75rem;line-height:1.14;font-weight:400;letter-spacing:.007em}
.sub{color:var(--ink-muted);font-size:.875rem;line-height:1.43;letter-spacing:-.016em}
.fine{font-size:.75rem;line-height:1.4;letter-spacing:-.01em;color:var(--ink-muted)}
.dot{display:inline-block;width:.62em;height:.62em;border-radius:62.4375rem;margin-right:.28em;vertical-align:.06em}
.dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)} .dot.warn{background:var(--warn)}
/* A card is set apart by one hairline, never by depth. */
.card{background:var(--canvas);border:.0625rem solid var(--hairline);border-radius:1.125rem;
  padding:1.5rem;display:flex;flex-direction:column;gap:.75rem}
/* A badge carries a state, so it is tinted, not merely coloured text: a word in a slightly darker
   grey is not a status, it is a typo waiting to be missed. */
.badge{display:inline-block;padding:.1875rem .625rem;border-radius:62.4375rem;font-size:.8125rem;
  line-height:1.25rem;font-weight:600;letter-spacing:-.006em;white-space:nowrap;
  background:var(--parchment);color:var(--ink);box-shadow:inset 0 0 0 .0625rem rgba(0,0,0,.08)}
.band.parchment .badge{background:var(--canvas)}
/* On the dark band the tints would disappear, so the status keeps its own colour, lightened to
   stay legible, and the ground becomes a translucent white instead of a pale tint. */
.band.dark .badge{background:var(--code-bg-dark);color:var(--on-dark);box-shadow:none}
.band.dark .badge.ok{background:rgba(52,199,123,.16);color:#5fd39a}
.band.dark .badge.bad{background:rgba(255,105,120,.16);color:#ff8a95}
.band.dark .badge.warn{background:rgba(255,193,84,.16);color:#ffc154}
.band.dark .badge.flat{background:rgba(41,151,255,.16);color:var(--action-on-dark)}
.badge.ok{background:var(--ok-bg);color:var(--ok);box-shadow:inset 0 0 0 .0625rem rgba(29,138,78,.28)}
.badge.bad{background:var(--bad-bg);color:var(--bad);box-shadow:inset 0 0 0 .0625rem rgba(200,16,46,.28)}
.badge.warn{background:var(--warn-bg);color:var(--warn);box-shadow:inset 0 0 0 .0625rem rgba(138,97,0,.28)}
.badge.flat{background:var(--flat-bg);color:var(--action);box-shadow:inset 0 0 0 .0625rem rgba(0,102,204,.22)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.875rem;letter-spacing:-.016em}
th{text-align:left;font-weight:600;color:var(--ink-muted);white-space:nowrap}
th,td{padding:.75rem;border-bottom:.0625rem solid var(--hairline);vertical-align:top}
.band.dark th,.band.dark td{border-color:rgba(255,255,255,.16)}
tbody tr:last-child td{border-bottom:0}
/* Code reads as code: its own ground, a touch heavier, and never inheriting the prose tracking. */
code{font-family:var(--mono);font-size:.875em;font-weight:500;letter-spacing:0;word-break:break-word;
  background:var(--code-bg);padding:.0625rem .3125rem;border-radius:.25rem}
.band.dark code{background:var(--code-bg-dark)}
pre code{background:none;padding:0;font-size:inherit;font-weight:inherit}
dl{display:grid;grid-template-columns:auto 1fr;gap:.75rem 1.5rem;margin:0;}
dt{color:var(--ink-muted);font-size:.875rem;letter-spacing:-.016em}
dd{margin:0}
a{color:var(--action);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:.125rem solid var(--action-focus);outline-offset:.125rem}
.two{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
.two>*{min-width:0}
figure{margin:0;display:flex;flex-direction:column;gap:.75rem}
/* The caption names the pair; the phase label names one side of it. They must not read alike, so
   one is ink at reading size and the other is a small muted tag over the image it belongs to. */
.pair figcaption{font-size:1.0625rem;line-height:1.35;font-weight:600;letter-spacing:-.011em;
  color:var(--ink);padding-bottom:.5rem;border-bottom:.0625rem solid var(--hairline)}
.ph{display:inline-block;font-family:var(--mono);font-size:.75rem;line-height:1.25rem;
  letter-spacing:0;color:var(--ink-muted);background:var(--code-bg);
  padding:0 .375rem;border-radius:.25rem;align-self:flex-start}
.band.dark .ph{background:var(--code-bg-dark)}
img,video{width:100%;display:block;border-radius:0;box-shadow:var(--lift)}
img.narrow{max-height:26.25rem;object-fit:contain;object-position:top;background:var(--canvas)}
img.clip{width:auto;max-width:100%}
a:has(img){display:block}
a:has(img):hover{text-decoration:none}
pre{background:var(--canvas);border:.0625rem solid var(--hairline);border-radius:1.125rem;
  padding:1.5rem;overflow-x:auto;font-family:var(--mono);font-size:.875rem;letter-spacing:0;margin:0;
  white-space:pre-wrap}
button{font:500 1.0625rem/1 var(--sans);letter-spacing:-.022em;padding:.6875rem 1.375rem;border:0;
  border-radius:62.4375rem;background:var(--action);color:#fff;cursor:pointer}
@media (prefers-reduced-motion:no-preference){button:active{transform:scale(.95)}}
/* A folded section is a control, so it gets room to be clicked and room to breathe once open. */
details{border-top:.0625rem solid var(--hairline);margin-top:1.5rem;padding-top:.25rem}
details+details{margin-top:.75rem}
summary{cursor:pointer;padding:.75rem 0;font-size:.9375rem;font-weight:500;color:var(--ink);
  letter-spacing:-.011em}
summary::marker{color:var(--ink-muted)}
details[open]>summary{border-bottom:.0625rem solid var(--hairline);margin-bottom:1.5rem}
ul{margin:0;padding-left:1.5rem;display:flex;flex-direction:column;gap:.5rem}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1.5rem;
  border-top:.0625rem solid var(--hairline);padding-top:1.5rem}
.stat b{display:block;font-size:2.5rem;line-height:1.1;font-weight:600;letter-spacing:-.011em}
.stat span{font-size:.875rem;line-height:1.43;letter-spacing:-.016em;color:var(--ink-muted)}
.band.parchment:first-child{padding:7.5rem 1.5rem 6rem}
@media (max-width:52rem){
  .stats{grid-template-columns:repeat(2,1fr)}
  .band.parchment:first-child{padding:4rem 1.25rem 3rem}
  .band{padding:3rem 1.25rem}.two{grid-template-columns:1fr}
  h1{font-size:2.125rem;line-height:1.1}h2{font-size:1.75rem}.lead{font-size:1.3125rem}
}
</style></head>
<body><main>

<section class="band parchment"><div class="inner">
  <p class="sub">QA of ${e(verdict.pr && verdict.pr.repo || '')}${verdict.pr && verdict.pr.number ? ` #${e(verdict.pr.number)}` : ''}${verdict.pr && verdict.pr.title ? ` &middot; ${e(verdict.pr.title)}` : ''}</p>
  <h1><span class="dot ${V.tone}" aria-hidden="true"></span>${e(V.label)}</h1>
  ${verdict.caveat ? `<p class="lead">${e(verdict.caveat)}</p>` : ''}
  ${verdict.why ? `<p>${e(verdict.why)}</p>` : ''}
  ${lead()}
  <div class="stats">${STATS.map(([n, c]) => `<div class="stat"><b>${e(n)}</b><span>${e(c)}</span></div>`).join('')}</div>
  <p class="fine">AI-assisted QA: a person ran this and answered at every gate; an agent ${e(HOW)} and
  recorded what happened. What you see below is that recording, not an illustration. The verdict is
  worth a sanity check before you act on it.</p>
</div></section>

${band('canvas', 'What was tested', null, `<dl>
  ${ENVIRONMENT}
  <dt>Kind</dt><dd>${e(verdict.classification || '')}</dd>
  <dt>Test steps</dt><dd>${e(verdict.stepsFrom || 'not stated')}</dd>
  <dt>before</dt><dd>${e(verdict.states && verdict.states.before || 'not run')}</dd>
  <dt>after</dt><dd>${e(verdict.states && verdict.states.after || 'not run')}</dd>
      ${isBrowser
        ? `<dt>Browser</dt><dd>Chromium via Playwright ${e((after || before || {}).playwright || '')}, viewport ${e(JSON.stringify((after || before || {}).viewport || {}))}</dd>`
        : PROBE === 'cli'
          ? `<dt>Ran in</dt><dd><code translate="no">${e((after || before || {}).cwd || '')}</code>, Node ${e((after || before || {}).node || '')}</dd>`
          : `<dt>Called</dt><dd><code translate="no">${e((after || before || {}).url || '')}</code>, Node ${e((after || before || {}).node || '')}</dd>`}
</dl>`)}

${band('parchment', 'The bug', 'The only checks that can prove or disprove the ticket. Written in the reporter’s words, never in the diff’s.', `
<h3>before: the bug must show</h3>
${before ? rows(['Check', 'Result', '', 'Observed'], bugRows(before, 'before')) : '<p class="sub">Phase not run.</p>'}
<h3>after: the bug must be gone</h3>
${after ? rows(['Check', 'Result', '', 'Observed'], bugRows(after, 'after')) : '<p class="sub">Phase not run.</p>'}`)}

${band('canvas', 'The evidence', evidenceSub(), evidence())}

${isBrowser ? band('dark', 'The runs, recorded', 'Both phases end to end, at the speed they happened.',
  `<div class="two">${video('before', before)}${video('after', after)}</div>`) : ''}

${(((after || {}).surfaces || []).length || ((before || {}).surfaces || []).length)
  ? band('canvas', 'The pages this PR touches',
      'Both sides of the shop, measured in both phases. A page that answered before and fails after is a regression this PR introduced, whatever the bug assertions say.',
      rows(['Surface', 'Verdict', 'before', 'after'], surfaceRows()))
  : ''}

${band('canvas', 'Regression net', 'Checks the ticket never asked for, run in both phases so a finding can be blamed on the PR or cleared of it.', `
<h3>${isBrowser ? 'Pages still work' : PROBE === 'cli' ? 'The declared commands still run' : 'The neighbouring endpoints still answer'}</h3>
${rows([isBrowser ? 'Page' : PROBE === 'cli' ? 'Command' : 'Endpoint', 'Verdict', 'before', 'after'], smokeRows())}
${isBrowser ? `<h3>Narrow viewports, 375 and 768 wide</h3>
${rows(['Viewport and page', 'Verdict', 'before', 'after', 'Boxes sticking out'], netRows())}` : ''}
${isBrowser ? `<p class="sub">Only three things are asserted narrow: the page responds, it renders
visible content, it does not scroll sideways. A cramped price, a two-line button or a stretched
image is not measured. That is what the screenshots below are for.</p>
${(after || before || {}).where === 'bo'
  ? `<p class="sub">The back office is <strong>not</strong> covered narrow. Re-visiting one of its
  pages loses the per-controller token and lands on the login form, so the widths below are the shop,
  not the pages this PR changes.</p>` : ''}
<p class="sub">Click any screenshot to open it full size.</p>
${narrowShots()}` : ''}`)}

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
   <button onclick="navigator.clipboard.writeText(document.getElementById('c').innerText)">Copy</button>`
  // Deliberately outside the block: an instruction to whoever is pasting has no business being
  // pasted. The button copies the comment and nothing else.
  + ((verdict.attach && verdict.attach.length) ? `<h3>Attach these by hand</h3>
   <p class="sub">GitHub cannot take them from a paste. They are in the run directory.</p>
   <ul>${verdict.attach.map((f) => `<li><code translate="no">${e(f)}</code></li>`).join('')}</ul>` : '')) : ''}

<section class="band canvas"><div class="inner">
  <p class="fine">Generated by prestashop-pr-qa. Runner
  <code translate="no">${e(((after || before || {}).runnerSha256 || '').slice(0, 12))}</code>, scenario
  <code translate="no">${e(((after || before || {}).scenarioSha256 || '').slice(0, 12))}</code>. Share the whole
  run directory: this page points at the screenshots and the video next to it.</p>
</div></section>

</main></body></html>`;

// Three bands are conditional (the notes, what was not tested, the comment), so hand-assigned
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
