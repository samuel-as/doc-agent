// tools/recorder/smoke/driver.mjs
// Smoke test of the BUNDLE against a real Chrome: starts the committed bundle in the
// background, drives the browser through a 2nd CDP client (trusted events), ends by
// closing the browser (Browser.close over CDP) and validates the recorded session.
// Usage: node smoke/driver.mjs            -> form fixture (full pipeline: fill, check, shortcut, drag, scroll)
//        node smoke/driver.mjs security   -> sensitive fields: values never stored, fields redacted
//        node smoke/driver.mjs dynamic    -> shadow DOM click + SPA navigation settle
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const mode = process.argv[2] === 'security' ? 'security' : process.argv[2] === 'dynamic' ? 'dynamic' : 'form';
const name = `smoke-${mode}`;
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const fileUrl = (p) => 'file:///' + p.replaceAll('\\', '/');
const REDACT = [43, 43, 43];
// The recorder captures one screenshot at a time (~100 ms each, the first one ~700 ms)
// while playwright fires a whole form in under a second. A real user is far slower, so
// the driver waits between interactions: without it a capture lands on the screen that
// came NEXT, and any assertion about the pixels of a step would be meaningless.
const pace = () => new Promise((r) => setTimeout(r, 500));
const SENTINELS = {
  pwd: 'PASSWORD-SENTINEL-123', otp: '917364', card: '4111111111111111',
  cpf: '52998224725', phone: '11987654321', ticket: 'TICKET-778899',
};
// A valid CPF typed into a contenteditable: sensitive by value alone, and its text must
// not reach session.json through the step label either.
const NOTES_CPF = '111.444.777-35';

const bundle = path.join(repoRoot, '.claude', 'skills', 'document', 'scripts', 'doc-agent.mjs');
const procDir = path.join(repoRoot, 'docs', name);
await fs.rm(procDir, { recursive: true, force: true });

// Point the data home (runtime cache, browser profile) at a temp dir so the smoke
// never touches the developer's real %LOCALAPPDATA%\doc-agent.
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
const boxes = {}; // css-pixel boxes of sensitive fields, measured before the final click

if (mode === 'security') {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'login.html')));
  await page.click('#user'); await page.fill('#user', 'demo.user'); await pace();
  for (const id of ['pwd', 'otp', 'card', 'cpf', 'phone', 'ticket']) {
    await page.click('#' + id); await page.fill('#' + id, SENTINELS[id]); await pace();
  }
  await page.click('#extra-doc'); await page.keyboard.press('Tab'); await pace(); // sensitive and left empty
  for (const id of ['pwd', 'otp', 'card', 'cpf', 'phone']) boxes[id] = await page.locator('#' + id).boundingBox();
  boxes.ticket = await page.locator('#ticket').boundingBox();
  // A human presses and releases; playwright's instant click commits the navigation
  // while the capture of the login screen is still being taken.
  await page.click('#login', { delay: 300 });
  await page.waitForLoadState('load');
} else if (mode === 'dynamic') {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'spa.html')));
  await page.click('my-widget #inner'); // playwright pierces the shadow root
  await new Promise((r) => setTimeout(r, 2500)); // let the SPA "screen" render and the recorder settle
} else {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'form.html')));
  await page.click('#reason'); await page.fill('#reason', 'test ticket'); await pace();
  await page.click('#detail'); await page.fill('#detail', 'two lines'); await pace();
  await page.click('#notes'); await page.fill('#notes', NOTES_CPF); await pace();
  await page.selectOption('#type', 'Request'); await pace();
  await page.click('#urgent'); await pace();
  await page.click('h1'); // plain text: no step, and focus goes back to <body>
  await page.keyboard.press('Control+S'); // pressed with nothing focused: the step must have no label
  await pace();
  await page.dragAndDrop('#item-a', '#done'); await pace();
  await page.click('#submit', { delay: 300 }); // below a 2000px spacer: playwright scrolls, the recorder must flag it
  await page.waitForLoadState('load');
}
// Let the screenshots settle before closing the browser. This must be > 3s: a capture
// fired during the commit of the submit navigation gets no answer from Chrome and is
// only aborted by the recorder 3s timeout; the rest flow after that (the recorder
// chains captures, each with its full budget).
await new Promise((r) => setTimeout(r, 6000));

// Stop the recording by actually CLOSING the browser (the disconnected trigger in the CLI)
const cdp = await context.newCDPSession(page);
await cdp.send('Browser.close').catch(() => {});

const exitCode = await cliExit;
check(exitCode === 0, `the CLI exited with ${exitCode}; output:\n${cliOut}`);
await fs.rm(smokeHome, { recursive: true, force: true }).catch(() => {});

const readyMatch = cliOut.match(/Session ready: (\S+)/);
if (!readyMatch) { console.error('CLI output has no "Session ready" line:\n' + cliOut); process.exit(1); }
const sessionDir = path.join(repoRoot, readyMatch[1].replaceAll('/', path.sep));

const raw = await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8');
const session = JSON.parse(raw);
const types = session.steps.map((s) => s.type);
check(session.schema === 2, `schema should be 2, got ${session.schema}`);

