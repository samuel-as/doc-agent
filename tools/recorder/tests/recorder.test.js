// tests/recorder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDING, buildInitScript } from '../src/recorder/instrument.js';
import { Recorder } from '../src/recorder/recorder.js';

test('the injected script contains the binding, the listeners and the reinstall guard', () => {
  const src = buildInitScript();
  assert.ok(src.includes(BINDING));
  assert.ok(src.includes('__docAgentInstalled')); // idempotent on re-injection
  for (const evt of ['mousedown', 'focusin', 'focusout', 'keydown', 'change']) {
    assert.ok(src.includes(`'${evt}'`), `missing ${evt} listener`);
  }
  assert.ok(src.includes('password'));
});

test('labelFor does not fall back to el.value outside button/submit/reset inputs', () => {
  const src = buildInitScript();
  // an unconditional fallback (which would leak a typed password as the label) must not exist
  assert.ok(!src.includes('el.innerText || el.value'), 'unconditional el.value fallback present');
  // the guard restricting el.value to button-like inputs must exist
  assert.ok(src.includes("['button','submit','reset']"), 'button/submit/reset guard missing');
});

test('keydown Enter ignores TEXTAREA and contenteditable (a newline is not a submit)', () => {
  const src = buildInitScript();
  const keydownIdx = src.indexOf("addEventListener('keydown'");
  assert.ok(keydownIdx >= 0, 'keydown listener missing');
  const keydownBody = src.slice(keydownIdx);
  // the guard must live inside the keydown handler (after the listener), not only in isEditable
  assert.ok(
    keydownBody.includes("tagName === 'TEXTAREA' || t.isContentEditable"),
    'TEXTAREA/contenteditable guard missing from the keydown path'
  );
});

function fakes() {
  const calls = [];
  const session = { addEvent: async (ev, shot) => calls.push({ ev, shot }) };
  const page = {
    url: () => 'https://app.example.com/x',
    title: async () => 'System X',
    screenshot: async () => Buffer.from('fake-png'),
  };
  return { calls, session, page };
}

test('takes a screenshot for click and field-focus; never for enter and field-commit', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false, coords: { x: 1, y: 2 } });
  await rec.onEvent(page, { kind: 'field-focus', ts: 2, pageHasPassword: false });
  await rec.onEvent(page, { kind: 'field-commit', ts: 3, pageHasPassword: false, value: 'abc' });
  await rec.onEvent(page, { kind: 'enter', ts: 4, pageHasPassword: false });
  assert.ok(Buffer.isBuffer(calls[0].shot));
  assert.ok(Buffer.isBuffer(calls[1].shot));
  assert.equal(calls[2].shot, null);
  assert.equal(calls[3].shot, null);
});

test('page with a password field: screenshot suppressed', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: true, coords: { x: 1, y: 2 } });
  assert.equal(calls[0].shot, null);
});

test('Recorder enriches the event with url/title and does not leak pageHasPassword', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false, label: 'OK' });
  assert.equal(calls[0].ev.url, 'https://app.example.com/x');
  assert.equal(calls[0].ev.title, 'System X');
  assert.equal(calls[0].ev.label, 'OK');
  assert.ok(!('pageHasPassword' in calls[0].ev));
});

test('screenshot captures are serialized: the next one only starts when the previous finishes', async () => {
  const { session } = fakes();
  const log = [];
  let n = 0;
  const page = {
    url: () => 'https://x', title: async () => 'X',
    screenshot: async () => {
      const id = ++n;
      log.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 20));
      log.push(`end-${id}`);
      return Buffer.from('png');
    },
  };
  const rec = new Recorder(null, session);
  // two concurrent events, like a burst of clicks
  await Promise.all([
    rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false }),
    rec.onEvent(page, { kind: 'click', ts: 2, pageHasPassword: false }),
  ]);
  assert.deepEqual(log, ['start-1', 'end-1', 'start-2', 'end-2']);
});

