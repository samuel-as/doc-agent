// tests/launch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/recorder/launch.js';

test('findChrome returns the first candidate that exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-'));
  const fake = path.join(dir, 'chrome.exe');
  await fs.writeFile(fake, '');
  assert.equal(findChrome(['C:\\does\\not\\exist\\chrome.exe', fake]), fake);
});

test('findChrome throws an error mentioning DOC_AGENT_CHROME when nothing exists', () => {
  assert.throws(
    () => findChrome(['C:\\does\\not\\exist\\a.exe', 'C:\\does\\not\\exist\\b.exe']),
    /DOC_AGENT_CHROME/,
  );
});
