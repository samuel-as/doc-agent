// tests/consolidate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidate } from '../src/recorder/consolidate.js';

function ev(kind, overrides = {}) {
  return {
    kind, ts: 1000, url: 'https://app.example.com/x', title: 'System X',
    label: null, selector: null, isPassword: false, isEditable: false,
    value: null, coords: null, screenshot: null, ...overrides,
  };
}

test('a click on an interactive element becomes a click step with screenshot and coords', () => {
  const steps = consolidate([
    ev('click', { label: 'New Ticket', selector: '#new', coords: { x: 10, y: 20 }, screenshot: 'shots/raw-001.png' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'click');
  assert.equal(steps[0].index, 1);
  assert.equal(steps[0].label, 'New Ticket');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
  assert.deepEqual(steps[0].coords, { x: 10, y: 20 });
});

test('repeated clicks on the same selector within <500ms collapse into one step; >=500ms make two', () => {
  const rapid = consolidate([
    ev('click', { selector: '#a', ts: 1000 }),
    ev('click', { selector: '#a', ts: 1300 }),
  ]);
  assert.equal(rapid.length, 1);

  const slow = consolidate([
    ev('click', { selector: '#a', ts: 1000 }),
    ev('click', { selector: '#a', ts: 1600 }),
  ]);
  assert.equal(slow.length, 2);
});

test('typing collapses into one fill step that inherits screenshot and coords from the click on the field', () => {
  const steps = consolidate([
    ev('click', { selector: '#reason', isEditable: true, coords: { x: 5, y: 6 }, screenshot: 'shots/raw-001.png' }),
    ev('field-commit', { selector: '#reason', label: 'Reason', value: 'VPN is down' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, 'VPN is down');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
  assert.deepEqual(steps[0].coords, { x: 5, y: 6 });
});

test('field-focus (focus via Tab) also provides the screenshot for the fill', () => {
  const steps = consolidate([
    ev('field-focus', { selector: '#notes', screenshot: 'shots/raw-002.png' }),
    ev('field-commit', { selector: '#notes', label: 'Notes', value: 'ok' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].screenshot, 'shots/raw-002.png');
});

test('field-commit with an empty value is dropped (clicked in and left without typing)', () => {
  const steps = consolidate([
    ev('click', { selector: '#notes', isEditable: true }),
    ev('field-commit', { selector: '#notes', value: '' }),
  ]);
  assert.equal(steps.length, 0);
});

test('password: the fill step exists, but value is null even if something leaks into the event', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#pwd', label: 'Password', isPassword: true, value: 'leaked!' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, null);
  assert.equal(steps[0].isPassword, true);
  assert.equal(steps[0].label, 'Password');
});

test('a repeated field-commit (same selector and value, no new focus) becomes one fill step', () => {
  // Enter commits; the focusout right after commits again with the same value
  const steps = consolidate([
    ev('field-focus', { selector: '#search' }),
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 1000 }),
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 1050 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, 'vpn');
});

test('a repeated field-commit with a field-focus in between becomes two steps (a real re-edit)', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 1000 }),
    ev('field-focus', { selector: '#search', ts: 2000 }),
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 3000 }),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[1].type, 'fill');
});

test('a repeated field-commit with an editable click in between becomes two steps', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 1000 }),
    ev('click', { selector: '#search', isEditable: true, ts: 2000 }),
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 3000 }),
  ]);
  assert.equal(steps.length, 2);
});

test('field-commit on the same selector with a different value becomes two steps', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#search', value: 'vpn', ts: 1000 }),
    ev('field-commit', { selector: '#search', value: 'vpn is down', ts: 2000 }),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].value, 'vpn');
  assert.equal(steps[1].value, 'vpn is down');
});

test('navigations to the same URL within <1s collapse into one step', () => {
  const steps = consolidate([
    ev('navigation', { url: 'https://app.example.com/ok', ts: 1000, screenshot: 'shots/raw-003.png' }),
    ev('navigation', { url: 'https://app.example.com/ok', ts: 1400 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'navigation');
});

test('enter becomes a step with no screenshot', () => {
  const steps = consolidate([ev('enter', { label: 'Search' })]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'enter');
  assert.equal(steps[0].screenshot, null);
});

test('indexes are sequential 1..n in event order', () => {
  const steps = consolidate([
    ev('click', { selector: '#a', ts: 1000 }),
    ev('navigation', { url: 'https://x/2', ts: 2000 }),
    ev('click', { selector: '#b', ts: 3000 }),
  ]);
  assert.deepEqual(steps.map((s) => s.index), [1, 2, 3]);
});
