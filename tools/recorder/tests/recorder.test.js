// tests/recorder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDING, buildInitScript } from '../src/recorder/instrument.js';
import { Recorder } from '../src/recorder/recorder.js';

test('script injetado contém binding, listeners e guarda de reinstalação', () => {
  const src = buildInitScript();
  assert.ok(src.includes(BINDING));
  assert.ok(src.includes('__docAgentInstalled')); // idempotente em re-injeção
  for (const evt of ['mousedown', 'focusin', 'focusout', 'keydown', 'change']) {
    assert.ok(src.includes(`'${evt}'`), `falta listener de ${evt}`);
  }
  assert.ok(src.includes('password'));
});

test('labelFor não usa el.value como fallback fora de inputs button/submit/reset', () => {
  const src = buildInitScript();
  // fallback incondicional (vazaria senha digitada como label) não pode existir
  assert.ok(!src.includes('el.innerText || el.value'), 'fallback incondicional de el.value presente');
  // a guarda restringindo el.value a inputs tipo botão deve existir
  assert.ok(src.includes("['button','submit','reset']"), 'guarda button/submit/reset ausente');
});

test('keydown Enter ignora TEXTAREA e contenteditable (newline não é submissão)', () => {
  const src = buildInitScript();
  const keydownIdx = src.indexOf("addEventListener('keydown'");
  assert.ok(keydownIdx >= 0, 'listener de keydown ausente');
  const keydownBody = src.slice(keydownIdx);
  // a guarda deve estar dentro do handler de keydown (após o listener), não só em isEditable
  assert.ok(
    keydownBody.includes("tagName === 'TEXTAREA' || t.isContentEditable"),
    'guarda TEXTAREA/contenteditable ausente no caminho do keydown'
  );
});

function fakes() {
  const calls = [];
  const session = { addEvent: async (ev, shot) => calls.push({ ev, shot }) };
  const page = {
    url: () => 'https://app.example.com/x',
    title: async () => 'Sistema X',
    screenshot: async () => Buffer.from('fake-png'),
  };
  return { calls, session, page };
}

test('captura print para click e field-focus; nunca para enter e field-commit', async () => {
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

test('página com campo de senha: print suprimido', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: true, coords: { x: 1, y: 2 } });
  assert.equal(calls[0].shot, null);
});

test('Recorder enriquece o evento com url/title e não vaza pageHasPassword', async () => {
  const { calls, session, page } = fakes();
  const rec = new Recorder(null, session);
  await rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false, label: 'OK' });
  assert.equal(calls[0].ev.url, 'https://app.example.com/x');
  assert.equal(calls[0].ev.title, 'Sistema X');
  assert.equal(calls[0].ev.label, 'OK');
  assert.ok(!('pageHasPassword' in calls[0].ev));
});

test('capturas de screenshot são serializadas: a próxima só começa quando a anterior termina', async () => {
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
  // dois eventos concorrentes, como numa rajada de cliques
  await Promise.all([
    rec.onEvent(page, { kind: 'click', ts: 1, pageHasPassword: false }),
    rec.onEvent(page, { kind: 'click', ts: 2, pageHasPassword: false }),
  ]);
  assert.deepEqual(log, ['start-1', 'end-1', 'start-2', 'end-2']);
});

// Uma aba de verdade é UM MESMO objeto Page cuja url muda a cada navegação —
// os fakes de aba precisam modelar isso (o estado de segurança é por Page).
function fakeTab() {
  const tab = {
    _url: 'about:blank',
    _hasPw: false, // o que o evaluate de senha vai responder
    url: () => tab._url,
    title: async () => 'T',
    waitForLoadState: async () => {},
    evaluate: async () => tab._hasPw,
    screenshot: async () => Buffer.from('png'),
  };
  return tab;
}

