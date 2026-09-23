import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCropRect, cropRect } from '../src/recorder/crop.js';

// Viewport used by most cases: 1280x720, so the 60% cap is 552960 px².
const VW = 1280, VH = 720;
const box = (left, top, right, bottom) => ({ left, top, right, bottom });

test('the crop is the visible container plus a 24 px margin', () => {
  assert.deepEqual(
    cropRect([box(100, 100, 700, 400)], { x: 400, y: 250 }, VW, VH),
    { x: 76, y: 76, w: 648, h: 348 },
  );
});

test('a small container grows to 480x240 around its centre', () => {
  assert.deepEqual(
    cropRect([box(500, 300, 600, 350)], { x: 550, y: 325 }, VW, VH),
    { x: 310, y: 205, w: 480, h: 240 },
  );
});

test('a container at the top edge keeps the minimum height by shifting down', () => {
  // header 1280x60 at y=0: centred, the 240 px window would start at y=-90
  assert.deepEqual(
    cropRect([box(0, 0, 1280, 60)], { x: 100, y: 30 }, VW, VH),
    { x: 0, y: 0, w: 1280, h: 240 },
  );
});

test('a container at the bottom-right corner keeps the minimum size by shifting in', () => {
  assert.deepEqual(
    cropRect([box(1200, 660, 1270, 715)], { x: 1235, y: 690 }, VW, VH),
    { x: 800, y: 480, w: 480, h: 240 },
  );
});

test('a viewport smaller than the minimum clips the crop to the viewport', () => {
  assert.deepEqual(
    cropRect([box(10, 10, 110, 60)], { x: 60, y: 35 }, 400, 200),
    { x: 0, y: 0, w: 400, h: 200 },
  );
});

test('only the visible part of a container counts', () => {
  assert.deepEqual(
    cropRect([box(-100, -50, 500, 300)], { x: 200, y: 100 }, VW, VH),
    { x: 0, y: 0, w: 548, h: 348 },
  );
});

test('a container over 60% of the viewport means no crop, without trying the outer ones', () => {
  // the outer ancestors of a too-big container are at least as big; the second box here
  // is artificial and only proves that the walk stops
  assert.equal(cropRect([box(0, 0, 1280, 600), box(100, 100, 300, 200)], { x: 200, y: 150 }, VW, VH), null);
});

test('a container thinner than 40 px gives way to the next ancestor', () => {
  // a 30 px toolbar inside a bigger block
  assert.deepEqual(
    cropRect([box(100, 100, 700, 130), box(100, 80, 700, 400)], { x: 400, y: 115 }, VW, VH),
    { x: 76, y: 56, w: 648, h: 368 },
  );
});

test('a target outside the crop of its container gives way to the next ancestor', () => {
  // autocomplete list overflowing a fieldset, still inside the form
  assert.deepEqual(
    cropRect([box(100, 100, 600, 300), box(80, 80, 620, 560)], { x: 350, y: 500 }, VW, VH),
    { x: 56, y: 56, w: 588, h: 528 },
  );
});

test('a target outside every candidate crop means no crop', () => {
  // dropdown item at y=300 under a 60 px header
  assert.equal(cropRect([box(0, 0, 1280, 60)], { x: 100, y: 300 }, VW, VH), null);
});

test('no semantic container means no crop', () => {
  assert.equal(cropRect([], { x: 10, y: 10 }, VW, VH), null);
});

test('the crop is in whole pixels and its right/bottom edges match the rounded corners', () => {
  const r = cropRect([box(100.4, 100.6, 700.2, 400.7)], { x: 400, y: 250 }, VW, VH);
  assert.deepEqual(r, { x: 76, y: 77, w: 648, h: 348 });
});

test('the factory runs in a bare scope, as it does once inlined into the page script', () => {
  const bare = new Function('return (' + createCropRect.toString() + ')();')();
  assert.deepEqual(bare([box(500, 300, 600, 350)], { x: 550, y: 325 }, VW, VH), { x: 310, y: 205, w: 480, h: 240 });
});
