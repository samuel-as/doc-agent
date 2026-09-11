// tests/recorder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDING, buildInitScript } from '../src/recorder/instrument.js';
import { Recorder, SETTLE_EXPR } from '../src/recorder/recorder.js';

test('the injected script contains the binding, the listeners and the reinstall guard', () => {
  const src = buildInitScript();
  assert.ok(src.includes(BINDING));
  assert.ok(src.includes('__docAgentInstalled')); // idempotent on re-injection
  for (const evt of ['mousedown', 'focusin', 'focusout', 'keydown', 'change', 'dragstart', 'drop']) {
    assert.ok(src.includes(`'${evt}'`), `missing ${evt} listener`);
  }
  assert.ok(src.includes('composedPath'), 'shadow DOM: must resolve the real target via composedPath');
  assert.ok(src.includes("cursor === 'pointer'"), 'pointer-cursor fallback for role-less clickables');
  assert.ok(src.includes('__docAgentSensitiveRects'), 'page must expose sensitive rects for navigation shots');
  assert.ok(src.includes('hasPasswordField'), 'every event must report whether the page has a password field');
  assert.ok(!src.includes('pageHasPassword'), 'page-level suppression is gone');
});

test('labelFor does not fall back to el.value outside button/submit/reset inputs', () => {
  const src = buildInitScript();
  assert.ok(!src.includes('el.innerText || el.value'), 'unconditional el.value fallback present');
  assert.ok(src.includes("['button','submit','reset']"), 'button/submit/reset guard missing');
});

test('labelFor never uses the innerText of a contenteditable: that IS the typed value', () => {
  const src = buildInitScript();
  const body = src.slice(src.indexOf('const labelFor'), src.indexOf('const cssPath'));
  const guard = body.indexOf('el.isContentEditable');
  const innerText = body.indexOf('el.innerText');
  assert.ok(guard >= 0, 'contenteditable guard missing in labelFor');
  assert.ok(guard < innerText, 'the guard must come before the innerText fallback');
});

test('keydown: Enter ignores TEXTAREA/contenteditable; shortcuts skip copy/paste/select-all/undo', () => {
  const src = buildInitScript();
  const keydownIdx = src.indexOf("addEventListener('keydown'");
  assert.ok(keydownIdx >= 0, 'keydown listener missing');
  const body = src.slice(keydownIdx);
  assert.ok(body.includes("tagName === 'TEXTAREA' || t.isContentEditable"), 'TEXTAREA/contenteditable guard missing');
  assert.ok(body.includes("['C','V','A','Z']"), 'copy/paste/select-all/undo exclusion missing');
});

test('shortcut and enter carry no label when nothing interactive is focused', () => {
  const src = buildInitScript();
  assert.ok(src.includes('const focusTarget'), 'focusTarget guard missing');
  const keydown = src.slice(src.indexOf("addEventListener('keydown'"));
  assert.ok(keydown.includes("base('shortcut', focusTarget(t))"), 'shortcut must go through focusTarget');
  assert.ok(keydown.includes("base('enter', focusTarget(t))"), 'enter must go through focusTarget');
});

test('the injected script embeds the sensitivity classifier and it runs in a bare scope', () => {
  const src = buildInitScript();
  assert.ok(src.includes('function sensitivityOf'), 'classifier not inlined');
  // the inlined factory must be valid standalone JS (no references to module scope)
  const start = src.indexOf('(function createSensitivity');
  const end = src.indexOf(')();', start) + 1;
  const factory = src.slice(start, end);
  const fn = new Function('return ' + factory + '();')();
  assert.equal(fn({ type: 'text', name: 'senha', value: '' }), 'password');
});

function fakes() {
  const calls = [];
  const session = { addEvent: async (ev, shot) => calls.push({ ev, shot }) };
  const page = {
    _rects: [], // what the page answers when the recorder measures the rects for a capture
    url: () => 'https://app.example.com/x',
    title: async () => 'System X',
    evaluate: async () => page._rects,
    screenshot: async () => Buffer.from('fake-png'),
  };
  return { calls, session, page };
}

