// tests/marker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { drawMarker } from '../src/recorder/marker.js';

async function blankPng(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
}

async function pixelAt(png, x, y, width) {
  const raw = await sharp(png).removeAlpha().raw().toBuffer();
  const i = (y * width + x) * 3;
  return { r: raw[i], g: raw[i + 1], b: raw[i + 2] };
}

test('desenha anel vermelho nas coordenadas, mantendo dimensões', async () => {
  const out = await drawMarker(await blankPng(200, 100), { x: 100, y: 50 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);

  const ring = await pixelAt(out, 100 + 22, 50, 200); // sobre o traço do anel (raio 22)
  assert.ok(ring.r > 150 && ring.g < 120, `esperava vermelho no anel, veio ${JSON.stringify(ring)}`);

  const outside = await pixelAt(out, 10, 10, 200);
  assert.ok(outside.r > 240 && outside.g > 240, 'longe do anel deve continuar branco');
});

test('coordenadas na borda são clampeadas sem lançar erro', async () => {
  const out = await drawMarker(await blankPng(100, 100), { x: 0, y: 0 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 100);
});
