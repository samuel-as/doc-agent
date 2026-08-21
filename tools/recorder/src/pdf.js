// src/pdf.js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { marked } from 'marked';
import { launchBrowser } from './recorder/launch.js';

const CSS = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; max-width: 760px; margin: 0 auto; line-height: 1.5; }
  h1 { font-size: 22pt; border-bottom: 2px solid #003d7a; padding-bottom: 6px; }
  h2 { font-size: 15pt; margin-top: 20pt; }
  h3 { font-size: 13pt; margin-top: 18pt; page-break-after: avoid; }
  blockquote { border-left: 4px solid #003d7a; margin: 8pt 0; padding: 4pt 10pt; background: #f2f6fb; }
  img { max-width: 100%; border: 1px solid #ccc; border-radius: 4px; page-break-inside: avoid; margin: 6pt 0; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 90%; }
  strong { color: #003d7a; }
`;

export function renderHtml(markdown) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${marked.parse(markdown)}</body></html>`;
}

export async function exportPdf(readmePath) {
  const mdAbs = path.resolve(readmePath);
  const dir = path.dirname(mdAbs);
  const markdown = await fs.readFile(mdAbs, 'utf8');
  const htmlPath = path.join(dir, '.doc-agent-print.html'); // next to the README so relative img/ paths resolve
  const slug = path.basename(dir);
  const pdfPath = path.join(dir, `${slug}.pdf`);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-agent-pdf-'));

  await fs.writeFile(htmlPath, renderHtml(markdown));
  let proc = null;
  try {
    const launched = await launchBrowser({ profileDir, port: 9334, headless: true });
    proc = launched.proc;
    const context = launched.browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('file:///' + htmlPath.replaceAll('\\', '/'), { waitUntil: 'load' });
    await page.waitForTimeout(300); // let file:// images settle
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
  } finally {
    try { proc?.kill(); } catch {}
    await fs.rm(htmlPath, { force: true }).catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return pdfPath;
}
