// tests/consolidate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidate } from '../src/recorder/consolidate.js';

function ev(kind, overrides = {}) {
  return {
    kind, ts: 1000, url: 'https://app.example.com/x', title: 'System X',
    label: null, selector: null, isSensitive: false, sensitiveReason: null, isEditable: false,
    value: null, coords: null, screenshot: null, sensitiveRects: [], ...overrides,
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

test('sensitive field: the fill step exists, value is null even if something leaks, reason is kept', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#otp', label: 'Verification code', isSensitive: true, sensitiveReason: 'otp', value: 'leaked!' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, null);
  assert.equal(steps[0].isSensitive, true);
  assert.equal(steps[0].sensitiveReason, 'otp');
  assert.equal(steps[0].label, 'Verification code');
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

test('fill inherits the sensitiveRects of the focus event that provided its screenshot', () => {
  const rects = [{ x: 1, y: 2, w: 3, h: 4, reason: 'password' }];
  const steps = consolidate([
    ev('click', { selector: '#user', isEditable: true, screenshot: 'shots/raw-001.png', sensitiveRects: rects }),
    ev('field-commit', { selector: '#user', value: 'demo', sensitiveRects: [] }),
  ]);
  assert.deepEqual(steps[0].sensitiveRects, rects);
});

test('check becomes a step with on/off value; repeats within 500ms collapse', () => {
  const steps = consolidate([
    ev('check', { selector: '#urgent', label: 'Urgent', value: 'on', ts: 1000, coords: { x: 3, y: 4 }, screenshot: 'shots/raw-001.png' }),
    ev('check', { selector: '#urgent', label: 'Urgent', value: 'on', ts: 1200 }),
    ev('check', { selector: '#urgent', label: 'Urgent', value: 'off', ts: 3000 }),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'check');
  assert.equal(steps[0].value, 'on');
  assert.deepEqual(steps[0].coords, { x: 3, y: 4 });
  assert.equal(steps[1].value, 'off');
});

test('shortcut becomes a step with the combo as value; repeats within 500ms collapse', () => {
  const steps = consolidate([
    ev('shortcut', { value: 'Ctrl+S', ts: 1000, screenshot: 'shots/raw-001.png' }),
    ev('shortcut', { value: 'Ctrl+S', ts: 1300 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'shortcut');
  assert.equal(steps[0].value, 'Ctrl+S');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
});

test('drag-start + drag become one drag step with the screenshot/coords of the start and the drop target', () => {
  const steps = consolidate([
    ev('drag-start', { label: 'Task A', selector: '#item-a', coords: { x: 10, y: 10 }, screenshot: 'shots/raw-001.png', ts: 1000 }),
    ev('drag', { label: 'Task A', selector: '#item-a', target: 'Done', ts: 1500 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'drag');
  assert.equal(steps[0].label, 'Task A');
  assert.equal(steps[0].target, 'Done');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
  assert.deepEqual(steps[0].coords, { x: 10, y: 10 });
});

test('a drag-start without a drop produces no step', () => {
  assert.equal(consolidate([ev('drag-start', { selector: '#a' })]).length, 0);
});

test('scrolled: true when the click happened after scrolling more than half a viewport on the same page', () => {
  const steps = consolidate([
    ev('click', { selector: '#a', ts: 1000, scrollY: 0, viewportH: 800 }),
    ev('click', { selector: '#b', ts: 2000, scrollY: 900, viewportH: 800 }),
    ev('click', { selector: '#c', ts: 3000, scrollY: 1000, viewportH: 800 }), // only 100px further
  ]);
  assert.equal(steps[0].scrolled, false);
  assert.equal(steps[1].scrolled, true);
  assert.equal(steps[2].scrolled, false);
});

test('scrolled resets on navigation and is tracked per page (URL without query/hash)', () => {
  const steps = consolidate([
    ev('click', { selector: '#a', ts: 1000, scrollY: 0, viewportH: 800, url: 'https://x/list' }),
    ev('navigation', { ts: 1500, url: 'https://x/detail?id=1' }),
    ev('click', { selector: '#b', ts: 2000, scrollY: 900, viewportH: 800, url: 'https://x/detail?id=1' }), // first action on the page
    ev('click', { selector: '#c', ts: 3000, scrollY: 0, viewportH: 800, url: 'https://x/detail?id=1' }),   // scrolled back up
  ]);
  assert.equal(steps[2].scrolled, false);
  assert.equal(steps[3].scrolled, true);
});

test('fill uses the scroll of the focus event, not of the commit', () => {
  const steps = consolidate([
    ev('click', { selector: '#a', ts: 1000, scrollY: 0, viewportH: 800 }),
    ev('click', { selector: '#notes', isEditable: true, ts: 2000, scrollY: 900, viewportH: 800 }),
    ev('field-commit', { selector: '#notes', value: 'ok', ts: 3000, scrollY: 0, viewportH: 800 }),
  ]);
  assert.equal(steps[1].type, 'fill');
  assert.equal(steps[1].scrolled, true);
});

test('steps do not expose scrollY/viewportH/isEditable', () => {
  const [s] = consolidate([ev('click', { selector: '#a', scrollY: 10, viewportH: 800, isEditable: false })]);
  assert.ok(!('scrollY' in s) && !('viewportH' in s) && !('isEditable' in s));
});

test('the raw child-frame marker does not reach the step', () => {
  const steps = consolidate([ev('click', { selector: '#a', frame: 'child' })]);
  assert.equal(steps[0].frame, undefined);
});
