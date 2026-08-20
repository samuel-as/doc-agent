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
    kind, ts: 1000, url: 'https://app.example.com/x', title: 'Sistema X',
    label: null, selector: null, isPassword: false, isEditable: false,
    value: null, coords: null, ...overrides,
  };
}

test('grava sessão completa: session.json, prints finais numerados, raws removidos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(root, 'teste-vpn', new Date('2026-08-19T12:00:00Z'));
  await session.init();

  await session.addEvent(ev('click', { label: 'Novo', selector: '#novo', coords: { x: 25, y: 25 } }), await tinyPng());
  await session.addEvent(ev('click', { selector: '#motivo', isEditable: true, coords: { x: 10, y: 10 }, ts: 2000 }), await tinyPng());
  await session.addEvent(ev('field-commit', { selector: '#motivo', label: 'Motivo', value: 'VPN caiu', ts: 3000 }), null);

  const dir = await session.finalize();
  assert.equal(path.basename(dir), '2026-08-19-teste-vpn');

  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.name, 'teste-vpn');
  assert.equal(json.steps.length, 2);
  assert.equal(json.steps[0].type, 'click');
  assert.equal(json.steps[0].screenshot, 'shots/step-001.png');
  assert.equal(json.steps[1].type, 'fill');
  assert.equal(json.steps[1].screenshot, 'shots/step-002.png'); // herdado do clique no campo
  assert.equal(json.steps[1].coords, undefined); // campo interno não vaza para o json

  const shots = await fs.readdir(path.join(dir, 'shots'));
  assert.deepEqual(shots.sort(), ['step-001.png', 'step-002.png']);
});

test('passo sem screenshot fica com screenshot null no json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const session = new SessionWriter(root, 'sem-print', new Date('2026-08-19T12:00:00Z'));
  await session.init();
  await session.addEvent(ev('click', { selector: '#a' }), null); // captura falhou
  const dir = await session.finalize();
  const json = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(json.steps[0].screenshot, null);
});
