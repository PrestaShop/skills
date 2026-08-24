// run-cli.js: one QA phase, observed on the command line. Records what happened; decides nothing.
// node <skill>/scripts/run-cli.js --scenario=./scenario.js --phase=before|after --out=. [--cwd=<dir>]
//
// The sibling of run.js for pull requests a browser cannot see: console commands, module CLIs,
// install and upgrade scripts, composer scripts. record.js holds everything the probes share, so a
// CLI verdict is reached by exactly the same rules as a browser one: two phases, the same scenario
// in both, the same flake rule, the same reasons to refuse a verdict.
//
// No dependency: Node's own child_process is enough, so a CLI QA needs neither Playwright nor npm.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { commonArgs, startPhase } = require('./record.js');

const USAGE = 'usage: --phase=before|after [--cwd=<working directory>] [--scenario=./scenario.js] [--out=.]';
const { phase: PHASE, scenarioPath: SCENARIO, out: OUT, arg } = commonArgs(USAGE);
const CWD = path.resolve(arg('cwd', process.cwd()));
const TIMEOUT = Number(arg('timeout', 120)) * 1000;   // two minutes: a cache:clear on a cold environment is slow
const KEEP = 4000;   // characters of each stream kept in phase.json; transcript.txt keeps all of it

if (!fs.existsSync(CWD)) { console.error(`--cwd ${CWD} does not exist`); process.exit(2); }

const transcript = path.join(OUT, 'transcript.txt');
const log = (s) => fs.appendFileSync(transcript, s);

let R = null;   // hoisted so the crash handler below can still write phase.json
(async () => {
  const scenario = require(SCENARIO);

  // Nothing settles on a command line the way a page does, but a re-sample still means something:
  // a command that fails then succeeds is a flaky command, which is exactly what the core's flake
  // rule is for. A short pause is enough to let a lock, a cache write or a file handle clear.
  const settle = () => new Promise((r) => setTimeout(r, 300));

  R = startPhase({
    phase: PHASE, out: OUT, scenarioPath: SCENARIO,
    probe: {
      name: 'cli',
      runnerFile: __filename,
      settle,
      capture: async () => null,   // the evidence of a command is its transcript, not a picture
      meta: async () => ({ cwd: CWD, node: process.version, transcript: 'transcript.txt' }),
    },
  });
  const { rec, state, assert, step, note } = R;

  // Run one command and record it. A non-zero exit is data, never a crash: half the bugs worth
  // QA-ing on a command line ARE the exit code, so the scenario decides what it means.
  // The command line and its output are both recorded, because on a command line they ARE the
  // measurement. What is passed in `opts.env` is not, which is where a secret belongs. A command
  // that PRINTS a secret still leaks it: phase.json and transcript.txt get attached to a public
  // pull request.
  const sh = (command, opts = {}) => new Promise((resolve) => {
    const t0 = Date.now();
    log(`\n$ ${command}\n`);
    execFile('/bin/sh', ['-c', command], {
      cwd: opts.cwd ? path.resolve(CWD, opts.cwd) : CWD,
      timeout: opts.timeoutMs || TIMEOUT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...(opts.env || {}) },
    }, (err, stdout, stderr) => {
      const ms = Date.now() - t0;
      const timedOut = !!(err && err.killed);
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      log(stdout);
      if (stderr) log(`[stderr]\n${stderr}`);
      log(`[exit ${code} in ${ms}ms]${timedOut ? ' [TIMED OUT]' : ''}\n`);
      if (timedOut) rec.harness.push(`command timed out after ${opts.timeoutMs || TIMEOUT}ms: ${command}`);
      const entry = {
        step: state.stepNo, command, code, ms, timedOut,
        stdout: stdout.length > KEEP ? stdout.slice(0, KEEP) + `\n[${stdout.length - KEEP} more characters in transcript.txt]` : stdout,
        stderr: stderr.length > KEEP ? stderr.slice(0, KEEP) + `\n[${stderr.length - KEEP} more characters in transcript.txt]` : stderr,
      };
      rec.commands.push(entry);
      resolve({ ...entry, out: `${stdout}${stderr}` });
    });
  });

  // A command that prints "done" and changes nothing has not done anything. Side effects are half
  // the subject on a command line, so they are measured the same way in both phases: size and hash,
  // never the content, because a dump can be enormous and can carry credentials.
  const file = (p) => {
    const full = path.resolve(CWD, p);
    if (!fs.existsSync(full)) return { path: p, exists: false, bytes: 0, sha256: null };
    const buf = fs.readFileSync(full);
    return { path: p, exists: true, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  };

  // The floor under "we only ran the happy path". There is no universal one on a command line, so
  // the scenario names it: commands that must keep working whatever the PR does. Same list in both
  // phases, or the comparison means nothing.
  if (Array.isArray(scenario.smoke) && scenario.smoke.length) {
    await step('smoke: the commands still run', async () => {
      for (const cmd of scenario.smoke) {
        const r = await sh(cmd);
        // `status` is the shared field name across probes. Here it carries an exit code, not an
        // HTTP status: 0 is the pass, where for the other two probes 0 means no answer at all.
        rec.smoke.push({ label: cmd, url: null, status: r.code, ok: r.code === 0 });
      }
    });
  } else {
    note('no smoke commands declared: the scenario named no command that must keep working');
  }

  try {
    await scenario.run({ phase: PHASE, cwd: CWD, step, assert, note, sh, file, settle });
  } catch (e) {
    rec.harness.push(`scenario threw outside a step: ${e.message}`);
  }

  await R.finish(scenario);
})().catch((e) => {
  // A runner that dies still owes a record. report.js reads phase.json, and a missing file is
  // indistinguishable from a phase nobody ran, so die() writes what it has and exits 2. Before
  // startPhase there is nothing to write with, hence the guard.
  if (R) R.die(e);
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