// A real tab is ONE SAME Page object whose url changes on every navigation —
// the tab fakes must model that (the security state is per Page).
function fakeTab() {
  const tab = {
    _url: 'about:blank',
    _hasPw: false, // what the password evaluate() will answer
    url: () => tab._url,
    title: async () => 'T',
    waitForLoadState: async () => {},
    evaluate: async () => tab._hasPw,
    screenshot: async () => Buffer.from('png'),
  };
  return tab;
}

test('navigation leaving a password screen: URL without query/hash and no screenshot; following steps on the same page too', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  // an event on a login screen marks THIS tab as "has a password"
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, pageHasPassword: true });
  // login submit on the same tab: a GET form leaks the password into the destination URL
  tab._url = 'https://app.example.com/home?pwd=SECRET#tk=SECRET'; tab._hasPw = false;
  await rec.onNavigation(tab);
  assert.equal(calls[1].ev.url, 'https://app.example.com/home'); // no query, no hash
  assert.equal(calls[1].shot, null); // no screenshot on landing from the login
  // a later click on the SAME page: URL stays shortened, screenshots come back
  await rec.onEvent(tab, { kind: 'click', ts: 3, pageHasPassword: false });
  assert.equal(calls[2].ev.url, 'https://app.example.com/home');
  assert.ok(Buffer.isBuffer(calls[2].shot));
  // an ordinary navigation after that: full URL and normal screenshot
  tab._url = 'https://app.example.com/list?tab=2';
  await rec.onNavigation(tab);
  assert.equal(calls[3].ev.url, 'https://app.example.com/list?tab=2');
  assert.ok(Buffer.isBuffer(calls[3].shot));
});

test('multi-tab: a password screen in tab A neither shortens the URL nor suppresses the navigation screenshot in tab B', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tabA = fakeTab();
  const tabB = fakeTab();
  // tab A is on a login screen
  tabA._url = 'https://app.example.com/login'; tabA._hasPw = true;
  await rec.onEvent(tabA, { kind: 'click', ts: 1, pageHasPassword: true });
  // interleaved navigation in tab B: it did NOT come from a password screen
  tabB._url = 'https://intranet.example.com/dashboard?tab=2';
  await rec.onNavigation(tabB);
  assert.equal(calls[1].ev.url, 'https://intranet.example.com/dashboard?tab=2'); // full URL
  assert.ok(Buffer.isBuffer(calls[1].shot)); // normal screenshot
  // an event in tab B (no password) must not clear tab A protection:
  await rec.onEvent(tabB, { kind: 'click', ts: 2, pageHasPassword: false });
  tabA._url = 'https://app.example.com/home?pwd=SECRET'; tabA._hasPw = false;
  await rec.onNavigation(tabA);
  const navA = calls[calls.length - 1];
  assert.equal(navA.ev.url, 'https://app.example.com/home'); // tab A is still protected
  assert.equal(navA.shot, null);
});

test('a click on the destination page during the load does not clear the navigation protection (decided in framenavigated)', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, pageHasPassword: true });
  // a sensitive navigation with a slow load; a click on the destination arrives midway
  tab._url = 'https://app.example.com/home?pwd=SECRET'; tab._hasPw = false;
  let releaseLoad;
  tab.waitForLoadState = () => new Promise((r) => { releaseLoad = r; });
  const nav = rec.onNavigation(tab);
  await new Promise((r) => setTimeout(r, 5)); // onNavigation parked in waitForLoadState
  await rec.onEvent(tab, { kind: 'click', ts: 2, pageHasPassword: false });
  releaseLoad();
  await nav;
  const navCall = calls.find((c) => c.ev.kind === 'navigation');
  assert.equal(navCall.ev.url, 'https://app.example.com/home'); // still without the query
  assert.equal(navCall.shot, null); // and without a screenshot
  // the click that arrived during the load also came out with the shortened URL
  const clickCall = calls.find((c) => c.ev.kind === 'click' && c.ev.ts === 2);
  assert.equal(clickCall.ev.url, 'https://app.example.com/home');
});

test('a screenshot failure does not drop the event (shot null)', async () => {
  const { calls, session } = fakes();
  const page = {
    url: () => 'https://x', title: async () => 'X',
    screenshot: async () => { throw new Error('page closed'); },
  };
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shot, null);
});
