// tools/recorder/smoke/pdf.mjs
// Smoke do subcomando pdf: gera fixture temporária, roda o bundle, valida o PDF.
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
await fs.writeFile(path.join(dir, 'img', 'passo-01.png'), PNG.sync.write(png));
await fs.writeFile(path.join(dir, 'README.md'),
  '# Doc de teste do PDF\n\n> **Objetivo:** validar a exportação.\n\n### 1. Clique em **Salvar**\n![Passo 1](img/passo-01.png)\n');

const r = spawnSync(process.execPath,
  [path.join(repoRoot, 'dist', 'doc-agent.mjs'), 'pdf', path.join(dir, 'README.md')],
  { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('SMOKE PDF FALHOU (exit ' + r.status + '):\n' + r.stdout + r.stderr);
  process.exit(1);
}
const pdfPath = path.join(dir, path.basename(dir) + '.pdf');
const stat = await fs.stat(pdfPath);
if (stat.size < 1000) { console.error(`SMOKE PDF FALHOU: arquivo suspeito (${stat.size} bytes)`); process.exit(1); }
const html = await fs.readFile(path.join(dir, '.doc-agent-print.html')).catch(() => null);
if (html !== null) { console.error('SMOKE PDF FALHOU: HTML temporário não foi removido'); process.exit(1); }
console.log(`SMOKE PDF OK (${stat.size} bytes em ${pdfPath})`);
