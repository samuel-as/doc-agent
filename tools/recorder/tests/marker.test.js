// tests/marker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { drawMarker } from '../src/recorder/marker.js';

function blankPng(width, height) {
  const png = new PNG({ width, height });
  png.data.fill(255); // branco opaco (RGBA)
  return PNG.sync.write(png);
}

function pixelAt(pngBuffer, x, y) {
  const png = PNG.sync.read(pngBuffer);
  const i = (png.width * y + x) << 2;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
}

test('desenha anel vermelho nas coordenadas, mantendo dimensões', async () => {
  const out = await drawMarker(blankPng(200, 100), { x: 100, y: 50 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);

  const ring = pixelAt(out, 100 + 22, 50); // sobre o traço do anel (raio 22)
  assert.ok(ring.r > 150 && ring.g < 120, `esperava vermelho no anel, veio ${JSON.stringify(ring)}`);

  const outside = pixelAt(out, 10, 10);
  assert.ok(outside.r > 240 && outside.g > 240, 'longe do anel deve continuar branco');
});

test('coordenadas na borda são clampeadas sem lançar erro', async () => {
  const out = await drawMarker(blankPng(100, 100), { x: 0, y: 0 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 100);
});
