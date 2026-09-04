// run-http.js: one QA phase, observed over HTTP. Records what happened; decides nothing.
// node <skill>/scripts/run-http.js --scenario=./scenario.js --phase=before|after --out=. --url=<base>
//
// The third probe, for pull requests that change what the server answers rather than what a page
// shows: the webservice, controllers returning JSON, status codes, headers, redirects. record.js
// holds everything the probes share, so the verdict is reached by the same rules as a browser run.
//
// No dependency: Node's own http and https modules are enough.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { commonArgs, startPhase } = require('./record.js');

const USAGE = 'usage: --phase=before|after --url=<base URL> [--scenario=./scenario.js] [--out=.]';
const { phase: PHASE, scenarioPath: SCENARIO, out: OUT, arg } = commonArgs(USAGE);
const BASE = (arg('url', '') || '').replace(/\/$/, '');
if (!BASE) { console.error(USAGE); process.exit(2); }
const KEEP = 4000;   // characters of each body kept in phase.json; transcript.txt keeps all of it
const REQ_TIMEOUT = 30000;   // named once, so the option and the message it produces cannot drift

const transcript = path.join(OUT, 'transcript.txt');
const log = (s) => fs.appendFileSync(transcript, s);

let R = null;   // hoisted so the crash handler below can still write phase.json
(async () => {
  const scenario = require(SCENARIO);

  // A server has nothing to settle the way a page does, but a re-sample is still meaningful: an
  // endpoint that fails then succeeds is flaky, and the core's flake rule says what that means in
  // each phase. A short pause lets a cache write or a rate limiter clear.
  const settle = () => new Promise((r) => setTimeout(r, 300));

  R = startPhase({
    phase: PHASE, out: OUT, scenarioPath: SCENARIO,
    probe: {
      name: 'http',
      runnerFile: __filename,
      settle,
      capture: async () => null,   // the evidence of a request is its transcript, not a picture
      meta: async () => ({ url: BASE, node: process.version, transcript: 'transcript.txt' }),
    },
  });
  const { rec, state, assert, step, note } = R;

  // One request, recorded. Redirects are NOT followed: for this kind of PR the redirect often IS
  // the subject, and following it would hide the very status code under test.
  const req = (method, target, opts = {}) => new Promise((resolve) => {
    const url = new URL(/^https?:/.test(target) ? target : BASE + (target.startsWith('/') ? '' : '/') + target);
    const mod = url.protocol === 'https:' ? https : http;
    const headers = { accept: '*/*', ...(opts.headers || {}) };
    // The webservice key is Basic auth with an empty password. It arrives through the environment,
    // never on a command line, and it is redacted everywhere this run writes: phase.json and the
    // transcript both end up attached to a public pull request.
    if (opts.auth === 'ws') {
      const key = process.env.QA_WS_KEY;
      if (!key) { rec.harness.push('the scenario asked for webservice auth but QA_WS_KEY is not set'); }
      else headers.authorization = 'Basic ' + Buffer.from(`${key}:`).toString('base64');
    }
    const body = opts.body === undefined ? null
      : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    if (body && !headers['content-type']) headers['content-type'] = 'application/json';
    const safeHeaders = { ...headers };
    if (safeHeaders.authorization) safeHeaders.authorization = '[redacted]';
    const t0 = Date.now();
    log(`\n${method} ${url.pathname}${url.search}\n`);
    const r = mod.request(url, { method, headers, timeout: REQ_TIMEOUT }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        const ms = Date.now() - t0;
        log(`${res.statusCode} ${res.headers['content-type'] || ''} in ${ms}ms\n${text}\n`);
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* not JSON, which is fine */ }
        const entry = {
          step: state.stepNo, method, url: url.toString(), status: res.statusCode, ms,
          requestHeaders: safeHeaders,
          location: res.headers.location || null,
          contentType: res.headers['content-type'] || null,
          body: text.length > KEEP ? text.slice(0, KEEP) + `\n[${text.length - KEEP} more characters in transcript.txt]` : text,
        };
        rec.requests.push(entry);
        resolve({ ...entry, text, json });
      });
    });
    r.on('timeout', () => { r.destroy(new Error(`timed out after ${REQ_TIMEOUT}ms`)); });
    r.on('error', (e) => {
      const ms = Date.now() - t0;
      log(`request failed after ${ms}ms: ${e.message}\n`);
      const entry = { step: state.stepNo, method, url: url.toString(), status: 0, ms, error: e.message, body: '' };
      rec.requests.push(entry);
      resolve({ ...entry, text: '', json: null });
    });
    if (body) r.write(body);
    r.end();
  });

  const get = (target, opts) => req('GET', target, opts);

  // The floor under "we only called the endpoint we changed". The scenario names the neighbours
  // that must keep answering, and the same list runs in both phases or the comparison means nothing.
  if (Array.isArray(scenario.smoke) && scenario.smoke.length) {
    await step('smoke: the neighbouring endpoints still answer', async () => {
      for (const target of scenario.smoke) {
        const r = await get(target);
        rec.smoke.push({ label: target, url: r.url, status: r.status, ok: r.status > 0 && r.status < 400 });
      }
    });
  } else {
    note('no smoke endpoints declared: the scenario named no endpoint that must keep answering');
  }

  try {
    await scenario.run({ phase: PHASE, url: BASE, step, assert, note, req, get, settle });
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
