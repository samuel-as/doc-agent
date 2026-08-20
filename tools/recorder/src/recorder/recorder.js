// src/recorder/recorder.js
import { BINDING, buildInitScript } from './instrument.js';

const NO_SCREENSHOT_KINDS = new Set(['enter', 'field-commit']);

export class Recorder {
  constructor(context, session) {
    this.context = context;
    this.session = session;
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
    // páginas já abertas não recebem o init script até navegar — injeta direto
    await page.evaluate(buildInitScript()).catch(() => {});
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.onNavigation(page).catch(() => {});
    });
  }

  async onNavigation(page) {
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(buildInitScript()).catch(() => {}); // garante instrumentação pós-navegação
    const hasPw = await page
      .evaluate(`!!document.querySelector('input[type="password"]')`)
      .catch(() => true); // na dúvida, não fotografa
    const shot = hasPw ? null : await this.screenshot(page);
    await this.session.addEvent({
      kind: 'navigation', ts: Date.now(),
      url: page.url(), title: await page.title().catch(() => null),
      label: null, selector: null, isPassword: false, isEditable: false,
      value: null, coords: null,
    }, shot);
  }

  async onEvent(page, payload) {
    const { pageHasPassword, ...ev } = payload;
    const wantsShot = !pageHasPassword && !NO_SCREENSHOT_KINDS.has(ev.kind);
    const shot = wantsShot ? await this.screenshot(page) : null;
    await this.session.addEvent({
      isPassword: false, isEditable: false, value: null, coords: null,
      label: null, selector: null,
      ...ev,
      url: page.url(),
      title: await page.title().catch(() => null),
    }, shot);
  }

  async screenshot(page) {
    try {
      return await page.screenshot({ scale: 'css', timeout: 3000 });
    } catch {
      return null; // print falhou: passo segue sem imagem
    }
  }
}
