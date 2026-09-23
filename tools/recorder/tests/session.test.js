// tests/session.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { SessionWriter } from '../src/recorder/session.js';

function tinyPng() {
  const png = new PNG({ width: 50, height: 50 });
  png.data.fill(255);
  return PNG.sync.write(png);
}

function ev(kind, overrides = {}) {
  return {
    kind, ts: 1000, url: 'https://app.example.com/x', title: 'System X',
    label: null, selector: null, isSensitive: false, sensitiveReason: null, isEditable: false,
    value: null, coords: null, containerRect: null, sensitiveRects: [], ...overrides,
  };
}

// local-time components so the expected stamp is timezone-independent
const NOW = new Date(2026, 7, 19, 14, 30); // 2026-08-19 14:30 local

test('writes a full session: session.json, numbered final screenshots, raws removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const procedureDir = path.join(root, 'docs', 'test-vpn');
  const session = new SessionWriter(procedureDir, 'test-vpn', NOW);
  await session.init();

  await session.addEvent(ev('click', { label: 'New', selector: '#new', coords: { x: 25, y: 25 } }), await tinyPng());
  await session.addEvent(ev('click', { selector: '#reason', isEditable: true, coords: { x: 10, y: 10 }, ts: 2000 }), await tinyPng());
  await session.addEvent(ev('field-commit', { selector: '#reason', label: 'Reason', value: 'VPN is down', ts: 3000 }), null);

  const dir = await session.finalize();
  // each recording lands in its own timestamped folder under sessions/
  assert.equal(dir, path.join(procedureDir, 'sessions', '2026-08-19-1430'));

  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.name, 'test-vpn');
  assert.equal(json.steps.length, 2);
  assert.equal(json.steps[0].type, 'click');
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
  assert.equal(json.steps[1].type, 'fill');
  assert.equal(json.steps[1].screenshot, 'shots/step-002.png'); // inherited from the click on the field
  assert.equal(json.steps[1].coords, undefined); // internal field must not leak into the json

  const shots = await fs.readdir(path.join(dir, 'shots'));
  assert.deepEqual(shots.sort(), ['step-001.png', 'step-002.png']);
});

test('recordings at different times of the same procedure are both preserved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const procedureDir = path.join(root, 'docs', 'retake');

  const first = new SessionWriter(procedureDir, 'retake', new Date(2026, 7, 19, 14, 30));
  await first.init();
  await first.addEvent(ev('click', { selector: '#a' }), null);
  await first.finalize();

  const second = new SessionWriter(procedureDir, 'retake', new Date(2026, 7, 19, 15, 5));
  await second.init();
  await second.addEvent(ev('click', { selector: '#b' }), null);
  await second.finalize();

  const sessions = (await fs.readdir(path.join(procedureDir, 'sessions'))).sort();
  assert.deepEqual(sessions, ['2026-08-19-1430', '2026-08-19-1505']);
});

test('a step with no screenshot ends up with screenshot null in the json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'no-screenshot'), 'no-screenshot', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a' }), null); // capture failed
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, null);
});

test('session.json carries schema 2 and steps do not expose internal fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'schema'), 'schema', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a', coords: { x: 1, y: 1 }, sensitiveRects: [{ x: 0, y: 0, w: 5, h: 5, reason: 'otp' }] }), await tinyPng());
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.schema, 2);
  assert.equal(json.steps[0].coords, undefined);
  assert.equal(json.steps[0].sensitiveRects, undefined);
  assert.equal(json.steps[0].isSensitive, false);
});

test('sensitive rects are painted over before the screenshot reaches the disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'redact'), 'redact', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#login', label: 'Sign in', sensitiveRects: [{ x: 10, y: 10, w: 20, h: 10, reason: 'password' }] }), await tinyPng());
  const dir = await session.finalize();
  const png = PNG.sync.read(await fs.readFile(path.join(dir, 'shots', 'step-001.png')));
  const px = (x, y) => { const i = (png.width * y + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  assert.deepEqual(px(20, 15), [43, 43, 43]);   // inside the field: redacted
  assert.deepEqual(px(45, 45), [255, 255, 255]); // elsewhere: untouched
});

test('events appended out of ts order (screenshot race) are still consolidated in ts order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'race'), 'race', NOW);
  await session.init();

  // Simulates the real race: drag-start (ts=1000) has a screenshot capture that is slow
  // to resolve, so by the time it is appended, the drag event (ts=1500, no screenshot,
  // appended synchronously/immediately) has already landed in session.events first.
  await session.addEvent(ev('drag', { ts: 1500, target: '#dropzone' }), null);
  await session.addEvent(ev('drag-start', { ts: 1000, selector: '#draggable', coords: { x: 5, y: 5 } }), await tinyPng());

  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));

  assert.equal(json.steps.length, 1);
  assert.equal(json.steps[0].type, 'drag');
  // The drag step must inherit drag-start's screenshot, which only happens if
  // drag-start is consolidated BEFORE drag despite arriving second in this.events.
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
});

