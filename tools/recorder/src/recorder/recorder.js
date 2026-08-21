// src/recorder/recorder.js
import { BINDING, buildInitScript } from './instrument.js';

const NO_SCREENSHOT_KINDS = new Set(['enter', 'field-commit']);

export class Recorder {
  constructor(context, session) {
    this.context = context;
    this.session = session;
    this._shotChain = Promise.resolve();
    // PER-TAB security state: "this page has a password field" and "this page was
    // reached from a password screen" are facts about a single tab — in a multi-tab
    // context, a login screen in tab A must not suppress screenshots nor shorten
    // URLs for navigations in tab B (and vice versa).
    this._pageState = new WeakMap(); // Page -> { hadPassword, sensitiveBase }
  }

  _stateFor(page) {
    let st = this._pageState.get(page);
    if (!st) {
      st = { hadPassword: false, sensitiveBase: null };
      this._pageState.set(page, st);
    }
    return st;
  }

  async start() {
    await this.context.exposeBinding(BINDING, (source, payloadJson) => {
      return this.onEvent(source.page, JSON.parse(payloadJson)).catch(() => {});
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

  async onNavigation(page) {
    // A navigation LEAVING a password screen is sensitive: a login submit can carry
    // credentials in the URL (GET form, token in the query/fragment). In that case the
    // URL is recorded without query/hash and the screenshot is suppressed; while the
    // resulting page stays the same, the URLs of the following steps are shortened too.
    // The decision is made HERE, synchronously in framenavigated, before any await:
    // an event on the destination page during loading must not clear the flag.
    const st = this._stateFor(page);
    const cameFromPassword = st.hadPassword;
    const applySensitivity = () => {
      const base = page.url().split(/[?#]/)[0];
      if (cameFromPassword) st.sensitiveBase = base;
      else if (base !== st.sensitiveBase) st.sensitiveBase = null;
    };
    applySensitivity(); // protection applies right away to events arriving during the load
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(buildInitScript()).catch(() => {}); // re-instrument after the navigation
    const hasPw = await page
      .evaluate(`!!document.querySelector('input[type="password"]')`)
      .catch(() => true); // when in doubt, do not take a screenshot
    st.hadPassword = hasPw;
    applySensitivity(); // reapply with the final URL (redirects during the load)
    const shot = hasPw || cameFromPassword ? null : await this.screenshot(page);
    await this.session.addEvent({
      kind: 'navigation', ts: Date.now(),
      url: this._safeUrl(page), title: await page.title().catch(() => null),
      label: null, selector: null, isPassword: false, isEditable: false,
      value: null, coords: null,
    }, shot);
  }

  async onEvent(page, payload) {
    const { pageHasPassword, ...ev } = payload;
    this._stateFor(page).hadPassword = pageHasPassword;
    const wantsShot = !pageHasPassword && !NO_SCREENSHOT_KINDS.has(ev.kind);
    const shot = wantsShot ? await this.screenshot(page) : null;
    await this.session.addEvent({
      isPassword: false, isEditable: false, value: null, coords: null,
      label: null, selector: null,
      ...ev,
      url: this._safeUrl(page),
      title: await page.title().catch(() => null),
    }, shot);
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
  screenshot(page) {
    const shot = this._shotChain.then(() => this._capture(page));
    this._shotChain = shot; // _capture never rejects, so the chain never breaks
    return shot;
  }

  async _capture(page) {
    try {
      return await page.screenshot({ scale: 'css', timeout: 3000 });
    } catch (e) {
      if (process.env.DOC_AGENT_DEBUG) console.error('DEBUG screenshot failed:', e);
      return null; // screenshot failed: the step goes on without an image
    }
  }
}
