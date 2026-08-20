// src/recorder/recorder.js
import { BINDING, buildInitScript } from './instrument.js';

const NO_SCREENSHOT_KINDS = new Set(['enter', 'field-commit']);

export class Recorder {
  constructor(context, session) {
    this.context = context;
    this.session = session;
    this._shotChain = Promise.resolve();
    this._lastPageHadPassword = false; // última informação conhecida sobre a página atual
    this._sensitiveBase = null; // url (sem query/hash) de página alcançada a partir de tela de senha
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
    // Navegação que SAI de uma tela de senha é sensível: um submit de login pode
    // carregar credenciais na URL (form GET, token em query/fragment). Nesse caso a
    // URL é registrada sem query/hash e o print é suprimido; enquanto a página
    // resultante for a mesma, as URLs dos passos seguintes também são encurtadas.
    const cameFromPassword = this._lastPageHadPassword;
    this._lastPageHadPassword = hasPw;
    const base = page.url().split(/[?#]/)[0];
    if (cameFromPassword) this._sensitiveBase = base;
    else if (base !== this._sensitiveBase) this._sensitiveBase = null;
    const shot = hasPw || cameFromPassword ? null : await this.screenshot(page);
    await this.session.addEvent({
      kind: 'navigation', ts: Date.now(),
      url: this._safeUrl(page.url()), title: await page.title().catch(() => null),
      label: null, selector: null, isPassword: false, isEditable: false,
      value: null, coords: null,
    }, shot);
  }

  async onEvent(page, payload) {
    const { pageHasPassword, ...ev } = payload;
    this._lastPageHadPassword = pageHasPassword;
    const wantsShot = !pageHasPassword && !NO_SCREENSHOT_KINDS.has(ev.kind);
    const shot = wantsShot ? await this.screenshot(page) : null;
    await this.session.addEvent({
      isPassword: false, isEditable: false, value: null, coords: null,
      label: null, selector: null,
      ...ev,
      url: this._safeUrl(page.url()),
      title: await page.title().catch(() => null),
    }, shot);
  }

  // Corta query/hash da URL quando a página atual foi alcançada a partir de uma
  // tela de senha (ver onNavigation) — credenciais nunca vão para o session.json.
  _safeUrl(url) {
    const base = url.split(/[?#]/)[0];
    return this._sensitiveBase === base ? base : url;
  }

  // Serializa as capturas AQUI, não só no playwright: o playwright já enfileira
  // screenshots por página, mas o timeout de cada page.screenshot() conta a partir
  // da CHAMADA — sob rajada de eventos, uma captura pendurada (corrida com o commit
  // de uma navegação fica sem resposta do Chrome até o timeout de 3s) consumia o
  // orçamento de todas as que esperavam na fila e todas voltavam null. Encadeando
  // aqui, cada captura só chama page.screenshot() com o orçamento inteiro.
  screenshot(page) {
    const shot = this._shotChain.then(() => this._capture(page));
    this._shotChain = shot; // _capture nunca rejeita, a corrente nunca quebra
    return shot;
  }

  async _capture(page) {
    try {
      return await page.screenshot({ scale: 'css', timeout: 3000 });
    } catch (e) {
      if (process.env.DOC_AGENT_DEBUG) console.error('DEBUG screenshot falhou:', e);
      return null; // print falhou: passo segue sem imagem
    }
  }
}
