// record.js: the half of a QA phase that does not depend on how the environment is observed.
//
// A probe decides HOW to look at the environment: the browser probe drives Chromium through
// Playwright, the CLI probe spawns commands, the HTTP probe issues requests. This file decides
// WHAT the looking means, and it is
// the same in all three: what counts as a precondition, what can prove a bug, what a flake means in
// each phase, what voids a verdict, and what phase.json looks like when it is over.
//
// Keeping that here is the point. The honesty rules are the skill, and three copies of them would
// drift within a month.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);

// Accept both `--name=value` and `--name value`: the second is what everyone types by reflex, and
// silently falling back to a default there is how a run ends up measuring the wrong thing.
const arg = (n, d) => {
  const a = process.argv.slice(2);
  const prefix = `--${n}=`;
  const eq = a.find((x) => x.startsWith(prefix));
  if (eq !== undefined) return eq.slice(prefix.length);
  const i = a.indexOf(`--${n}`);
  if (i !== -1 && a[i + 1] !== undefined && !a[i + 1].startsWith('--')) return a[i + 1];
  return d;
};

// Validate before anything uses these. PHASE is checked against the two names it may take, not just
// for being present: `--phase=Before` would otherwise reach the flake rule below, where "is this the
// before phase" decides whether an intermittent symptom counts as a reproduction, so a
// one-character typo would silently invert a verdict.
function commonArgs(usage) {
  const phase = arg('phase');
  if (!phase) { console.error(usage); process.exit(2); }
  if (phase !== 'before' && phase !== 'after') {
    console.error(`--phase must be "before" or "after", got "${phase}"`);
    process.exit(2);
  }
  const scenarioPath = path.resolve(arg('scenario', './scenario.js'));
  const out = path.resolve(arg('out', '.'), phase);
  return { phase, scenarioPath, out, arg };
}

