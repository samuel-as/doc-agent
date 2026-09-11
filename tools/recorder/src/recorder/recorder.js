// src/recorder/recorder.js
import { BINDING, buildInitScript } from './instrument.js';

const NO_SCREENSHOT_KINDS = new Set(['enter', 'field-commit', 'drag']);

// Resolves once the screen for the new URL has rendered AND the DOM has then been quiet
// for `quiet` ms, or after `cap` ms at most. It reads __docAgentLastMutation, kept by the
// persistent observer the injected script installs at document start: an observer created
// here would only start watching after framenavigated -> load -> a round trip, missing
// everything that happened in between.
// A mutation AFTER the wait starts is what counts as "rendered": a page (or an SPA route)
// that shows a spinner and paints 700 ms later is perfectly quiet in the meantime, and a
// plain quiet window would capture the spinner. The price is that a page which renders
// nothing after 'load' only resolves at the cap.
export const SETTLE_EXPR = `new Promise((resolve) => {
  const quiet = 300, cap = 1500, step = 50, t0 = Date.now();
  const tick = () => {
    const last = window.__docAgentLastMutation || 0;
    if (Date.now() - t0 >= cap) return resolve(true);
    if (last > t0 && Date.now() - last >= quiet) return resolve(true);
    setTimeout(tick, step);
  };
  tick();
})`;
const SETTLE_NODE_CAP_MS = 2000; // if the page never answers, do not hang the recording

const RECTS_EXPR = `(window.__docAgentSensitiveRects ? window.__docAgentSensitiveRects() : null)`;

export class Recorder {
  constructor(context, session) {
    this.context = context;
    this.session = session;
    this._shotChain = Promise.resolve();
    // PER-TAB security state: "this page has a password field" and "this page was
    // reached from a password screen" are facts about a single tab — in a multi-tab
    // context, a login screen in tab A must not shorten URLs in tab B (and vice versa).
    this._pageState = new WeakMap(); // Page -> { hadPasswordField, sensitiveBase }
  }

  _stateFor(page) {
    let st = this._pageState.get(page);
    if (!st) {
      st = { hadPasswordField: false, sensitiveBase: null };
      this._pageState.set(page, st);
    }
    return st;
  }

  async start() {
    await this.context.exposeBinding(BINDING, (source, payloadJson) => {
      return this.onEvent(source.page, JSON.parse(payloadJson), source.frame).catch(() => {});
    });
    await this.context.addInitScript(buildInitScript());
    for (const page of this.context.pages()) await this.attach(page);
    this.context.on('page', (page) => this.attach(page).catch(() => {}));
  }

