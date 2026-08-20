// tests/pdf.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/pdf.js';

test('renderHtml produz documento completo com título, imagem e negrito', () => {
  const html = renderHtml('# Título do Doc\n\n![Passo 1](img/passo-01.png)\n\nClique em **Salvar**.');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('charset="utf-8"'));
  assert.ok(html.includes('<style>'));
  assert.ok(/<h1[^>]*>Título do Doc<\/h1>/.test(html));
  assert.ok(html.includes('<img src="img/passo-01.png"'));
  assert.ok(html.includes('<strong>Salvar</strong>'));
});
