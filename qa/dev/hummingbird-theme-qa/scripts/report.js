#!/usr/bin/env node
'use strict';
//
// Builds the campaign report, and refuses to build one that claims more than it
// can show.
//
//   node report.js --campaign=<folder> [--artifact=<file>] [--no-verify]
//
// It reads the answers the runs recorded and works out what they mean. It never
// invents a result, and every green it prints names what was checked and points
// at a file that exists.
//
// Exit 0 built, 2 refused or could not build, 64 wrong arguments.

const fs = require('fs');
const path = require('path');

const arg = (name, fallback = null) => {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
};
const has = (name) => process.argv.slice(2).includes(`--${name}`);

const die = (m) => { console.error(m); process.exit(2); };
const e = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Checklist text is Markdown. Escape it first, then give back the two marks it
// actually uses, so `ps_mainmenu` reads as code rather than as stray backticks.
const md = (t) => e(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const CAMPAIGN = path.resolve(arg('campaign', '.'));
if (!fs.existsSync(CAMPAIGN)) die(`no campaign folder at ${CAMPAIGN}`);

const read = (f, what) => {
  const p = path.join(CAMPAIGN, f);
  if (!fs.existsSync(p)) die(`no ${f} in ${CAMPAIGN}. ${what}`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    die(`${f} in ${CAMPAIGN} is not readable JSON: ${String((err && err.message) || err)}`);
  }
};

const campaign = read('campaign.json', 'It carries what was tested and what was found. Write it first: this only renders it.');
const checklist = read('checklist.json', 'Run checklist.js first: the checklist decides what the campaign answers for.');

// ------------------------------------------------------------------ the answers
//
// One folder per section, per label, per matrix cell.
const runs = [];
const suitesDir = path.join(CAMPAIGN, 'suites');
if (fs.existsSync(suitesDir)) {
  for (const section of fs.readdirSync(suitesDir)) {
    const sdir = path.join(suitesDir, section);
    if (!fs.statSync(sdir).isDirectory()) continue;
    for (const label of fs.readdirSync(sdir)) {
      const ldir = path.join(sdir, label);
      if (label.startsWith('.') || !fs.statSync(ldir).isDirectory()) continue;
      for (const cell of fs.readdirSync(ldir)) {
        const file = path.join(ldir, cell, 'run.json');
        if (!fs.existsSync(file)) continue;
        let run;
        try {
          run = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
          die(`suites/${section}/${label}/${cell}/run.json is not readable JSON: ${String((err && err.message) || err)}`);
        }
        run._dir = path.join('suites', section, label, cell);
        run._section = section;
        run._label = label;
        // What backs this answer up, as paths inside the campaign folder. A check
        // that named a file uses that file; a check that named none leans on the
        // screenshot its step took, which is why every check belongs inside a
        // step. An answer with neither is an answer with nothing behind it, and
        // verify() below refuses to print it as settled.
        for (const o of run.observations || []) {
          const named = (o.evidence || []).filter(Boolean).map((ev) => path.join(run._dir, ev));
          if (named.length) { o._proof = named; continue; }
          const st = (run.steps || []).find((x) => Number(x.n) === Number(o.step));
          // A step that threw was photographed after it broke, so its picture is
          // of the wreckage and says nothing about the checks that ran before
          // the throw. It does not stand as proof for them.
          o._proof = st && st.shot && !st.threw ? [path.join(run._dir, st.shot)] : [];
        }
        runs.push(run);
      }
    }
  }
}
const passRuns = runs.filter((r) => r._label === 'pass');

// ------------------------------------------------------------------ what it means
const items = checklist.sections.flatMap((s) =>
  s.items.map((i) => ({ ...i, section: s.id, sectionTitle: s.title })));
const byId = new Map(items.map((i) => [i.id, i]));

const matrix = campaign.matrix || { profiles: ['b2c'], viewports: ['desktop'] };
const allCells = matrix.profiles.flatMap((p) => matrix.viewports.map((v) => `${p}/${v}`));

const inScope = (item) => {
  const scope = campaign.scope && campaign.scope.sections;
  if (!scope || !scope.length) return true;
  return scope.some((s) => item.section === s || item.section.startsWith(`${s}.`));
};

// The rollup, stated once and applied everywhere. It is computed, never taken
// from a file, so nobody can write a green that its own answers do not support.
const ORDER = ['fail', 'inconclusive', 'needs-human', 'pass'];
function rollUp(item) {
  const seen = [];
  for (const run of passRuns) {
    for (const o of run.observations || []) {
      if (o.item !== item.id) continue;
      seen.push({ ...o, cell: `${run.profile}/${run.viewport}`, dir: run._dir });
    }
  }
  const cells = [...new Set(seen.map((o) => o.cell))];
  const missing = allCells.filter((c) => !cells.includes(c));
  const outcomes = new Set(seen.map((o) => o.outcome));

  let state;
  if (!seen.length) state = 'not-covered';
  else if (outcomes.has('fail')) state = 'fail';
  else if (outcomes.has('inconclusive')) state = 'partial';
  // A point nobody attempted is not a point that held. Without this branch a
  // point skipped on every cell falls through to 'pass' and is counted as
  // settled, which is the one claim this report promises never to make.
  else if (outcomes.has('skipped')) state = 'partial';
  else if (outcomes.has('needs-human')) state = 'needs-human';
  else if (missing.length) state = 'partial';
  else state = 'pass';

  const witnesses = [...new Set(seen.map((o) => o.by))];
  return { item, seen, cells, missing, state, witnesses };
}

const ledger = items.filter(inScope).map(rollUp);
const outOfScope = items.filter((i) => !inScope(i));

const count = (s) => ledger.filter((l) => l.state === s).length;
const headline = {
  settled: count('pass') + count('fail'),
  awaitingAPerson: count('needs-human'),
  notCovered: count('not-covered'),
  partly: count('partial'),
  inScope: ledger.length,
  outOfScope: outOfScope.length,
};

// ---------------------------------------------------------------------- verify
//
// A report that claims a point was tested and cannot show the proof is worse
// than one that admits a gap, so these stop the build rather than warn.
function verify() {
  const problems = [];
  for (const run of runs) {
    for (const o of run.observations || []) {
      if (!byId.has(o.item)) {
        problems.push(`${run._dir}: an answer names ${o.item}, which is not in this checklist`);
      }
      if (o.outcome === 'pass' && !o.assertion) {
        problems.push(`${run._dir}: ${o.item} is recorded as passing without saying what was checked`);
      }
      // Every green points at a file. Either the check named one, or it ran
      // inside a step and the picture of that step stands for it. Neither is a
      // green nobody can look at, which is the one thing this report promises
      // never to print.
      if (o.outcome === 'pass' && !(o._proof || []).some((f) => fs.existsSync(path.join(CAMPAIGN, f)))) {
        problems.push((o._proof || []).length
          ? `${run._dir}: ${o.item} is recorded as passing and the file behind it, ${path.basename(o._proof[0])}, is not there`
          : `${run._dir}: ${o.item} is recorded as passing with nothing to show for it. Run the check inside a step, so its screenshot stands for it, or name a file`);
      }
      for (const ev of o.evidence || []) {
        if (!fs.existsSync(path.join(CAMPAIGN, run._dir, ev))) {
          problems.push(`${run._dir}: ${o.item} points at ${ev}, which is not there`);
        }
      }
    }
    for (const s of run.steps || []) {
      if (s.shot && !fs.existsSync(path.join(CAMPAIGN, run._dir, s.shot))) {
        problems.push(`${run._dir}: step ${s.n} points at ${s.shot}, which is not there`);
      }
    }
    // Checking only a sha that is present catches nothing: the campaign that
    // drifts is the one where nobody passed --checklist-sha at all.
    if (!run.checklistSha256) {
      problems.push(`${run._dir}: this run never said which revision of the checklist it answered. Pass --checklist-sha, so a checklist that moves mid-campaign cannot go unnoticed`);
    } else if (checklist.sha256 && run.checklistSha256 !== checklist.sha256) {
      problems.push(`${run._dir}: this run answered a different revision of the checklist (${String(run.checklistSha256).slice(0, 12)}), not the one in checklist.json (${String(checklist.sha256).slice(0, 12)})`);
    }
    const open = (run.settingsChanged || []).filter((s) => s.state !== 'restored');
    for (const s of open) {
      problems.push(`${run._dir}: ${s.setting} was changed to ${s.set} and never confirmed back at ${s.was}`);
    }
    for (const f of run.fixtures || []) {
      if (f.state === 'present' || f.state === 'removal-failed') {
        problems.push(`${run._dir}: the made-up ${f.what} is still in the shop, neither removed nor deliberately left with a reason`);
      }
    }
  }
  for (const c of campaign.checklistCorrections || []) {
    if (!c.item || !byId.has(c.item)) {
      problems.push(`a checklist correction names ${c.item || '(nothing)'}, which is not in this checklist`);
    }
    if (!c.problem) problems.push(`the checklist correction for ${c.item} does not say what is wrong with the point`);
  }
  for (const f of campaign.findings || []) {
    for (const ev of f.evidence || []) {
      if (!fs.existsSync(path.join(CAMPAIGN, ev))) {
        problems.push(`finding ${f.id} points at ${ev}, which is not there`);
      }
    }
    for (const it of f.items || []) {
      if (!byId.has(it)) problems.push(`finding ${f.id} names ${it}, which is not in this checklist`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------- the gaps
//
// What is still unanswered, as a file rather than as a sentence in a log, so a
// campaign can be driven to the end without a person reading the report each
// time: run, read this, write the suites it names, run again, until it is empty.
// A point that failed, or that is waiting for a person, is still owed the cells
// nobody ran it on: rollUp names the worst thing that happened, not how much of
// the matrix it happened on. Counting only the 'partial' state here would let a
// campaign that ran one cell of four build as complete.
// 'partial' is what an answer of inconclusive or skipped rolls up to, and such a
// point has been visited without being settled. Owing only the unvisited and the
// half-visited would let a campaign that skipped a point on every cell build as
// complete, which is the same hole as counting a skip as a pass.
const stillOwed = (l) => l.state === 'not-covered' || l.missing.length > 0 || l.state === 'partial';
const gaps = {
  builtAt: new Date().toISOString(),
  cells: allCells,
  notCovered: ledger.filter((l) => l.state === 'not-covered')
    .map((l) => ({ item: l.item.id, section: l.item.section, text: l.item.text })),
  partlyCovered: ledger.filter((l) => l.state !== 'not-covered' && (l.missing.length || l.state === 'partial'))
    .map((l) => ({ item: l.item.id, section: l.item.section, text: l.item.text,
                   state: l.state, ranOn: l.cells,
                   missingCells: l.missing, outcomes: [...new Set(l.seen.map((o) => o.outcome))] })),
  waitingForAPerson: ledger.filter((l) => l.state === 'needs-human')
    .map((l) => ({ item: l.item.id, section: l.item.section, text: l.item.text,
                   look: [...new Set(l.seen.flatMap((o) => o._proof || []))] })),
  outOfScope: outOfScope.map((i) => i.id),
};
fs.writeFileSync(path.join(CAMPAIGN, 'gaps.json'), JSON.stringify(gaps, null, 2) + '\n');

if (has('require-complete')) {
  const owed = ledger.filter(stillOwed)
    .map((l) => ({ item: l.item.id, text: l.item.text, missingCells: l.missing }));
  if (owed.length) {
    console.error(`refusing to build: ${owed.length} point(s) in scope are not settled on every cell yet,`);
    console.error('and this campaign was asked for a complete one. A point counts as owed when it was');
    console.error('never run, when a cell of the matrix never saw it, or when what came back was');
    console.error('inconclusive or skipped, which is a visit rather than an answer. The first few:\n');
    for (const g of owed.slice(0, 15)) {
      console.error(`  ${g.item}  ${g.text.slice(0, 60)}${g.missingCells.length ? `  (never run on ${g.missingCells.join(', ')})` : ''}`);
    }
    if (owed.length > 15) console.error(`  ... and ${owed.length - 15} more`);
    console.error(`\nThe full list is in ${path.join(CAMPAIGN, 'gaps.json')}. Answer them, then build again.`);
    process.exit(2);
  }
}

if (!has('no-verify')) {
  const problems = verify();
  if (problems.length) {
    console.error('refusing to build the report, because it would claim more than it can show:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\n${problems.length} problem(s). Fix them, or pass --no-verify to see the report anyway,`);
    console.error('knowing it is not trustworthy.');
    process.exit(2);
  }
}

// ------------------------------------------------------------------- rendering
const SEV = { blocker: 'blocker', major: 'major', minor: 'minor' };
const KIND_WORDS = {
  regression: 'Regression', 'pre-existing': 'Bug', 'never-implemented': 'Gap', unknown: 'Not settled',
};
const STATE_WORDS = {
  pass: 'settled, holds', fail: 'settled, does not hold', 'needs-human': 'waiting for a person',
  partial: 'not fully covered', 'not-covered': 'not covered',
};

// "sections 1 and 2" rather than "1, 2": the report is read by people who did
// not run it.
const listWords = (a) => a.length <= 1 ? (a[0] || '')
  : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

const findings = (campaign.findings || []).slice().sort((a, b) => {
  // Anything not one of the three words sorts last rather than first: an
  // unrecognised severity is not more urgent than a blocker.
  const rank = (f) => {
    const i = ['blocker', 'major', 'minor'].indexOf(String(f.severity || 'minor').toLowerCase());
    return i < 0 ? 3 : i;
  };
  return rank(a) - rank(b);
});

const sourceLine = () => {
  const s = checklist.source || {};
  if (s.kind === 'tag') return `read from the release tag <code>${e(s.ref)}</code>`;
  if (s.kind === 'working-copy') {
    return `read from the working copy${s.ref ? ` on <code>${e(s.ref)}</code>` : ''}, not from a release tag, so it can move`;
  }
  return `read from <code>${e(s.ref || s.rev || 'a ref that is not a tag')}</code>, which is not a release tag, so it can move`;
};

// What a reader can actually open for this point: the files the checks named,
// and failing that the picture of the step each check ran in.
const evidenceFor = (l) => {
  const files = [];
  for (const o of l.seen) for (const f of o._proof || []) files.push(f);
  return [...new Set(files)];
};

// Two hundred rows in one block is a wall nobody reads to the end of. One block
// per checklist section, each saying up front how its own points came out, so a
// section that went badly is visible without reading every line of it.
function proofRows() {
  const bySection = new Map();
  for (const l of ledger) {
    if (!bySection.has(l.item.section)) bySection.set(l.item.section, []);
    bySection.get(l.item.section).push(l);
  }

  const row = (l) => {
    const said = l.seen.find((o) => o.assertion) || l.seen.find((o) => o.detail) || l.seen[0];
    const what = said ? (said.assertion || said.detail || said.reason) : '';
    const files = evidenceFor(l);
    return `<tr class="point s-${l.state}">
      <td><code>${e(l.item.id)}</code></td>
      <td>${md(l.item.text)}</td>
      <td class="n">${l.cells.length}/${allCells.length}</td>
      <td>${e(what || (l.state === 'not-covered' ? 'nothing looked at this' : ''))}</td>
      <td>${l.witnesses.map((w) => `<span class="w">${e(w)}</span>`).join(' ') || '&mdash;'}</td>
      <td class="n">${files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : '&mdash;'}</td>
      <td><span class="tag t-${l.state}">${e(STATE_WORDS[l.state])}</span></td>
    </tr>`;
  };

  return [...bySection.entries()].map(([id, rows]) => {
    const title = rows[0].item.sectionTitle || '';
    const unsettled = ['needs-human', 'partial', 'not-covered']
      .map((state) => [state, rows.filter((l) => l.state === state).length])
      .filter(([, n]) => n > 0);
    const settledHere = rows.filter((l) => l.state === 'pass' || l.state === 'fail').length;
    return `<tbody>
      <tr class="sec"><th colspan="7" scope="colgroup">
        <span class="sec-id">${e(id)}</span> ${e(title)}
        <span class="sec-n">${settledHere} of ${rows.length} settled${
          unsettled.map(([st, n]) => `, ${n} ${STATE_WORDS[st]}`).join('')}</span>
      </th></tr>
      ${rows.map(row).join('\n')}
    </tbody>`;
  }).join('\n');
}

// The shape of the campaign in one line: how much of the checklist ended in each
// state. Counts, never a percentage, and never one figure standing for the lot:
// a bar with a grey half is telling the truth about itself, which is the whole
// job of this page.
function coverageBar() {
  const parts = [
    ['pass', 'settled, holds'],
    ['fail', 'settled, does not hold'],
    ['needs-human', 'waiting for a person'],
    ['partial', 'not fully covered'],
    ['not-covered', 'not covered'],
  ].map(([state, words]) => [state, words, count(state)]).filter(([, , n]) => n > 0);
  if (!parts.length) return '';
  const label = parts.map(([, words, n]) => `${n} ${words}`).join(', ');
  return `<div class="bar" role="img" aria-label="Of ${ledger.length} checklist points in scope: ${e(label)}">
  ${parts.map(([state, words, n]) => `<span class="b-${state}" style="flex:${n}" title="${e(`${n} ${words}`)}"></span>`).join('')}
</div>
<ul class="legend">${parts.map(([state, words, n]) =>
  `<li><i class="b-${state}"></i><b>${n}</b> ${e(words)}</li>`).join('')}</ul>`;
}

function findingCards(inlineImages) {
  if (!findings.length) return '<p class="none">Nothing was found. That is only as strong as the coverage above.</p>';
  return findings.map((f) => {
    const shots = (f.evidence || []).map((ev) => {
      const caption = `<figcaption>${e(path.basename(ev))}</figcaption>`;
      // A finding often leans on the recording of its section, and a recording
      // is not an image: shown in an <img> it is a broken picture that also eats
      // the whole size budget of the published page.
      // The published page cannot reach this machine, so anything it cannot carry
      // inside itself is named rather than linked into a dead end. The local
      // report, sitting next to the files, plays and links them.
      if (/\.(webm|mp4)$/i.test(ev)) {
        return inlineImages
          ? `<figure class="file">The recording <code>${e(ev)}</code> is in the campaign folder, not in this page.</figure>`
          : `<figure><video controls preload="metadata" src="${e(ev)}"></video>${caption}</figure>`;
      }
      if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(ev)) {
        return inlineImages
          ? `<figure class="file">${e(path.basename(ev))} is in the campaign folder, not in this page.</figure>`
          : `<figure class="file"><a href="${e(ev)}">${e(path.basename(ev))}</a>${caption}</figure>`;
      }
      const src = inlineImages ? inlineImages(ev) : ev;
      return src ? `<figure><img loading="lazy" src="${src}" alt=""><figcaption>${e(path.basename(ev))}</figcaption></figure>` : '';
    }).join('');
    const hist = KIND_WORDS[f.history] || 'Not settled';
    return `<article class="finding sev-${e(f.severity || 'minor')}">
      <h3><span class="sev">${e(SEV[f.severity] || 'minor')}</span> ${e(f.title)}</h3>
      <dl class="meta">
        <div><dt>Kind</dt><dd>${e(f.kind || 'not said')}</dd></div>
        <div><dt>History</dt><dd>${e(hist)}</dd></div>
        <div><dt>Belongs to</dt><dd>${e(f.repo || f.layer || 'not said')}</dd></div>
        <div><dt>Checklist</dt><dd>${(f.items || []).map((i) => `<code>${e(i)}</code>`).join(' ') || '&mdash;'}</dd></div>
        <div><dt>Where</dt><dd>${e([f.where && f.where.page, f.where && f.where.profile, f.where && f.where.viewport].filter(Boolean).join(', ') || 'not said')}</dd></div>
      </dl>
      ${f.steps ? `<h4>Steps, from a clean cart and session</h4><ol>${f.steps.map((s) => `<li>${e(s)}</li>`).join('')}</ol>` : ''}
      <div class="two">
        <div><h4>Expected</h4><p>${e(f.expected || 'not said')}</p></div>
        <div><h4>Actual</h4><p>${e(f.actual || 'not said')}</p></div>
      </div>
      ${f.severityReason ? `<p class="why">Rated ${e(f.severity)} because ${e(f.severityReason)}</p>` : ''}
      ${shots ? `<div class="shots">${shots}</div>` : ''}
    </article>`;
  }).join('\n');
}

const STYLE = `
:root{--ink:#1d1d1f;--muted:#6b6b70;--line:#e3e3e6;--bg:#fff;--panel:#f6f6f8;
--ok:#1d7a46;--bad:#c0233c;--look:#8a5a00;--flat:#6b6b70;--action:#0a5bd3}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#f2f2f4;--muted:#a1a1a8;
--line:#333338;--bg:#141416;--panel:#1d1d20;--ok:#4cc98a;--bad:#ff7a8f;--look:#e0a640;--action:#6aa9ff}}
:root[data-theme="dark"]{--ink:#f2f2f4;--muted:#a1a1a8;--line:#333338;--bg:#141416;--panel:#1d1d20;
--ok:#4cc98a;--bad:#ff7a8f;--look:#e0a640;--action:#6aa9ff}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.55 system-ui,-apple-system,"Segoe UI",Inter,sans-serif}
.wrap{max-width:74rem;margin:0 auto;padding-block:2.5rem;padding-left:1.25rem;padding-right:1.25rem}
h1{font-size:2rem;line-height:1.15;margin:0 0 .35em}
h2{font-size:1.35rem;margin:2.5rem 0 .6rem;padding-top:1.4rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:0 0 .5rem}h4{font-size:.85rem;text-transform:uppercase;
letter-spacing:.06em;color:var(--muted);margin:1rem 0 .3rem}
p{margin:.4rem 0}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.87em}
.lede{color:var(--muted);margin-bottom:1.5rem}
.toc{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-size:.85rem;margin:1.2rem 0 0;padding:0;list-style:none}
.toc a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent;padding-bottom:1px}
.toc a:hover,.toc a:focus{color:var(--ink);border-bottom-color:var(--line)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.75rem;margin:1.5rem 0 1rem}
/* The shape of the campaign, in counts. Never one figure: a bar with a grey
   half is the page telling the truth about itself. */
.bar{display:flex;height:.7rem;border-radius:.35rem;overflow:hidden;border:1px solid var(--line)}
.bar span{display:block;min-width:2px}
.b-pass{background:var(--ok)}.b-fail{background:var(--bad)}
.b-needs-human{background:var(--look)}
.b-partial{background:color-mix(in srgb,var(--flat) 55%,transparent)}
.b-not-covered{background:color-mix(in srgb,var(--flat) 20%,transparent)}
.legend{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;font-size:.82rem;color:var(--muted);
margin:.6rem 0 2rem;padding:0;list-style:none}
.legend li{display:flex;align-items:center;gap:.4rem}
.legend i{width:.65rem;height:.65rem;border-radius:.2rem;border:1px solid var(--line);flex:0 0 auto}
.legend b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
.filter{display:flex;flex-wrap:wrap;gap:.4rem;margin:.8rem 0}
.filter button{font:inherit;font-size:.8rem;color:var(--muted);background:var(--bg);
border:1px solid var(--line);border-radius:.3rem;padding:.15rem .6rem;cursor:pointer}
.filter button:hover{color:var(--ink)}
.filter button[aria-pressed="true"]{background:var(--panel);color:var(--ink);border-color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1rem}
.card b{display:block;font-size:2rem;line-height:1.1;font-weight:600}
.card span{color:var(--muted);font-size:.85rem}
dl.env{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.4rem 1.5rem;margin:0}
dl.env div{border-bottom:1px solid var(--line);padding:.35rem 0}
dl.env dt{color:var(--muted);font-size:.8rem}dl.env dd{margin:0}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:.6rem}
table{border-collapse:collapse;width:100%;font-size:.87rem;min-width:52rem}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--panel);font-size:.78rem;text-transform:uppercase;
letter-spacing:.05em;color:var(--muted)}
td.n{white-space:nowrap;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
tr.s-fail td:nth-child(2){font-weight:600}
/* One block per checklist section, each with its own tally, so a long table is
   read in pieces rather than scrolled past. */
tr.sec th{position:static;background:var(--bg);border-bottom:1px solid var(--muted);
padding-top:1.1rem;text-transform:none;font-size:.85rem;letter-spacing:0;color:var(--ink)}
tbody:first-of-type tr.sec th{padding-top:.5rem}
.sec-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);margin-right:.3rem}
.sec-n{float:right;font-weight:400;color:var(--muted);font-size:.78rem;
font-variant-numeric:tabular-nums}
.tag{display:inline-block;padding:.1rem .45rem;border-radius:.3rem;font-size:.75rem;white-space:nowrap}
.t-pass{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}
.t-fail{background:color-mix(in srgb,var(--bad) 18%,transparent);color:var(--bad)}
.t-needs-human{background:color-mix(in srgb,var(--look) 20%,transparent);color:var(--look)}
.t-partial,.t-not-covered{background:color-mix(in srgb,var(--flat) 18%,transparent);color:var(--muted)}
.w{font-size:.72rem;color:var(--muted);border:1px solid var(--line);border-radius:.3rem;padding:0 .3rem}
.finding{border:1px solid var(--line);border-left:.25rem solid var(--flat);border-radius:.6rem;
padding:1rem 1.2rem;margin:1rem 0;background:var(--panel)}
.sev-blocker{border-left-color:var(--bad)}.sev-major{border-left-color:var(--look)}
.sev{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;
border:1px solid currentColor;border-radius:.3rem;padding:0 .35rem;margin-right:.5rem;vertical-align:.12em}
.sev-blocker .sev{color:var(--bad)}.sev-major .sev{color:var(--look)}.sev-minor .sev{color:var(--muted)}
dl.meta{display:flex;flex-wrap:wrap;gap:.3rem 1.5rem;margin:.5rem 0}
dl.meta dt{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}
dl.meta dd{margin:0;font-size:.9rem}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:0 1.5rem}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:.75rem;margin-top:1rem}
.shots figure{margin:0}.shots img,.shots video{width:100%;border:1px solid var(--line);border-radius:.4rem;display:block}
.shots figure.file{background:var(--bg);border:1px solid var(--line);border-radius:.4rem;padding:.6rem .8rem}
.shots figure.file a{color:var(--action)}
.shots figcaption{font-size:.72rem;color:var(--muted);margin-top:.25rem;word-break:break-all}
.none{color:var(--muted)}
.warn{border:1px solid var(--look);background:color-mix(in srgb,var(--look) 10%,transparent);
border-radius:.6rem;padding:.8rem 1rem;margin:1rem 0}
ul.plain{margin:.4rem 0;padding-left:1.1rem}
footer{margin-top:3rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
@media(max-width:40rem){h1{font-size:1.5rem}.card b{font-size:1.5rem}.sec-n{float:none;display:block}}
/* A QA report gets printed and passed around. */
@media print{
  :root{--bg:#fff;--ink:#000;--panel:#fff;--line:#bbb;--muted:#555}
  .toc,.filter{display:none}
  .scroll{overflow:visible;border:0}
  table{min-width:0;font-size:.7rem}
  thead th{position:static}
  h2{break-after:avoid}
  .finding,.card,tr{break-inside:avoid}
  a{color:inherit;text-decoration:none}
}
`;

// The table is complete without this: the buttons only appear once it has run,
// and all it ever does is hide rows that are already settled and holding.
const FILTER_SCRIPT = `
(function () {
  var bar = document.getElementById('proof-filter');
  var table = document.getElementById('proof');
  if (!bar || !table) return;
  bar.hidden = false;
  bar.addEventListener('click', function (ev) {
    var pressed = ev.target.closest('button[data-filter]');
    if (!pressed) return;
    var onlyOpen = pressed.getAttribute('data-filter') === 'open';
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b === pressed));
    });
    Array.prototype.forEach.call(table.querySelectorAll('tbody'), function (group) {
      var shown = 0;
      Array.prototype.forEach.call(group.querySelectorAll('tr.point'), function (row) {
        var keep = !onlyOpen || !row.classList.contains('s-pass');
        row.hidden = !keep;
        if (keep) shown++;
      });
      group.hidden = shown === 0;
    });
  });
})();
`;

function bodyHtml(inlineImages) {
  const th = campaign.theme || {};
  const shop = campaign.shop || {};
  const envRows = [
    ['Theme', [th.version, th.ref, th.commit && th.commit.slice(0, 8)].filter(Boolean).join(' · ')],
    ['PrestaShop', shop.prestashop],
    ['Front office', shop.front],
    ['Back office', shop.back],
    ['How it runs', shop.install],
    ['Profiles and widths', allCells.join(', ')],
    ['Checklist', `${checklist.counts ? `${checklist.counts.total} points, ` : ''}${sourceLine()}`],
    ['Sections run', listWords((campaign.scope && campaign.scope.sections) || []) || 'all of them'],
  ].filter(([, v]) => v);

  const narrowed = campaign.scope && campaign.scope.sections && campaign.scope.sections.length;
  const settingsOpen = runs.flatMap((r) => (r.settingsChanged || []).filter((s) => s.state !== 'restored'));

  return `
<div class="wrap">
<h1>Hummingbird test campaign</h1>
<p class="lede">${e(campaign.campaign || '')} Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.</p>
<ul class="toc">
  <li><a href="#tested">What was tested</a></li>
  <li><a href="#found">What was found</a></li>
  <li><a href="#proof-of-test">Proof of test</a></li>
  <li><a href="#made-up">Data made up</a></li>
  <li><a href="#settings">Shop settings</a></li>
  <li><a href="#faults">Faults</a></li>
  <li><a href="#not-tested">Not tested</a></li>
</ul>

${narrowed ? `<div class="warn"><strong>This was not the whole checklist.</strong> Only section${campaign.scope.sections.length > 1 ? 's' : ''} ${e(listWords(campaign.scope.sections))} ${campaign.scope.sections.length > 1 ? 'were' : 'was'} run${campaign.scope.why ? `, because ${e(campaign.scope.why)}` : ''}. ${headline.outOfScope} point${headline.outOfScope === 1 ? '' : 's'} of the checklist ${headline.outOfScope === 1 ? 'was' : 'were'} left out of this report entirely.</div>` : ''}

${checklist.source && checklist.source.kind !== 'tag' ? `<div class="warn">The checklist was ${sourceLine().replace(/<\/?code>/g, '')}. A checklist taken from a release tag is the same for everyone; one taken from a branch can change under you.</div>` : ''}

<div class="cards">
  <div class="card"><b>${headline.settled}</b><span>settled by a check</span></div>
  <div class="card"><b>${headline.awaitingAPerson}</b><span>waiting for a person</span></div>
  <div class="card"><b>${headline.partly}</b><span>not fully covered</span></div>
  <div class="card"><b>${headline.notCovered}</b><span>not covered at all</span></div>
  <div class="card"><b>${findings.length}</b><span>thing${findings.length === 1 ? '' : 's'} found</span></div>
</div>
${coverageBar()}

<h2 id="tested">What was tested</h2>
<dl class="env">${envRows.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${k === 'Checklist' ? v : e(v)}</dd></div>`).join('')}</dl>

<h2 id="found">What was found</h2>
${findingCards(inlineImages)}

<h2 id="corrections">Checklist corrections to propose</h2>
${(campaign.checklistCorrections || []).length
  ? `<p class="lede">These points describe something that is no longer true. They are not defects of the theme, and they are deliberately not counted as findings: the fix is a line in <code>docs/qa/testing-checklist.md</code>, in the same repository as the theme.</p>
     <div class="scroll"><table>
     <thead><tr><th>Point</th><th>What it says today</th><th>What is wrong with it</th><th>Proposed</th></tr></thead>
     <tbody>${campaign.checklistCorrections.map((c) => `<tr>
       <td><code>${e(c.item)}</code></td>
       <td>${md((byId.get(c.item) || {}).text || '')}</td>
       <td>${e(c.problem)}</td>
       <td>${e(c.proposed || 'not drafted')}</td></tr>`).join('')}</tbody></table></div>`
  : '<p class="none">No checklist point turned out to be wrong.</p>'}

<h2 id="proof-of-test">Proof of test</h2>
<p class="lede">One line per checklist point: what was actually checked, on how many of the ${allCells.length} profile and width combinations, who says so, and how many files back it up. This report will not build if a line here claims a check whose evidence is missing.</p>
<div class="filter" id="proof-filter" hidden>
  <button type="button" data-filter="all" aria-pressed="true">Everything</button>
  <button type="button" data-filter="open" aria-pressed="false">Only what is not settled and holding</button>
</div>
<div class="scroll"><table id="proof">
<thead><tr><th>Point</th><th>What the checklist asks</th><th>Cells</th><th>What was checked</th><th>Said by</th><th>Proof</th><th>Result</th></tr></thead>
${proofRows()}
</table></div>

<h2 id="made-up">Data made up for the test</h2>
${(() => {
  const all = runs.flatMap((r) => (r.fixtures || []).map((f) => ({ ...f, where: r._dir })));
  if (!all.length) return '<p class="none">Nothing was made up. Everything tested used the data the shop already had.</p>';
  const left = all.filter((f) => f.state === 'left');
  return `<p class="lede">Records created so a checklist point could be tested at all. Anything still in the shop is listed as such: a reader comparing this shop with another needs to know what is not theirs.</p>
  <div class="scroll"><table>
  <thead><tr><th>What</th><th>Why it was needed</th><th>How</th><th>Now</th></tr></thead>
  <tbody>${all.map((f) => `<tr>
    <td>${e(f.what)}${f.id ? ` <code>${e(f.id)}</code>` : ''}</td>
    <td>${e(f.why)}</td>
    <td>${e(f.how || 'not said')}</td>
    <td><span class="tag t-${f.state === 'removed' ? 'pass' : f.state === 'left' ? 'needs-human' : 'fail'}">${
      f.state === 'removed' ? 'removed' : f.state === 'left' ? `left: ${e(f.leftBehindReason)}` : e(f.state)}</span></td>
  </tr>`).join('')}</tbody></table></div>
  ${left.length ? `<p class="lede">${left.length} record${left.length === 1 ? ' is' : 's are'} still in the shop on purpose. The next campaign will find ${left.length === 1 ? 'it' : 'them'}.</p>` : ''}`;
})()}

<h2 id="settings">Shop settings</h2>
${settingsOpen.length
  ? `<div class="warn"><strong>The shop was left changed.</strong><ul class="plain">${settingsOpen.map((s) => `<li><code>${e(s.setting)}</code> set to ${e(s.set)}, was ${e(s.was)}</li>`).join('')}</ul></div>`
  : '<p class="none">No section reported a shop-wide setting left changed.</p>'}

<h2 id="faults">What went wrong in the runs themselves</h2>
${(() => {
  const faults = runs.flatMap((r) => (r.harness || []).map((h) => ({ where: r._dir, what: h })));
  if (!faults.length) return '<p class="none">Every run finished the way it was meant to.</p>';
  return `<div class="warn"><strong>Some runs did not go cleanly.</strong> These are faults in the testing, not defects of the theme, and anything they touched is worth reading twice.</div>
  <ul class="plain">${faults.map((f) => `<li><code>${e(f.where)}</code> ${e(f.what)}</li>`).join('')}</ul>`;
})()}

<h2 id="not-tested">What was not tested</h2>
<ul class="plain">
${ledger.filter((l) => l.state === 'not-covered').map((l) => `<li><code>${e(l.item.id)}</code> ${md(l.item.text)}</li>`).join('') || '<li class="none">Every point in scope was looked at.</li>'}
${outOfScope.length ? `<li>${outOfScope.length} more point${outOfScope.length === 1 ? '' : 's'} in sections that were not run.</li>` : ''}
${(campaign.notTested || []).map((t) => `<li>${e(t)}</li>`).join('')}
</ul>

<footer>
Built from the answers recorded in this campaign folder, not from anyone's account of them.
Checklist ${e((checklist.sha256 || '').slice(0, 12))}.
</footer>
</div>
<script>${FILTER_SCRIPT}</script>`;
}

// -------------------------------------------------------------------- writing
const full = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hummingbird test campaign</title><style>${STYLE}</style></head><body>
${bodyHtml(null)}
</body></html>`;

fs.writeFileSync(path.join(CAMPAIGN, 'report.html'), full);
console.error(`report.html written in ${CAMPAIGN}`);

// The publishable form carries its pictures inside it, because a published page
// cannot reach files on this machine. That has a size limit, so the budget is
// spent on the findings and what is left out is said rather than hidden.
if (arg('artifact')) {
  // The page is capped at 16 MB once published, and a picture carried inside it
  // is base64, which is a third larger than the file on disk. Budget what the
  // page will weigh, not what the folder weighs, or a full campaign builds a
  // page too big to publish.
  const BUDGET = 13 * 1024 * 1024;
  let spent = 0;
  const left = [];
  const inline = (rel) => {
    const p = path.join(CAMPAIGN, rel);
    if (!fs.existsSync(p)) return null;
    const b = fs.readFileSync(p);
    const encoded = Math.ceil(b.length / 3) * 4;
    if (spent + encoded > BUDGET) { left.push(rel); return null; }
    spent += encoded;
    const type = /\.png$/i.test(p) ? 'image/png'
      : /\.webp$/i.test(p) ? 'image/webp'
      : /\.gif$/i.test(p) ? 'image/gif'
      : /\.avif$/i.test(p) ? 'image/avif' : 'image/jpeg';
    return `data:${type};base64,${b.toString('base64')}`;
  };
  let frag = `<title>Hummingbird test campaign</title><style>${STYLE}</style>${bodyHtml(inline)}`;
  if (left.length) {
    frag = frag.replace('<footer>', `<div class="warn">${left.length} screenshot${left.length === 1 ? '' : 's'} could not be carried into this page, which has a size limit. They are in the campaign folder.</div><footer>`);
  }
  const dest = path.resolve(CAMPAIGN, arg('artifact'));
  fs.writeFileSync(dest, frag);
  console.error(`publishable page written to ${dest} (${(spent / 1048576).toFixed(1)} MB of pictures inside it${left.length ? `, ${left.length} left out` : ''})`);
}

console.error('');
console.error(`${headline.settled} settled, ${headline.awaitingAPerson} waiting for a person, ${headline.partly} partly covered, ${headline.notCovered} not covered`);
if (gaps.notCovered.length || gaps.partlyCovered.length) {
  console.error(`${gaps.notCovered.length + gaps.partlyCovered.length} point(s) still owed an answer, listed in ${path.join(CAMPAIGN, 'gaps.json')}`);
}
if (outOfScope.length) console.error(`${outOfScope.length} points are in sections this campaign did not run`);
process.stdout.write(path.join(CAMPAIGN, 'report.html') + '\n');
