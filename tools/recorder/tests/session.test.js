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
    label: null, selector: null, isPassword: false, isEditable: false,
    value: null, coords: null, ...overrides,
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
