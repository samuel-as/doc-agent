#!/usr/bin/env node
// src/cli.js
import path from 'node:path';
import { launchBrowser } from './recorder/launch.js';
import { SessionWriter } from './recorder/session.js';
import { Recorder } from './recorder/recorder.js';

function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const [, , command, name] = process.argv;

if (command !== 'record' || !name) {
  console.log('Uso: doc-agent record <nome-do-procedimento>');
  process.exit(1);
}

const root = process.cwd();
const session = new SessionWriter(root, slugify(name));
await session.init();

console.log('Abrindo o navegador de gravação (perfil dedicado)...');
const { browser, proc } = await launchBrowser({ profileDir: path.join(root, 'browser-profile') });
const context = browser.contexts()[0];
const recorder = new Recorder(context, session);
await recorder.start();

console.log('');
console.log('● GRAVANDO. Execute o procedimento no navegador que foi aberto.');
console.log('  (Primeiro uso? Logue nos sistemas nesse perfil — os logins ficam salvos.)');
console.log('  Pressione Ctrl+C aqui no terminal para encerrar e consolidar a sessão.');

let finalizing = false;
async function finalize() {
  if (finalizing) return;
  finalizing = true;
  console.log('\nConsolidando sessão...');
  try {
    const dir = await session.finalize();
    const rel = path.relative(root, dir).replaceAll('\\', '/');
    console.log(`Sessão pronta: ${rel}`);
    console.log(`Gere a documentação com: /gerar-doc ${rel}`);
  } catch (e) {
    console.error(`Falha ao consolidar: ${e.message}`);
  }
  try { proc.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', finalize);
browser.on('disconnected', finalize); // usuário fechou o navegador: consolida também
