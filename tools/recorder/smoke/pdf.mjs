// tools/recorder/smoke/pdf.mjs
// Smoke test for the pdf subcommand: builds a temp fixture, runs the bundle, validates the PDF.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-pdfsmoke-'));
await fs.mkdir(path.join(dir, 'img'), { recursive: true });
const png = new PNG({ width: 300, height: 120 });
png.data.fill(210);
await fs.writeFile(path.join(dir, 'img', 'step-01.png'), PNG.sync.write(png));
await fs.writeFile(path.join(dir, 'README.md'),
  '# PDF test doc\n\n> **Goal:** validate the export.\n\n### 1. Click **Save**\n![Step 1](img/step-01.png)\n');

const r = spawnSync(process.execPath,
  [path.join(repoRoot, 'dist', 'doc-agent.mjs'), 'pdf', path.join(dir, 'README.md')],
  { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('PDF SMOKE FAILED (exit ' + r.status + '):\n' + r.stdout + r.stderr);
  process.exit(1);
}
const pdfPath = path.join(dir, path.basename(dir) + '.pdf');
const stat = await fs.stat(pdfPath);
if (stat.size < 1000) { console.error(`PDF SMOKE FAILED: suspicious file (${stat.size} bytes)`); process.exit(1); }
const html = await fs.readFile(path.join(dir, '.doc-agent-print.html')).catch(() => null);
if (html !== null) { console.error('PDF SMOKE FAILED: the temporary HTML was not removed'); process.exit(1); }
console.log(`PDF SMOKE OK (${stat.size} bytes at ${pdfPath})`);
