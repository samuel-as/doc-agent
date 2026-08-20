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

  console.log('Abrindo o navegador de gravação (perfil dedicado)...');
  const { browser, proc } = await launchBrowser({ profileDir: path.join(root, 'browser-profile') });
  const context = browser.contexts()[0];
  const recorder = new Recorder(context, session);
  await recorder.start();

  console.log('');
  console.log('● GRAVANDO. Execute o procedimento no navegador que foi aberto.');
  console.log('  (Primeiro uso? Logue nos sistemas nesse perfil — os logins ficam salvos.)');
  console.log('  Feche o navegador para encerrar e consolidar a sessão.');

  let finalizing = false;
  async function finalize() {
    if (finalizing) return;
    finalizing = true;
    console.log('\nConsolidando sessão...');
    let ok = true;
    try {
      const dir = await session.finalize();
      const rel = path.relative(root, dir).replaceAll('\\', '/');
      console.log(`Sessão pronta: ${rel}`);
      console.log(`Gere a documentação com: /gerar-doc ${rel}`);
    } catch (e) {
      console.error(`Falha ao consolidar: ${e.message}`);
      ok = false;
    }
    try { proc.kill(); } catch {}
    process.exit(ok ? 0 : 1);
  }

  process.on('SIGINT', finalize);
  browser.on('disconnected', finalize); // fechar o navegador encerra a gravação
} else if (command === 'pdf' && arg) {
  const { exportPdf } = await import('./pdf.js');
  try {
    const out = await exportPdf(arg);
    console.log(`PDF gerado: ${path.relative(process.cwd(), out).replaceAll('\\', '/')}`);
    process.exit(0);
  } catch (e) {
    console.error(`Falha ao gerar PDF: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log('Uso: doc-agent record <nome-do-procedimento>');
  console.log('     doc-agent pdf <caminho-do-README.md>');
  process.exit(1);
}
