#!/usr/bin/env node
// src/cli.js
import path from 'node:path';

function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const [, , command, arg] = process.argv;

if (command === 'record' && arg) {
  const { launchBrowser } = await import('./recorder/launch.js');
  const { SessionWriter } = await import('./recorder/session.js');
  const { Recorder } = await import('./recorder/recorder.js');

  const root = process.cwd();
  const session = new SessionWriter(root, slugify(arg));
  await session.init();

  console.log('Opening the recording browser (dedicated profile)...');
  const { browser, proc } = await launchBrowser({ profileDir: path.join(root, 'browser-profile') });
  const context = browser.contexts()[0];
  const recorder = new Recorder(context, session);
  await recorder.start();

  console.log('');
  console.log('● RECORDING. Run the procedure in the browser that just opened.');
  console.log('  (First time? Sign in to your systems in this profile — the logins are kept.)');
  console.log('  Close the browser to stop recording and consolidate the session.');

  let finalizing = false;
  async function finalize() {
    if (finalizing) return;
    finalizing = true;
    console.log('\nConsolidating session...');
    let ok = true;
    try {
      const dir = await session.finalize();
      const rel = path.relative(root, dir).replaceAll('\\', '/');
      console.log(`Session ready: ${rel}`);
      console.log(`Generate the documentation with: /generate-doc ${rel}`);
    } catch (e) {
      console.error(`Failed to consolidate: ${e.message}`);
      ok = false;
    }
    try { proc.kill(); } catch {}
    process.exit(ok ? 0 : 1);
  }

  process.on('SIGINT', finalize);
  browser.on('disconnected', finalize); // closing the browser ends the recording
} else if (command === 'pdf' && arg) {
  const { exportPdf } = await import('./pdf.js');
  try {
    const out = await exportPdf(arg);
    console.log(`PDF generated: ${path.relative(process.cwd(), out).replaceAll('\\', '/')}`);
    process.exit(0);
  } catch (e) {
    console.error(`Failed to generate the PDF: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log('Usage: doc-agent record <procedure-name>');
  console.log('       doc-agent pdf <path-to-README.md>');
  process.exit(1);
}
