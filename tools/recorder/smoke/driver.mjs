// tools/recorder/smoke/driver.mjs
// Smoke test of the BUNDLE against a real Chrome: starts the committed bundle in the
// background, drives the browser through a 2nd CDP client (trusted events), ends by
// closing the browser (Browser.close over CDP) and validates the recorded session.
// Usage: node smoke/driver.mjs            -> password-free fixture (full pipeline)
//        node smoke/driver.mjs security   -> password fixture (security invariants)
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const security = process.argv[2] === 'security';
const name = security ? 'smoke-security' : 'smoke-form';
const SENTINEL = 'PASSWORD-SENTINEL-123';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const fileUrl = (p) => 'file:///' + p.replaceAll('\\', '/');

const bundle = path.join(repoRoot, '.claude', 'skills', 'document', 'scripts', 'doc-agent.mjs');
const procDir = path.join(repoRoot, 'docs', name);
await fs.rm(procDir, { recursive: true, force: true });

// Point the data home (runtime cache, browser profile) at a temp dir so the smoke
// never touches the developer's real %LOCALAPPDATA%\doc-agent.
const os = await import('node:os');
const smokeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-smokehome-'));

const cli = spawn(process.execPath, [bundle, 'record', name], {
  cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DOC_AGENT_HOME: smokeHome },
});
let cliOut = '';
cli.stdout.on('data', (d) => (cliOut += d));
cli.stderr.on('data', (d) => (cliOut += d));
const cliExit = new Promise((resolve) => cli.on('exit', resolve));

let driver = null;
for (let i = 0; i < 60 && !driver; i++) {
  try { driver = await chromium.connectOverCDP('http://127.0.0.1:9333'); }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!driver) { cli.kill(); throw new Error('CDP did not come up within 30s. CLI output:\n' + cliOut); }

const context = driver.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));

if (security) {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'login.html')));
  await page.click('#user'); await page.fill('#user', 'demo.user');
  await page.click('#pwd'); await page.fill('#pwd', SENTINEL);
  await page.click('#login');
  await page.waitForLoadState('load');
} else {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'form.html')));
  await page.click('#reason'); await page.fill('#reason', 'test ticket');
  await page.click('#detail'); await page.fill('#detail', 'two lines');
  await page.selectOption('#type', 'Request');
  await page.click('#urgent');
  await page.click('#submit');
  await page.waitForLoadState('load');
}
// Let the screenshots settle before closing the browser. This must be > 3s: a capture
// fired during the commit of the submit navigation gets no answer from Chrome and is
// only aborted by the recorder 3s timeout; the rest flow after that (the recorder
// chains captures, each with its full budget — measured: the queue drains in ~4.2s in
// the worst case on this hardware). 800ms closed the browser too early and no click
// screenshot survived.
await new Promise((r) => setTimeout(r, 6000));

// Stop the recording by actually CLOSING the browser (the disconnected trigger in the CLI)
const cdp = await context.newCDPSession(page);
await cdp.send('Browser.close').catch(() => {});

const exitCode = await cliExit;
check(exitCode === 0, `the CLI exited with ${exitCode}; output:\n${cliOut}`);
await fs.rm(smokeHome, { recursive: true, force: true }).catch(() => {});

// The session folder is timestamped (sessions/YYYY-MM-DD-HHMM); take it from the CLI output.
const readyMatch = cliOut.match(/Session ready: (\S+)/);
if (!readyMatch) { console.error('CLI output has no "Session ready" line:\n' + cliOut); process.exit(1); }
const sessionDir = path.join(repoRoot, readyMatch[1].replaceAll('/', path.sep));

const raw = await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8');
const session = JSON.parse(raw);
const types = session.steps.map((s) => s.type);

if (security) {
  check(!raw.includes(SENTINEL), 'THE PASSWORD VALUE LEAKED into session.json');
  const pwdFill = session.steps.find((s) => s.type === 'fill' && s.selector === '#pwd');
  check(!!pwdFill, 'fill step for the password field was not recorded');
  check(pwdFill?.isPassword === true && pwdFill?.value === null, 'password field is not masked correctly');
  check(session.steps.every((s) => s.screenshot === null), 'screenshot taken on a page with a password field');
  const shots = await fs.readdir(path.join(sessionDir, 'shots')).catch(() => []);
  check(shots.length === 0, `shots/ should be empty, it has: ${shots.join(', ')}`);
} else {
  const fills = session.steps.filter((s) => s.type === 'fill');
  check(fills.some((s) => s.value === 'test ticket'), 'fill of Reason missing');
  check(fills.some((s) => s.value === 'two lines'), 'fill of Detail missing');
  check(fills.length === 2, `expected 2 fills, got ${fills.length} (dedup broken?)`);
  check(session.steps.some((s) => s.type === 'select' && s.value === 'Request'), 'select missing');
  check(session.steps.filter((s) => s.type === 'click').length >= 2, 'checkbox/submit clicks missing');
  check(types.includes('navigation'), 'navigation missing');
  const withShot = session.steps.filter((s) => s.screenshot);
  check(withShot.length > 0, 'no screenshot was taken');
  // marker: at least one click screenshot has ring pixels (pure #e0245e on the stroke)
  const clickShot = session.steps.find((s) => s.type === 'click' && s.screenshot);
  check(!!clickShot, 'no click with a screenshot');
  if (clickShot) {
    const png = PNG.sync.read(await fs.readFile(path.join(sessionDir, clickShot.screenshot.replaceAll('/', path.sep))));
    let markerPixels = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i] === 224 && png.data[i + 1] === 36 && png.data[i + 2] === 94) markerPixels++;
    }
    check(markerPixels > 50, `marker ring not found (exact pixels: ${markerPixels})`);
  }
}

if (failures.length) {
  console.error(`${security ? 'SECURITY' : 'FORM'} SMOKE FAILED:`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`${security ? 'SECURITY' : 'FORM'} SMOKE OK (${session.steps.length} steps at ${path.relative(repoRoot, sessionDir)})`);