const NO_RECTS = [];
const PW_RECTS = [{ x: 10, y: 10, w: 100, h: 20, reason: 'password' }];

test('takes a screenshot for click, field-focus, check, shortcut, drag-start; never for enter, field-commit, drag', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  for (const kind of ['click', 'field-focus', 'check', 'shortcut', 'drag-start']) {
    await rec.onEvent(page, { kind, ts: 1, sensitiveRects: NO_RECTS });
  }
  for (const kind of ['enter', 'field-commit', 'drag']) {
    await rec.onEvent(page, { kind, ts: 2, sensitiveRects: NO_RECTS, value: 'abc' });
  }
  assert.ok(calls.slice(0, 5).every((c) => Buffer.isBuffer(c.shot)));
  assert.ok(calls.slice(5).every((c) => c.shot === null));
});

test('a page with a password field STILL gets a screenshot (redaction happens later, from the rects)', async () => {
  const { calls, session, page } = fakes();
  page._rects = PW_RECTS;
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, coords: { x: 1, y: 2 } });
  assert.ok(Buffer.isBuffer(calls[0].shot));
  assert.deepEqual(calls[0].ev.sensitiveRects, PW_RECTS);
});

// The rects must describe the screen AT THE MOMENT OF THE CAPTURE: they are measured in
// _capture, right before page.screenshot(), never when the event fired — the capture queue
// can lag seconds behind the mousedown that produced the event, and boxes measured then
// would be painted over whatever moved in the meantime.
function pageWithRects(rects) {
  return {
    url: () => 'https://app.example.com/x',
    title: async () => 'System X',
    evaluate: async () => rects,
    screenshot: async () => Buffer.from('fake-png'),
  };
}

test('the recorded rects are the ones measured at capture time, not the ones from the payload', async () => {
  const { calls, session } = fakes();
  const atCapture = [{ x: 80, y: 200, w: 120, h: 24, reason: 'password' }];
  const rec = new Recorder(null, session);
  await rec.onEvent(pageWithRects(atCapture), { kind: 'click', ts: 1, sensitiveRects: PW_RECTS });
  assert.deepEqual(calls[0].ev.sensitiveRects, atCapture);
});

test('an event whose page cannot report its rects gets no screenshot (privacy first)', async () => {
  const { calls, session } = fakes();
  const page = pageWithRects(null);
  page.evaluate = async () => { throw new Error('cannot evaluate here'); };
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, sensitiveRects: PW_RECTS });
  assert.equal(calls[0].shot, null);
  assert.deepEqual(calls[0].ev.sensitiveRects, []);
});

test('an event from a child frame gets no screenshot: its rects are relative to the iframe', async () => {
  const { calls, session, page } = fakes();
  page._rects = PW_RECTS;
  page.mainFrame = () => 'main';
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, label: 'Save' }, 'inner');
  assert.equal(calls[0].shot, null);
  assert.equal(calls[0].ev.frame, 'child'); // raw marker; the consolidation drops it
  assert.equal(calls[0].ev.label, 'Save'); // the step itself is still recorded
});

test('an event from the main frame is captured as usual', async () => {
  const { calls, session, page } = fakes();
  page.mainFrame = () => 'main';
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1 }, 'main');
  assert.ok(Buffer.isBuffer(calls[0].shot));
  assert.ok(!('frame' in calls[0].ev));
});

test('an event without sensitiveRects gets an empty list (never undefined) and no leftover fields', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, label: 'OK' });
  assert.deepEqual(calls[0].ev.sensitiveRects, []);
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
    evaluate: async () => [],
    screenshot: async () => {
      const id = ++n;
      log.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 20));
      log.push(`end-${id}`);
      return Buffer.from('png');
    },
  };
  const rec = new Recorder(null, session);
  await Promise.all([
    rec.onEvent(page, { kind: 'click', ts: 1, sensitiveRects: NO_RECTS }),
    rec.onEvent(page, { kind: 'click', ts: 2, sensitiveRects: NO_RECTS }),
  ]);
  assert.deepEqual(log, ['start-1', 'end-1', 'start-2', 'end-2']);
});

