// tests/consolidate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidate } from '../src/recorder/consolidate.js';

function ev(kind, overrides = {}) {
  return {
    kind, ts: 1000, url: 'https://app.example.com/x', title: 'Sistema X',
    label: null, selector: null, isPassword: false, isEditable: false,
    value: null, coords: null, screenshot: null, ...overrides,
  };
}

test('clique em elemento interativo vira passo click com print e coords', () => {
  const steps = consolidate([
    ev('click', { label: 'Novo Chamado', selector: '#novo', coords: { x: 10, y: 20 }, screenshot: 'shots/raw-001.png' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'click');
  assert.equal(steps[0].index, 1);
  assert.equal(steps[0].label, 'Novo Chamado');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
  assert.deepEqual(steps[0].coords, { x: 10, y: 20 });
});

test('cliques repetidos no mesmo seletor em <500ms viram um passo; >=500ms viram dois', () => {
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

test('digitação consolida em um passo fill que herda print e coords do clique no campo', () => {
  const steps = consolidate([
    ev('click', { selector: '#motivo', isEditable: true, coords: { x: 5, y: 6 }, screenshot: 'shots/raw-001.png' }),
    ev('field-commit', { selector: '#motivo', label: 'Motivo', value: 'VPN caiu' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, 'VPN caiu');
  assert.equal(steps[0].screenshot, 'shots/raw-001.png');
  assert.deepEqual(steps[0].coords, { x: 5, y: 6 });
});

test('field-focus (foco via Tab) também fornece print ao fill', () => {
  const steps = consolidate([
    ev('field-focus', { selector: '#obs', screenshot: 'shots/raw-002.png' }),
    ev('field-commit', { selector: '#obs', label: 'Observações', value: 'ok' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].screenshot, 'shots/raw-002.png');
});

test('field-commit com valor vazio é descartado (clicou e saiu sem digitar)', () => {
  const steps = consolidate([
    ev('click', { selector: '#obs', isEditable: true }),
    ev('field-commit', { selector: '#obs', value: '' }),
  ]);
  assert.equal(steps.length, 0);
});

test('senha: passo fill existe, mas value é null mesmo se algo vazar no evento', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#pwd', label: 'Senha', isPassword: true, value: 'vazou!' }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, null);
  assert.equal(steps[0].isPassword, true);
  assert.equal(steps[0].label, 'Senha');
});

test('field-commit repetido (mesmo seletor e valor, sem novo foco) vira um passo fill', () => {
  // Enter comita; focusout logo depois comita de novo com o mesmo valor
  const steps = consolidate([
    ev('field-focus', { selector: '#busca' }),
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 1000 }),
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 1050 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[0].value, 'vpn');
});

test('field-commit repetido com field-focus intermediário vira dois passos (re-edição real)', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 1000 }),
    ev('field-focus', { selector: '#busca', ts: 2000 }),
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 3000 }),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'fill');
  assert.equal(steps[1].type, 'fill');
});

test('field-commit repetido com clique editável intermediário vira dois passos', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 1000 }),
    ev('click', { selector: '#busca', isEditable: true, ts: 2000 }),
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 3000 }),
  ]);
  assert.equal(steps.length, 2);
});

test('field-commit no mesmo seletor com valor diferente vira dois passos', () => {
  const steps = consolidate([
    ev('field-commit', { selector: '#busca', value: 'vpn', ts: 1000 }),
    ev('field-commit', { selector: '#busca', value: 'vpn caiu', ts: 2000 }),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].value, 'vpn');
  assert.equal(steps[1].value, 'vpn caiu');
});

test('navegações para a mesma URL em <1s viram um passo', () => {
  const steps = consolidate([
    ev('navigation', { url: 'https://app.example.com/ok', ts: 1000, screenshot: 'shots/raw-003.png' }),
    ev('navigation', { url: 'https://app.example.com/ok', ts: 1400 }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'navigation');
});

test('enter vira passo sem print', () => {
  const steps = consolidate([ev('enter', { label: 'Buscar' })]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'enter');
  assert.equal(steps[0].screenshot, null);
});

test('índices são sequenciais 1..n na ordem dos eventos', () => {
  const steps = consolidate([
    ev('click', { selector: '#a', ts: 1000 }),
    ev('navigation', { url: 'https://x/2', ts: 2000 }),
    ev('click', { selector: '#b', ts: 3000 }),
  ]);
  assert.deepEqual(steps.map((s) => s.index), [1, 2, 3]);
});