  async attach(page) {
    // already-open pages only get the init script after a navigation — inject it now
    await page.evaluate(buildInitScript()).catch(() => {});
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.onNavigation(page).catch(() => {});
    });
  }

  async settle(page) {
    await Promise.race([
      page.evaluate(SETTLE_EXPR).catch(() => {}),
      new Promise((r) => setTimeout(r, SETTLE_NODE_CAP_MS)),
    ]);
  }

  async onNavigation(page) {
    // A navigation LEAVING a password screen is sensitive: a login submit can carry
    // credentials in the URL (GET form, token in the query/fragment). In that case the
    // URL is recorded without query/hash; while the resulting page stays the same, the
    // URLs of the following steps are shortened too. The decision is made HERE,
    // synchronously in framenavigated, before any await: an event on the destination
    // page during loading must not clear the flag. Screenshots are no longer suppressed —
    // sensitive fields are painted over from the rects instead.
    const st = this._stateFor(page);
    const cameFromPassword = st.hadPasswordField;
    const applySensitivity = () => {
      const base = page.url().split(/[?#]/)[0];
      if (cameFromPassword) st.sensitiveBase = base;
      else if (base !== st.sensitiveBase) st.sensitiveBase = null;
    };
    applySensitivity(); // protection applies right away to events arriving during the load
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    // A screen whose content arrives over the network is only worth capturing once the
    // requests are done; the settle below then waits for it to be painted.
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await this.settle(page);
    await page.evaluate(buildInitScript()).catch(() => {}); // re-instrument after the navigation
    // Fails CLOSED: if the page cannot answer (detached context, chrome:// page), assume a
    // password field is there — a URL kept in full on a login screen leaks a credential,
    // while a URL shortened by mistake only loses a query string from the guide.
    const hasPw = await page
      .evaluate(`!!document.querySelector('input[type="password"]')`)
      .catch(() => true);
    st.hadPasswordField = hasPw;
    applySensitivity(); // reapply with the final URL (redirects during the load)
    const cap = await this.screenshot(page);
    await this.session.addEvent({
      kind: 'navigation', ts: Date.now(),
      url: this._safeUrl(page), title: await page.title().catch(() => null),
      label: null, selector: null, isSensitive: false, sensitiveReason: null, isEditable: false,
      value: null, coords: null, sensitiveRects: cap.rects ?? [],
    }, cap.buf);
  }

  async onEvent(page, payload, frame = null) {
    // hasPasswordField is internal: it drives the URL rule and is not recorded. Reading it
    // from the rects instead only saw VISIBLE light-DOM fields, so a login screen whose
    // password input was hidden or off-screen let the submit URL through with its query.
    const { hasPasswordField, ...ev } = payload;
    this._stateFor(page).hadPasswordField = !!hasPasswordField;
    // addInitScript and exposeBinding run in EVERY frame, but a rect measured inside an
    // iframe is relative to the IFRAME viewport: painted on the screenshot of the whole
    // page it would blank the wrong area and leave the real field readable. So a
    // child-frame event gets no image. TODO: translate the coordinates with the offset of
    // frame.frameElement() and capture these too. page.evaluate (RECTS_EXPR, the settle)
    // always runs in the main frame, so navigation captures are unaffected.
    const inChildFrame = !!frame && typeof page.mainFrame === 'function' && frame !== page.mainFrame();
    const wantsShot = !NO_SCREENSHOT_KINDS.has(ev.kind) && !inChildFrame;
    // The rects stored with the event are the ones measured inside _capture, right before
    // the pixels — the ones in the payload were measured when the event fired and the
    // capture queue may only get to this page seconds later.
    const cap = wantsShot ? await this.screenshot(page) : null;
    await this.session.addEvent({
      isSensitive: false, sensitiveReason: null, isEditable: false, value: null, coords: null,
      label: null, selector: null,
      ...ev,
      ...(inChildFrame ? { frame: 'child' } : null),
      sensitiveRects: cap?.rects ?? [],
      url: this._safeUrl(page),
      title: await page.title().catch(() => null),
    }, cap?.buf ?? null);
  }

  // Strips query/hash from the URL when THIS tab was reached from a password
  // screen (see onNavigation) — credentials never reach session.json.
  _safeUrl(page) {
    const url = page.url();
    const base = url.split(/[?#]/)[0];
    return this._stateFor(page).sensitiveBase === base ? base : url;
  }

  // Screenshots are serialized HERE, not only inside playwright: playwright already
  // queues screenshots per page, but each page.screenshot() timeout counts from the
  // CALL — under a burst of events, one hanging capture (a race with a navigation
  // commit leaves Chrome unresponsive until the 3s timeout) ate the budget of every
  // capture waiting in line and they all came back null. Chaining them here, each
  // capture only calls page.screenshot() with its full budget.
  // Resolves to { buf, rects }: the pixels and the sensitive boxes that describe THEM.
  screenshot(page) {
    const shot = this._shotChain.then(() => this._capture(page));
    this._shotChain = shot; // _capture never rejects, so the chain never breaks
    return shot;
  }

  async _capture(page) {
    // Rects are measured HERE, immediately before the pixels, so the boxes and the image
    // describe the same screen. If the page cannot report them, there is no screenshot at
    // all: an unredacted sensitive field must never reach the disk.
    let rects = null;
    try {
      rects = await page.evaluate(RECTS_EXPR);
    } catch { /* no init script in this document (chrome://, closed tab) */ }
    if (!Array.isArray(rects)) return { buf: null, rects: null };
    try {
      return { buf: await page.screenshot({ scale: 'css', timeout: 3000 }), rects };
    } catch (e) {
      if (process.env.DOC_AGENT_DEBUG) console.error('DEBUG screenshot failed:', e);
      return { buf: null, rects }; // screenshot failed: the step goes on without an image
    }
  }
}