// A real tab is ONE SAME Page object whose url changes on every navigation —
// the tab fakes must model that (the security state is per Page).
function fakeTab() {
  const tab = {
    _url: 'about:blank',
    _hasPw: false,   // answer to the password-field probe
    _rects: [],      // answer to __docAgentSensitiveRects()
    _settleDelay: 0, // how long the settle evaluate takes
    url: () => tab._url,
    title: async () => 'T',
    waitForLoadState: async () => {},
    evaluate: async (expr) => {
      const s = String(expr);
      if (s.includes('__docAgentLastMutation')) { await new Promise((r) => setTimeout(r, tab._settleDelay)); return true; }
      if (s.includes('__docAgentSensitiveRects')) return tab._rects;
      if (s.includes('input[type="password"]')) {
        if (tab._probeThrows) throw new Error('execution context destroyed');
        return tab._hasPw;
      }
      return undefined; // init script re-injection
    },
    screenshot: async () => Buffer.from('png'),
  };
  return tab;
}

test('navigation: screenshot taken with the page rects attached; URL kept in full when not coming from a password screen', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/list?tab=2'; tab._rects = [];
  await rec.onNavigation(tab);
  assert.equal(calls[0].ev.kind, 'navigation');
  assert.equal(calls[0].ev.url, 'https://app.example.com/list?tab=2');
  assert.ok(Buffer.isBuffer(calls[0].shot));
  assert.deepEqual(calls[0].ev.sensitiveRects, []);
});

test('navigation onto a login page: screenshot taken, password rects attached for redaction', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login'; tab._hasPw = true; tab._rects = PW_RECTS;
  await rec.onNavigation(tab);
  assert.ok(Buffer.isBuffer(calls[0].shot));
  assert.deepEqual(calls[0].ev.sensitiveRects, PW_RECTS);
});

test('navigation leaving a password screen: URL without query/hash (screenshot allowed); following steps on the same page too', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, hasPasswordField: true }); // marks THIS tab as "has a password field"
  tab._url = 'https://app.example.com/home?pwd=SECRET#tk=SECRET'; tab._hasPw = false; tab._rects = [];
  await rec.onNavigation(tab);
  assert.equal(calls[1].ev.url, 'https://app.example.com/home'); // no query, no hash
  assert.ok(Buffer.isBuffer(calls[1].shot));                      // screenshot is no longer suppressed
  await rec.onEvent(tab, { kind: 'click', ts: 3, sensitiveRects: [] });
  assert.equal(calls[2].ev.url, 'https://app.example.com/home');  // still shortened on the same page
  tab._url = 'https://app.example.com/list?tab=2';
  await rec.onNavigation(tab);
  assert.equal(calls[3].ev.url, 'https://app.example.com/list?tab=2'); // ordinary navigation: full URL
});

test('multi-tab: a password screen in tab A does not shorten URLs in tab B', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tabA = fakeTab();
  const tabB = fakeTab();
  tabA._url = 'https://app.example.com/login'; tabA._hasPw = true;
  await rec.onEvent(tabA, { kind: 'click', ts: 1, hasPasswordField: true });
  tabB._url = 'https://intranet.example.com/dashboard?tab=2';
  await rec.onNavigation(tabB);
  assert.equal(calls[1].ev.url, 'https://intranet.example.com/dashboard?tab=2');
  await rec.onEvent(tabB, { kind: 'click', ts: 2, sensitiveRects: [] });
  tabA._url = 'https://app.example.com/home?pwd=SECRET'; tabA._hasPw = false;
  await rec.onNavigation(tabA);
  assert.equal(calls[calls.length - 1].ev.url, 'https://app.example.com/home'); // tab A is still protected
});