// probe: { name, runnerFile, settle?, capture?, meta? }
//   settle()          waits for the thing being observed to stop moving. Used before a re-sample.
//   capture(n, name)  records what a step ended on, and returns a filename or null.
//   meta()            extra phase.json fields that only that probe knows about.
function startPhase({ phase, out, scenarioPath, probe }) {
  // Empty the phase directory rather than trusting whoever called us to have done it: a leftover
  // file from an earlier pass would be cited as this run's evidence, and the report cannot tell the
  // two apart. The runner owns its own output.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const rec = {
    preconditions: [], bugs: [], details: [], steps: [],
    smoke: [], responsive: [], clips: [], commands: [], requests: [],
    consoleErrors: [], netErrors: [], harness: [], notes: [],
  };
  const state = { stepNo: 0 };
  const startedAt = new Date().toISOString();
  const settle = probe.settle || (async () => {});

  const put = (bucket, name, passed, detail, extra) => {
    // Only assert.bug re-samples, so only it accepts a function. Anywhere else a function is truthy
    // and would silently record a satisfied precondition for a condition nobody ever evaluated.
    // Refuse it: this throws inside the step, which lands in harness and voids the phase.
    if (typeof passed === 'function') {
      throw new Error(`"${name}" was given a function as its condition. Only assert.bug re-samples `
        + 'and accepts one. Call it yourself and pass the result: await cond()');
    }
    bucket.push({ step: state.stepNo, name, passed: !!passed, detail: detail === undefined ? null : String(detail), ...extra });
    return !!passed;
  };
  const note = (t) => { rec.notes.push(String(t)); };

  const assert = {
    ok: (name, cond, detail) => put(rec.preconditions, name, cond, detail),
    detail: (name, cond, d) => put(rec.details, name, cond, d),
    // A bug assertion may be a function, so a failure is re-sampled after settling rather than
    // trusted at once. true means CORRECT behaviour was observed. `detail` may be a function too,
    // so the report quotes the reading the verdict rests on and not an earlier one.
    //
    // What a flip means depends on the phase, and the two are not the same finding:
    //   before: the symptom showed, then cleared. That is an INTERMITTENT reproduction: it was
    //           observed, so it stays a reproduction, flagged for the report to say intermittent.
    //   after:  the fix is in place and the first read was simply too early. The settled reading
    //           is the one that counts, so the phase passes.
    // Neither is a harness error. A flake is reported, never fatal: voiding a verdict because one
    // observation was slow throws away a run that was valid.
    bug: async (name, cond, detail) => {
      const said = async () => (typeof detail === 'function' ? await detail() : detail);
      const pass = typeof cond === 'function' ? await cond() : cond;
      if (pass || typeof cond !== 'function') return put(rec.bugs, name, pass, await said());
      // Capture the failing observation before giving the thing more time: in the before phase that
      // reading IS the symptom, and quoting the settled one instead would print "symptom observed"
      // next to the correct value, which reads as a contradiction in the report.
      const firstSaid = await said().catch((err) => `detail unavailable: ${err.message}`);
      await settle();
      if (!(await cond())) return put(rec.bugs, name, false, await said());
      const intermittent = phase === 'before';
      rec.notes.push(intermittent
        ? `intermittent in before: the symptom appeared, then cleared on re-sample; kept as a reproduction: ${name}`
        : `flake in after: correct behaviour on re-sample; the settled reading counts: ${name}`);
      return put(rec.bugs, name, !intermittent, intermittent ? firstSaid : await said(), { flaky: true, intermittent });
    },
  };

  const step = async (name, fn) => {
    state.stepNo += 1;
    const n = String(state.stepNo).padStart(2, '0');
    const before = rec.consoleErrors.length + rec.netErrors.length;
    const t0 = Date.now();
    let evidence = null;
    try {
      await fn();
      await settle();
    } catch (e) {
      rec.harness.push(`step ${n} "${name}" threw: ${e.message}`);
    }
    if (probe.capture) evidence = await probe.capture(n, name).catch(() => null);
    rec.steps.push({
      n, name, shot: evidence, ms: Date.now() - t0,
      newProblems: rec.consoleErrors.length + rec.netErrors.length - before,
    });
  };

  // The exit code says nothing about the PR. 0 means the phase ran cleanly, 2 means the harness
  // could not produce trustworthy observations. A failed bug assertion in `before` is the expected
  // outcome, not an error.
  const finish = async (scenario, extra) => {
    const out2 = {
      phase,
      probe: probe.name,
      scenarioName: scenario.name || null,
      kind: scenario.kind || null,
      where: scenario.where || null,
      bug: scenario.bug || null,
      scenarioSha256: sha256(scenarioPath),
      runner: probe.runnerFile,
      runnerSha256: sha256(probe.runnerFile),
      recordSha256: sha256(__filename),
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(probe.meta ? await probe.meta() : {}),
      ...extra,
      ...rec,
    };
    fs.writeFileSync(path.join(out, 'phase.json'), JSON.stringify(out2, null, 2));
    const failed = (a) => a.filter((x) => !x.passed).length;
    const s = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    console.log(`${phase}: ${s(rec.steps.length, 'step')}, preconditions ${failed(rec.preconditions)} failed, `
      + `bug assertions ${failed(rec.bugs)} failed, harness ${rec.harness.length}`);
    rec.harness.forEach((h) => console.log(`  harness: ${h}`));
    const preFailed = rec.preconditions.some((c) => !c.passed);
    process.exit(rec.harness.length || preFailed ? 2 : 0);
  };

  // Even a runner that dies leaves a machine-readable record: the report reads phase.json.
  const die = (e) => {
    console.error('HARNESS ERROR', e);
    try {
      fs.writeFileSync(path.join(out, 'phase.json'), JSON.stringify({
        phase, probe: probe.name, outcome: 'harness', runner: probe.runnerFile,
        ...rec, harness: [...rec.harness, `runner failed: ${e.message}`],
      }, null, 2));
    } catch (_) { /* nothing left to do */ }
    process.exit(2);
  };

  return { rec, state, assert, step, note, settle, finish, die, put };
}

module.exports = { arg, commonArgs, startPhase, sha256, slug };
