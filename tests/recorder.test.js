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
