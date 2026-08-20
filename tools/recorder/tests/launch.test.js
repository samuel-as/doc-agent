// tests/launch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/recorder/launch.js';

test('findChrome devolve o primeiro candidato existente', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const fake = path.join(dir, 'chrome.exe');
  await fs.writeFile(fake, '');
  assert.equal(findChrome(['C:\\nao\\existe\\chrome.exe', fake]), fake);
});

test('findChrome lança erro citando DOC_AGENT_CHROME quando nada existe', () => {
  assert.throws(
    () => findChrome(['C:\\nao\\existe\\a.exe', 'C:\\nao\\existe\\b.exe']),
    /DOC_AGENT_CHROME/,
  );
});
