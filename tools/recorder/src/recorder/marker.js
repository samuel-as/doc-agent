// src/recorder/marker.js
import { PNG } from 'pngjs';

const RADIUS = 22;
const STROKE = 4;
const COLOR = { r: 224, g: 36, b: 94 }; // #e0245e
const FILL_ALPHA = 0.25;

export async function drawMarker(inputPng, { x, y }) {
  const png = PNG.sync.read(inputPng);
  const { width, height, data } = png;
  const cx = Math.min(Math.max(Math.round(x), RADIUS), width - RADIUS);
  const cy = Math.min(Math.max(Math.round(y), RADIUS), height - RADIUS);
  const outer = RADIUS + STROKE / 2;
  const inner = RADIUS - STROKE / 2;
  const x0 = Math.max(0, cx - Math.ceil(outer));
  const x1 = Math.min(width - 1, cx + Math.ceil(outer));
  const y0 = Math.max(0, cy - Math.ceil(outer));
  const y1 = Math.min(height - 1, cy + Math.ceil(outer));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.hypot(px - cx, py - cy);
      let alpha = 0;
      if (d >= inner && d <= outer) alpha = 1;      // ring stroke
      else if (d < inner) alpha = FILL_ALPHA;        // translucent fill
      else continue;
      const i = (width * py + px) << 2;
      data[i] = Math.round(COLOR.r * alpha + data[i] * (1 - alpha));
      data[i + 1] = Math.round(COLOR.g * alpha + data[i + 1] * (1 - alpha));
      data[i + 2] = Math.round(COLOR.b * alpha + data[i + 2] * (1 - alpha));
    }
  }
  return PNG.sync.write(png);
}

const REDACT = { r: 43, g: 43, b: 43 }; // #2b2b2b — solid, never pixelated (pixelation is reversible)
const REDACT_PAD = 2;

// Paints solid boxes over sensitive fields. Called BEFORE the PNG reaches the disk.
export async function drawRedaction(inputPng, rects) {
  const png = PNG.sync.read(inputPng);
  const { width, height, data } = png;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x - REDACT_PAD));
    const y0 = Math.max(0, Math.floor(r.y - REDACT_PAD));
    const x1 = Math.min(width - 1, Math.ceil(r.x + r.w + REDACT_PAD) - 1);
    const y1 = Math.min(height - 1, Math.ceil(r.y + r.h + REDACT_PAD) - 1);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const i = (width * py + px) << 2;
        data[i] = REDACT.r; data[i + 1] = REDACT.g; data[i + 2] = REDACT.b; data[i + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}
