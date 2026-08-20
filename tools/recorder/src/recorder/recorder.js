// src/recorder/recorder.js
import { BINDING, buildInitScript } from './instrument.js';

const NO_SCREENSHOT_KINDS = new Set(['enter', 'field-commit']);

export class Recorder {
  constructor(context, session) {
    this.context = context;
    this.session = session;
    this._shotChain = Promise.resolve();
    // Estado de segurança POR ABA (Page): os fatos "esta página tem campo de senha"
    // e "esta página foi alcançada a partir de uma tela de senha" são de cada aba —
    // num contexto multi-aba, uma tela de login na aba A não pode suprimir prints
    // nem encurtar URLs de navegações da aba B (e vice-versa).
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
    // páginas já abertas não recebem o init script até navegar — injeta direto
    await page.evaluate(buildInitScript()).catch(() => {});
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.onNavigation(page).catch(() => {});
    });
  }

  async onNavigation(page) {
    // Navegação que SAI de uma tela de senha é sensível: um submit de login pode
    // carregar credenciais na URL (form GET, token em query/fragment). Nesse caso a
    // URL é registrada sem query/hash e o print é suprimido; enquanto a página
    // resultante for a mesma, as URLs dos passos seguintes também são encurtadas.
    // A decisão é tomada AQUI, síncrona no framenavigated, antes de qualquer await:
    // um evento na página de destino durante o carregamento não pode limpar a flag.
    const st = this._stateFor(page);
    const cameFromPassword = st.hadPassword;
    const applySensitivity = () => {
      const base = page.url().split(/[?#]/)[0];
      if (cameFromPassword) st.sensitiveBase = base;
      else if (base !== st.sensitiveBase) st.sensitiveBase = null;
    };
    applySensitivity(); // proteção vale desde já para eventos que cheguem durante o load
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(buildInitScript()).catch(() => {}); // garante instrumentação pós-navegação
    const hasPw = await page
      .evaluate(`!!document.querySelector('input[type="password"]')`)
      .catch(() => true); // na dúvida, não fotografa
    st.hadPassword = hasPw;
    applySensitivity(); // reaplica com a URL final (redirecionamentos durante o load)
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

  // Corta query/hash da URL quando ESTA aba foi alcançada a partir de uma tela
  // de senha (ver onNavigation) — credenciais nunca vão para o session.json.
  _safeUrl(page) {
    const url = page.url();
    const base = url.split(/[?#]/)[0];
    return this._stateFor(page).sensitiveBase === base ? base : url;
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
