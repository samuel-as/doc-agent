// tests/pdf.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/pdf.js';

test('renderHtml produces a full document with title, image and bold text', () => {
  const html = renderHtml('# Doc Title\n\n![Step 1](screenshots/step-01.png)\n\nClick **Save**.');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('charset="utf-8"'));
  assert.ok(html.includes('<style>'));
  assert.ok(/<h1[^>]*>Doc Title<\/h1>/.test(html));
  assert.ok(html.includes('<img src="screenshots/step-01.png"'));
  assert.ok(html.includes('<strong>Save</strong>'));
});
