// tests/marker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { drawMarker } from '../src/recorder/marker.js';

function blankPng(width, height) {
  const png = new PNG({ width, height });
  png.data.fill(255); // opaque white (RGBA)
  return PNG.sync.write(png);
}

function pixelAt(pngBuffer, x, y) {
  const png = PNG.sync.read(pngBuffer);
  const i = (png.width * y + x) << 2;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
}

test('draws a red ring at the coordinates, keeping the image dimensions', async () => {
  const out = await drawMarker(blankPng(200, 100), { x: 100, y: 50 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);

  const ring = pixelAt(out, 100 + 22, 50); // on the ring stroke (radius 22)
  assert.ok(ring.r > 150 && ring.g < 120, `expected red on the ring, got ${JSON.stringify(ring)}`);

  const outside = pixelAt(out, 10, 10);
  assert.ok(outside.r > 240 && outside.g > 240, 'far from the ring it must stay white');
});

test('coordinates on the edge are clamped without throwing', async () => {
  const out = await drawMarker(blankPng(100, 100), { x: 0, y: 0 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 100);
});