test('a click on the destination page during the load does not clear the URL protection (decided in framenavigated)', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, hasPasswordField: true });
  tab._url = 'https://app.example.com/home?pwd=SECRET'; tab._hasPw = false;
  let releaseLoad;
  // only the 'load' wait is held open; the networkidle wait after it resolves at once
  tab.waitForLoadState = (state) => (state === 'load' ? new Promise((r) => { releaseLoad = r; }) : Promise.resolve());
  const nav = rec.onNavigation(tab);
  await new Promise((r) => setTimeout(r, 5));
  await rec.onEvent(tab, { kind: 'click', ts: 2, sensitiveRects: [] });
  releaseLoad();
  await nav;
  assert.equal(calls.find((c) => c.ev.kind === 'navigation').ev.url, 'https://app.example.com/home');
  assert.equal(calls.find((c) => c.ev.kind === 'click' && c.ev.ts === 2).ev.url, 'https://app.example.com/home');
});

test('navigation: when the page cannot report its rects, no screenshot is taken (privacy first)', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'chrome://settings';
  tab.evaluate = async () => { throw new Error('cannot evaluate here'); };
  await rec.onNavigation(tab);
  assert.equal(calls[0].shot, null);
  assert.deepEqual(calls[0].ev.sensitiveRects, []);
});

test('settle waits for the page to go quiet but never longer than its cap', async () => {
  const { session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab.evaluate = () => new Promise(() => {}); // a frozen page never answers
  const t0 = Date.now();
  await rec.settle(tab);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 1900 && elapsed < 3000, `settle took ${elapsed}ms; expected ~2000ms cap`);
});

test('a screenshot failure does not drop the event (shot null)', async () => {
  const { calls, session } = fakes();
  const page = {
    url: () => 'https://x', title: async () => 'X',
    evaluate: async () => [],
    screenshot: async () => { throw new Error('page closed'); },
  };
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, sensitiveRects: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shot, null);
});

test('the password flag comes from the page itself, not from the visible rects', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  // A password field that is hidden, inside a shadow root or off-screen produces no rect,
  // yet the page IS a login screen and its submit URL must be shortened.
  tab._url = 'https://app.example.com/login';
  await rec.onEvent(tab, { kind: 'click', ts: 1, hasPasswordField: true, sensitiveRects: [] });
  assert.ok(!('hasPasswordField' in calls[0].ev), 'internal flag must not be recorded');
  tab._url = 'https://app.example.com/home?pwd=SECRET#tk=SECRET';
  await rec.onNavigation(tab);
  assert.equal(calls[1].ev.url, 'https://app.example.com/home');
});

test('a page whose password probe fails counts as a password screen (fail closed)', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login';
  tab._probeThrows = true;
  await rec.onNavigation(tab);
  tab._probeThrows = false;
  tab._url = 'https://app.example.com/home?token=SECRET';
  await rec.onNavigation(tab);
  assert.equal(calls[1].ev.url, 'https://app.example.com/home');
});

// Runs the page-side settle expression against a SIMULATED clock: setTimeout only moves
// virtual time forward, so the contract (quiet window, cap) is measured without sleeping.
// `mutationsAt` are the virtual timestamps at which the DOM mutates.
async function settleAt(mutationsAt) {
  let now = 0;
  const timers = [];
  const win = { __docAgentLastMutation: 0 };
  const pending = [...mutationsAt];
  const promise = new Function('window', 'Date', 'setTimeout', 'return ' + SETTLE_EXPR)(
    win,
    { now: () => now },
    (fn, ms) => timers.push({ at: now + ms, fn }),
  );
  let resolvedAt = null;
  promise.then(() => { resolvedAt = now; });
  await Promise.resolve();
  while (resolvedAt === null && timers.length) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    now = t.at;
    while (pending.length && pending[0] <= now) win.__docAgentLastMutation = pending.shift();
    t.fn();
    await Promise.resolve();
  }
  return resolvedAt;
}

test('settle waits for the new screen to render and only then for the quiet window', async () => {
  // A page (or SPA route) that shows a spinner and renders 700ms later is perfectly quiet
  // in between: a plain quiet window would resolve at 300ms and capture the spinner.
  assert.equal(await settleAt([700]), 1000);
});

test('settle keeps waiting while the DOM is still mutating', async () => {
  assert.equal(await settleAt([100, 400, 600]), 900);
});

test('settle gives up at its cap when the page renders nothing at all', async () => {
  assert.equal(await settleAt([]), 1500);
});
