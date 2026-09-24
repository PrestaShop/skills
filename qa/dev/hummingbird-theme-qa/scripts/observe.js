#!/usr/bin/env node
'use strict';
//
// Records one answer to one checklist point that no browser made: something a
// command decided, or something a person looked at and judged.
//
//   node observe.js --out=<campaign>/suites/1 --label=pass --profile=b2c --viewport=desktop \
//     --item=1.1/02 --outcome=pass --by=command \
//     --assertion='the linters and Prettier both finished clean' \
//     --evidence=lint.txt
//
// A pass always names the file that shows it. The browser's passes lean on the
// screenshot of the step they ran in; this one has no step, so it carries its
// own proof.
//
// It goes through the same door as everything the browser records, so the report
// counts it the same way and shows who said it.
//
// Exit 0 recorded, 2 refused, 64 wrong arguments.

const fs = require('fs');
const path = require('path');
const { OUTCOMES, arg } = require('./record.js');

const BY = ['machine', 'command', 'human'];

function usage(why) {
  if (why) console.error(why);
  console.error('usage: observe.js --out=<folder> --item=<3.2/07> --outcome=<' + Object.keys(OUTCOMES).join('|') + '>');
  console.error('       [--label=pass] [--profile=b2c] [--viewport=desktop] [--by=command|human|machine]');
  console.error('       [--checklist-sha=...] the revision this answers, so the report can tell it is the right one');
  console.error('       [--assertion=...] [--detail=...] [--reason=...] [--evidence=file,file]');
  process.exit(64);
}

const outRoot = arg('out') && path.resolve(arg('out'));
const label = arg('label', 'pass');
const profile = arg('profile', 'b2c');
const viewport = arg('viewport', 'desktop');
const item = arg('item');
const outcome = arg('outcome');
const by = arg('by', 'human');
const assertion = arg('assertion');
const detail = arg('detail');
const reason = arg('reason');
const evidence = (arg('evidence') || '').split(',').map((s) => s.trim()).filter(Boolean);
const checklistSha = arg('checklist-sha');

if (!outRoot) usage('--out is required');
if (!item) usage('--item is required: which checklist point this answers');
if (!(outcome in OUTCOMES)) usage(`--outcome must be one of ${Object.keys(OUTCOMES).join(', ')}`);
if (!BY.includes(by)) usage(`--by must be one of ${BY.join(', ')}`);

// The same rules the browser runs under. A pass with nothing recorded about what
// was checked is not evidence, wherever it came from.
if (outcome === 'pass' && !assertion) {
  console.error(`refusing: ${item} would be recorded as passing without saying what was checked`);
  process.exit(2);
}
// The browser's own passes lean on the screenshot of the step they ran in.
// Nothing took a screenshot here, so the file has to arrive with the answer:
// the lint output, the page saved to disk, the photograph someone took. Without
// it the report would print a green nobody can open, which it refuses to do.
if (outcome === 'pass' && !evidence.length) {
  console.error(`refusing: ${item} would be recorded as passing with nothing to show for it`);
  console.error("put the output or the picture in the cell folder and name it with --evidence=<file>");
  process.exit(2);
}
if ((outcome === 'skipped' || outcome === 'inconclusive') && !reason) {
  console.error(`refusing: ${item} would be recorded as ${outcome} without a reason`);
  process.exit(2);
}
if (outcome === 'needs-human' && !evidence.length && !detail) {
  console.error(`refusing: ${item} would be left to a person with nothing for them to look at`);
  process.exit(2);
}

const dir = path.join(outRoot, label, `${profile}-${viewport}`);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'run.json');

const missing = evidence.filter((e) => !fs.existsSync(path.join(dir, e)));
if (missing.length) {
  console.error(`refusing: the evidence named is not in ${dir}: ${missing.join(', ')}`);
  console.error('put the file there first, so the report can point at something that exists');
  process.exit(2);
}

// A folder the browser has not written yet still gets a run.json, so a section
// answered entirely by commands or by a person is a section like any other.
const readRun = () => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`refusing: ${file} is not readable JSON: ${String((err && err.message) || err)}`);
    console.error('a run was probably killed halfway. Delete that file, or fix it, then record this again');
    process.exit(2);
  }
};
const run = fs.existsSync(file)
  ? readRun()
  : {
      suite: path.basename(outRoot), section: path.basename(outRoot),
      label, profile, viewport, probe: 'none',
      checklistSha256: checklistSha || null,
      startedAt: new Date().toISOString(),
      observations: [], steps: [], settingsChanged: [],
      consoleErrors: [], netErrors: [], notes: [], harness: [],
    };

run.observations.push({
  item, outcome, by, assertion: assertion || null, detail: detail || null,
  reason: reason || null, measurement: null, evidence, step: null,
  // So a later browser run over this same cell can tell this answer apart from
  // the ones it is about to redo, and carries it rather than deleting it.
  recordedBy: 'observe.js',
  at: new Date().toISOString(),
});
// An answer says which checklist it answers even when the browser wrote this
// file first, and a cell answered against two different revisions is a mix
// nobody can read.
if (checklistSha) {
  if (run.checklistSha256 && run.checklistSha256 !== checklistSha) {
    console.error(`refusing: ${file} holds answers to checklist ${String(run.checklistSha256).slice(0, 12)},`);
    console.error(`and this one answers ${checklistSha.slice(0, 12)}. Re-run that cell rather than mixing the two`);
    process.exit(2);
  }
  run.checklistSha256 = checklistSha;
}
run.finishedAt = new Date().toISOString();

fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
console.error(`recorded: ${item} ${outcome}, said by ${by}`);
console.error(`  ${assertion || reason || detail || ''}`);
process.stdout.write(file + '\n');
