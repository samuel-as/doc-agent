import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSensitivity, sensitivityOf } from '../src/recorder/sensitivity.js';

const f = (o) => ({ type: 'text', autocomplete: null, name: null, id: null, placeholder: null, ariaLabel: null, labelText: null, value: '', ...o });

test('autocomplete tokens win: password, otp, card, phone', () => {
  assert.equal(sensitivityOf(f({ autocomplete: 'current-password' })), 'password');
  assert.equal(sensitivityOf(f({ autocomplete: 'new-password' })), 'password');
  assert.equal(sensitivityOf(f({ autocomplete: 'one-time-code' })), 'otp');
  assert.equal(sensitivityOf(f({ autocomplete: 'cc-number' })), 'card');
  assert.equal(sensitivityOf(f({ autocomplete: 'cc-csc' })), 'card');
  assert.equal(sensitivityOf(f({ autocomplete: 'tel' })), 'phone');
  assert.equal(sensitivityOf(f({ autocomplete: 'tel-national' })), 'phone');
});

test('type=password is always password', () => {
  assert.equal(sensitivityOf(f({ type: 'password', name: 'whatever' })), 'password');
});

test('names and labels: accents, camelCase, underscores and Portuguese words', () => {
  assert.equal(sensitivityOf(f({ name: 'senha' })), 'password');
  assert.equal(sensitivityOf(f({ labelText: 'Contraseña' })), 'password');
  assert.equal(sensitivityOf(f({ id: 'codigoVerificacao' })), 'otp');
  assert.equal(sensitivityOf(f({ labelText: 'Código de verificação' })), 'otp');
  assert.equal(sensitivityOf(f({ name: 'otpCode' })), 'otp');
  assert.equal(sensitivityOf(f({ id: 'auth-mfa-otpcode' })), 'otp');
  assert.equal(sensitivityOf(f({ name: 'cardNumber' })), 'card');
  assert.equal(sensitivityOf(f({ labelText: 'Número do cartão' })), 'card');
  assert.equal(sensitivityOf(f({ placeholder: 'CVV' })), 'card');
  assert.equal(sensitivityOf(f({ labelText: 'Validade do cartão' })), 'card');
  assert.equal(sensitivityOf(f({ name: 'cpf' })), 'document');
  assert.equal(sensitivityOf(f({ id: 'cpf_cnpj' })), 'document');
  assert.equal(sensitivityOf(f({ labelText: 'RG' })), 'document');
  assert.equal(sensitivityOf(f({ name: 'telefone' })), 'phone');
  assert.equal(sensitivityOf(f({ labelText: 'Celular' })), 'phone');
  assert.equal(sensitivityOf(f({ type: 'tel' })), 'phone');
});

test('otp only for text-like inputs and never for promo/postal-like names', () => {
  assert.equal(sensitivityOf(f({ name: 'token', type: 'checkbox' })), null);
  assert.equal(sensitivityOf(f({ name: 'promoCode' })), null);
  assert.equal(sensitivityOf(f({ name: 'cupom_code' })), null);
  assert.equal(sensitivityOf(f({ labelText: 'Zip code' })), null);
  assert.equal(sensitivityOf(f({ name: 'bankCode' })), null);
});

test('values alone: valid CPF/CNPJ and Luhn card numbers; nothing else', () => {
  assert.equal(sensitivityOf(f({ name: 'doc', value: '529.982.247-25' })), 'document'); // valid CPF
  assert.equal(sensitivityOf(f({ name: 'doc', value: '529.982.247-26' })), null);      // bad check digit
  assert.equal(sensitivityOf(f({ name: 'x', value: '11.222.333/0001-81' })), 'document'); // valid CNPJ
  assert.equal(sensitivityOf(f({ name: 'x', value: '4111 1111 1111 1111' })), 'card');   // Luhn ok
  assert.equal(sensitivityOf(f({ name: 'x', value: '4111 1111 1111 1112' })), null);     // Luhn fails
  assert.equal(sensitivityOf(f({ name: 'x', value: '11987654321' })), null); // phone needs a name/autocomplete
});

test('business fields stay readable: ticket number, project code, email, cep, reason', () => {
  assert.equal(sensitivityOf(f({ name: 'numero_chamado', value: '20260911' })), null);
  assert.equal(sensitivityOf(f({ id: 'codigoProjeto', value: 'PRJ-42' })), null);
  assert.equal(sensitivityOf(f({ name: 'email', type: 'email', value: 'a@example.com' })), null);
  assert.equal(sensitivityOf(f({ autocomplete: 'email', value: 'a@example.com' })), null);
  assert.equal(sensitivityOf(f({ name: 'cep', value: '01310-100' })), null);
  assert.equal(sensitivityOf(f({ labelText: 'Reason', value: 'VPN is down' })), null);
  assert.equal(sensitivityOf(f({ labelText: 'Passenger name' })), null); // "pass" must match whole words only
});

test('the factory is self-contained: it survives toString() + eval in a bare scope', () => {
  const rebuilt = new Function('return (' + createSensitivity.toString() + ')();')();
  assert.equal(rebuilt(f({ name: 'senha' })), 'password');
  assert.equal(rebuilt(f({ name: 'reason', value: 'ok' })), null);
});

test('labels with trailing punctuation still match: "Telefone:", "Senha:", "CPF*"', () => {
  assert.equal(sensitivityOf(f({ labelText: 'Telefone:' })), 'phone');
  assert.equal(sensitivityOf(f({ type: 'text', labelText: 'Senha:' })), 'password');
  assert.equal(sensitivityOf(f({ labelText: 'CPF*' })), 'document');
  assert.equal(sensitivityOf(f({ labelText: '(11) Celular' })), 'phone');
  assert.equal(sensitivityOf(f({ labelText: 'Passenger name:' })), null); // still whole words only
});