test('when the redaction fails, the step keeps no screenshot at all', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'redact-fail'), 'redact-fail', NOW);
  await session.init();
  // an invalid PNG buffer makes drawRedaction throw; the raw must not survive as a final shot
  await session.addEvent(ev('click', { selector: '#login', sensitiveRects: [{ x: 1, y: 1, w: 2, h: 2, reason: 'password' }] }), Buffer.from('not-a-png'));
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, null);
  assert.deepEqual(await fs.readdir(path.join(dir, 'shots')), []);
});

test('the raw capture is redacted before it reaches the disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'raw-redact'), 'raw-redact', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#login', sensitiveRects: [{ x: 10, y: 10, w: 20, h: 10, reason: 'password' }] }), await tinyPng());
  // Checked BEFORE finalize: a recording killed halfway must not leave readable pixels
  // of a sensitive field behind in shots/.
  const png = PNG.sync.read(await fs.readFile(path.join(session.dir, 'shots', 'raw-001.png')));
  const px = (x, y) => { const i = (png.width * y + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  assert.deepEqual(px(20, 15), [43, 43, 43]);
  assert.deepEqual(px(45, 45), [255, 255, 255]);
});

test('a capture whose redaction fails is never written at all', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'raw-redact-fail'), 'raw-redact-fail', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#login', sensitiveRects: [{ x: 1, y: 1, w: 2, h: 2, reason: 'password' }] }), Buffer.from('not-a-png'));
  assert.deepEqual(await fs.readdir(session.shotsDir), []);
  assert.equal(session.events[0].screenshot, null);
});

test('a step with a containerRect gets a crop file, screenshotCrop and preferred crop', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'crop'), 'crop', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a', coords: { x: 25, y: 25 }, containerRect: { x: 10, y: 10, w: 30, h: 20 } }), await tinyPng());
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
  assert.equal(json.steps[0].screenshotCrop, 'shots/step-001-crop.png');
  assert.equal(json.steps[0].preferred, 'crop');
  assert.equal(json.steps[0].containerRect, undefined);
  const crop = PNG.sync.read(await fs.readFile(path.join(dir, 'shots', 'step-001-crop.png')));
  assert.equal(crop.width, 30);
  assert.equal(crop.height, 20);
  // the marker (drawn at 25,25 on the full image) is inside the crop at (15,15)
  const i = (crop.width * 15 + 15) << 2;
  assert.ok(crop.data[i] > 150 && crop.data[i + 1] < 250, 'marker fill missing from the crop');
});

test('a step without containerRect is preferred full and has no crop file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'nocrop'), 'nocrop', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a' }), await tinyPng());
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshotCrop, null);
  assert.equal(json.steps[0].preferred, 'full');
  assert.deepEqual((await fs.readdir(path.join(dir, 'shots'))).sort(), ['step-001.png']);
});

test('a crop that fails falls back to full without touching the full screenshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'badcrop'), 'badcrop', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a', containerRect: { x: 500, y: 500, w: 10, h: 10 } }), await tinyPng()); // outside the 50x50 image
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
  assert.equal(json.steps[0].screenshotCrop, null);
  assert.equal(json.steps[0].preferred, 'full');
});

test('a step whose coords fall outside its containerRect gets no crop (the crop would miss the target)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'outside'), 'outside', NOW);
  await session.init();
  // containerRect (10,10)-(30,30) would crop cleanly out of the 50x50 image, but the click
  // landed at (45,45) -- e.g. a dropdown item overflowing its nav/header ancestor -- so the
  // crop must be skipped rather than show a container without the element or its marker.
  await session.addEvent(ev('click', { selector: '#a', coords: { x: 45, y: 45 }, containerRect: { x: 10, y: 10, w: 20, h: 20 } }), await tinyPng());
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
  assert.equal(json.steps[0].screenshotCrop, null);
  assert.equal(json.steps[0].preferred, 'full');
  assert.deepEqual((await fs.readdir(path.join(dir, 'shots'))).sort(), ['step-001.png']);
});

test('the crop carries the redaction of the sensitive field it contains', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'crop-redact'), 'crop-redact', NOW);
  await session.init();
  await session.addEvent(ev('click', {
    selector: '#a',
    sensitiveRects: [{ x: 12, y: 12, w: 6, h: 6, reason: 'password' }],
    containerRect: { x: 10, y: 10, w: 30, h: 20 },
  }), await tinyPng());
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].preferred, 'crop');
  const crop = PNG.sync.read(await fs.readFile(path.join(dir, 'shots', 'step-001-crop.png')));
  const px = (x, y) => { const i = (crop.width * y + x) << 2; return [crop.data[i], crop.data[i + 1], crop.data[i + 2]]; };
  // (5,5) of the crop is (15,15) of the full image: inside the redacted field
  assert.deepEqual(px(5, 5), [43, 43, 43]);
});

test('a step with no screenshot at all is preferred full', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(path.join(root, 'docs', 'noshot'), 'noshot', NOW);
  await session.init();
  await session.addEvent(ev('click', { selector: '#a', containerRect: { x: 0, y: 0, w: 10, h: 10 } }), null);
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, null);
  assert.equal(json.steps[0].screenshotCrop, null);
  assert.equal(json.steps[0].preferred, 'full');
});
