// src/recorder/marker.js
import sharp from 'sharp';

const RADIUS = 22;
const COLOR = '#e0245e';

export async function drawMarker(inputPng, { x, y }) {
  const img = sharp(inputPng);
  const { width, height } = await img.metadata();
  const cx = Math.min(Math.max(Math.round(x), RADIUS), width - RADIUS);
  const cy = Math.min(Math.max(Math.round(y), RADIUS), height - RADIUS);
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="${COLOR}" fill-opacity="0.25" stroke="${COLOR}" stroke-width="4"/>` +
    `</svg>`,
  );
  return img.composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}