const readShot = async (step) => PNG.sync.read(await fs.readFile(path.join(sessionDir, step.screenshot.replaceAll('/', path.sep))));
const pixel = (png, x, y) => { const i = (png.width * Math.round(y) + Math.round(x)) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const countColor = (png, rgb) => { let n = 0; for (let i = 0; i < png.data.length; i += 4) if (png.data[i] === rgb[0] && png.data[i + 1] === rgb[1] && png.data[i + 2] === rgb[2]) n++; return n; };

if (mode === 'security') {
  for (const [id, v] of Object.entries(SENTINELS)) {
    if (id === 'ticket') continue;
    check(!raw.includes(v), `THE ${id.toUpperCase()} VALUE LEAKED into session.json`);
  }
  check(raw.includes(SENTINELS.ticket), 'the ticket number (not sensitive) should be recorded as an example value');
  const fills = session.steps.filter((s) => s.type === 'fill');
  for (const [id, reason] of [['pwd', 'password'], ['otp', 'otp'], ['card', 'card'], ['cpf', 'document'], ['phone', 'phone']]) {
    const st = fills.find((s) => s.selector === '#' + id);
    check(!!st, `fill step for #${id} missing`);
    check(st?.isSensitive === true && st?.value === null && st?.sensitiveReason === reason, `#${id} not masked as ${reason}: ${JSON.stringify(st)}`);
  }
  check(!session.steps.some((s) => s.selector === '#extra-doc'),
    'a sensitive field left empty must not produce a step');
  const login = session.steps.find((s) => s.type === 'click' && s.selector === '#login');
  check(!!login?.screenshot, 'the login click must now HAVE a screenshot (redacted)');
  if (login?.screenshot) {
    const png = await readShot(login);
    for (const id of ['pwd', 'otp', 'card', 'cpf', 'phone']) {
      const b = boxes[id];
      check(same(pixel(png, b.x + b.width / 2, b.y + b.height / 2), REDACT), `#${id} is not redacted in the login screenshot`);
    }
    const t = boxes.ticket;
    check(!same(pixel(png, t.x + t.width / 2, t.y + t.height / 2), REDACT), 'the ticket field must NOT be redacted');
  }
} else if (mode === 'dynamic') {
  const shadowClick = session.steps.find((s) => s.type === 'click' && s.label === 'Shadow action');
  check(!!shadowClick, `click inside the shadow root was not recorded; steps: ${JSON.stringify(types)}`);
  const nav = session.steps.find((s) => s.type === 'navigation' && String(s.url).endsWith('#route-two'));
  check(!!nav, 'pushState navigation was not recorded');
  check(!!nav?.screenshot, 'SPA navigation has no screenshot');
  if (nav?.screenshot) {
    const png = await readShot(nav);
    check(countColor(png, [0, 255, 0]) > 1000, 'SPA screenshot was taken before the late content rendered (settle failed)');
  }
} else {
  const fills = session.steps.filter((s) => s.type === 'fill');
  check(fills.some((s) => s.value === 'test ticket'), 'fill of Reason missing');
  check(fills.some((s) => s.value === 'two lines'), 'fill of Detail missing');
  check(fills.length === 3, `expected 3 fills, got ${fills.length} (dedup broken?)`);
  check(!raw.includes(NOTES_CPF), 'THE CONTENTEDITABLE CPF LEAKED into session.json');
  const notes = session.steps.find((s) => s.selector === '#notes');
  check(notes?.type === 'fill' && notes?.isSensitive === true && notes?.value === null && notes?.label === null,
    `the contenteditable step must be sensitive and unlabelled: ${JSON.stringify(notes)}`);
  check(session.steps.some((s) => s.type === 'select' && s.value === 'Request'), 'select missing');
  const chk = session.steps.find((s) => s.type === 'check');
  check(chk?.value === 'on' && chk?.label === 'Urgent', `check step wrong: ${JSON.stringify(chk)}`);
  check(!session.steps.some((s) => s.type === 'click' && s.selector === '#urgent'), 'the checkbox must not ALSO produce a click step');
  const shortcut = session.steps.find((s) => s.type === 'shortcut' && s.value === 'Ctrl+S');
  check(!!shortcut, 'Ctrl+S shortcut missing');
  check(shortcut?.label === null, `a shortcut pressed with nothing focused must have label null: ${JSON.stringify(shortcut)}`);
  const drag = session.steps.find((s) => s.type === 'drag');
  check(drag?.label === 'Task A' && String(drag?.target).startsWith('Done'), `drag step wrong: ${JSON.stringify(drag)}`);
  const submit = session.steps.find((s) => s.type === 'click' && s.selector === '#submit');
  check(submit?.scrolled === true, 'the submit click (below the fold) should be flagged scrolled');
  check(chk?.scrolled === false, 'the checkbox click (above the fold) must not be flagged scrolled');
  check(types.includes('navigation'), 'navigation missing');
  const clickShot = session.steps.find((s) => s.type === 'click' && s.screenshot);
  check(!!clickShot, 'no click with a screenshot');
  if (clickShot) {
    const png = await readShot(clickShot);
    check(countColor(png, [224, 36, 94]) > 50, 'marker ring not found');
  }
}

if (failures.length) {
  console.error(`${mode.toUpperCase()} SMOKE FAILED:`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`${mode.toUpperCase()} SMOKE OK (${session.steps.length} steps at ${path.relative(repoRoot, sessionDir)})`);