test('navegação saindo de tela de senha: URL sem query/hash e sem print; passos seguintes na mesma página também', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  // evento numa tela de login marca ESTA aba como "tem senha"
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, pageHasPassword: true });
  // submit do login na mesma aba: form GET vaza a senha na URL de destino
  tab._url = 'https://app.example.com/home?pwd=SEGREDO#tk=SEGREDO'; tab._hasPw = false;
  await rec.onNavigation(tab);
  assert.equal(calls[1].ev.url, 'https://app.example.com/home'); // sem query nem hash
  assert.equal(calls[1].shot, null); // sem print na chegada do login
  // clique subsequente na MESMA página: URL continua encurtada, print volta ao normal
  await rec.onEvent(tab, { kind: 'click', ts: 3, pageHasPassword: false });
  assert.equal(calls[2].ev.url, 'https://app.example.com/home');
  assert.ok(Buffer.isBuffer(calls[2].shot));
  // navegação comum depois disso: URL completa e print normais
  tab._url = 'https://app.example.com/lista?aba=2';
  await rec.onNavigation(tab);
  assert.equal(calls[3].ev.url, 'https://app.example.com/lista?aba=2');
  assert.ok(Buffer.isBuffer(calls[3].shot));
});

test('multi-aba: tela de senha na aba A não encurta URL nem suprime print de navegação na aba B', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tabA = fakeTab();
  const tabB = fakeTab();
  // aba A está numa tela de login
  tabA._url = 'https://app.example.com/login'; tabA._hasPw = true;
  await rec.onEvent(tabA, { kind: 'click', ts: 1, pageHasPassword: true });
  // navegação intercalada na aba B: NÃO veio de tela de senha
  tabB._url = 'https://intranet.example.com/painel?aba=2';
  await rec.onNavigation(tabB);
  assert.equal(calls[1].ev.url, 'https://intranet.example.com/painel?aba=2'); // URL completa
  assert.ok(Buffer.isBuffer(calls[1].shot)); // print normal
  // evento na aba B (sem senha) não pode limpar a proteção da aba A:
  await rec.onEvent(tabB, { kind: 'click', ts: 2, pageHasPassword: false });
  tabA._url = 'https://app.example.com/home?pwd=SEGREDO'; tabA._hasPw = false;
  await rec.onNavigation(tabA);
  const navA = calls[calls.length - 1];
  assert.equal(navA.ev.url, 'https://app.example.com/home'); // aba A continua protegida
  assert.equal(navA.shot, null);
});

test('clique na página de destino durante o load não limpa a proteção da navegação (decisão no framenavigated)', async () => {
  const { calls, session } = fakes();
  const rec = new Recorder(null, session);
  const tab = fakeTab();
  tab._url = 'https://app.example.com/login'; tab._hasPw = true;
  await rec.onEvent(tab, { kind: 'click', ts: 1, pageHasPassword: true });
  // navegação sensível cujo load demora; um clique no destino chega no meio
  tab._url = 'https://app.example.com/home?pwd=SEGREDO'; tab._hasPw = false;
  let releaseLoad;
  tab.waitForLoadState = () => new Promise((r) => { releaseLoad = r; });
  const nav = rec.onNavigation(tab);
  await new Promise((r) => setTimeout(r, 5)); // onNavigation parado no waitForLoadState
  await rec.onEvent(tab, { kind: 'click', ts: 2, pageHasPassword: false });
  releaseLoad();
  await nav;
  const navCall = calls.find((c) => c.ev.kind === 'navigation');
  assert.equal(navCall.ev.url, 'https://app.example.com/home'); // segue sem query
  assert.equal(navCall.shot, null); // e sem print
  // o clique que chegou durante o load também saiu com a URL encurtada
  const clickCall = calls.find((c) => c.ev.kind === 'click' && c.ev.ts === 2);
  assert.equal(clickCall.ev.url, 'https://app.example.com/home');
});

test('falha no screenshot não derruba o evento (shot null)', async () => {
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
