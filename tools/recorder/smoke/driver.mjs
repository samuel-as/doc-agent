// tools/recorder/smoke/driver.mjs
// Smoke do BUNDLE com Chrome real: inicia dist/doc-agent.mjs em background,
// dirige o navegador por um 2º cliente CDP (eventos confiáveis), encerra
// fechando o navegador (Browser.close via CDP) e valida a sessão gravada.
// Uso: node smoke/driver.mjs            → fixture sem senha (pipeline completo)
//      node smoke/driver.mjs security   → fixture com senha (invariantes de segurança)
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const security = process.argv[2] === 'security';
const name = security ? 'smoke-seguranca' : 'smoke-form';
const SENTINEL = 'SENHA-SENTINELA-123';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const fileUrl = (p) => 'file:///' + p.replaceAll('\\', '/');

const today = new Date().toISOString().slice(0, 10);
const sessionDir = path.join(repoRoot, 'sessions', `${today}-${name}`);
await fs.rm(sessionDir, { recursive: true, force: true });

const cli = spawn(process.execPath, [path.join(repoRoot, 'dist', 'doc-agent.mjs'), 'record', name], {
  cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
});
let cliOut = '';
cli.stdout.on('data', (d) => (cliOut += d));
cli.stderr.on('data', (d) => (cliOut += d));
const cliExit = new Promise((resolve) => cli.on('exit', resolve));

let driver = null;
for (let i = 0; i < 60 && !driver; i++) {
  try { driver = await chromium.connectOverCDP('http://127.0.0.1:9333'); }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!driver) { cli.kill(); throw new Error('CDP não subiu em 30s. Saída do CLI:\n' + cliOut); }

const context = driver.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));

if (security) {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'login.html')));
  await page.click('#user'); await page.fill('#user', 'usuario.demo');
  await page.click('#pwd'); await page.fill('#pwd', SENTINEL);
  await page.click('#entrar');
  await page.waitForLoadState('load');
} else {
  await page.goto(fileUrl(path.join(here, 'fixtures', 'form.html')));
  await page.click('#motivo'); await page.fill('#motivo', 'chamado de teste');
  await page.click('#detalhe'); await page.fill('#detalhe', 'duas linhas');
  await page.selectOption('#tipo', 'Requisição');
  await page.click('#urgente');
  await page.click('#enviar');
  await page.waitForLoadState('load');
}
// Espera os prints assentarem antes de fechar o navegador. Precisa ser > 3s: uma
// captura disparada durante o commit da navegação do submit fica sem resposta do
// Chrome e só é abortada no timeout de 3s do gravador; as demais fluem depois disso
// (o gravador encadeia as capturas, cada uma com orçamento inteiro — medido: fila
// drena em ~4,2s no pior caso neste hardware). 800ms fechava o navegador cedo demais
// e nenhum print de clique sobrevivia.
await new Promise((r) => setTimeout(r, 6000));

// Encerra a gravação FECHANDO o navegador de verdade (gatilho disconnected do CLI)
const cdp = await context.newCDPSession(page);
await cdp.send('Browser.close').catch(() => {});

const exitCode = await cliExit;
check(exitCode === 0, `CLI saiu com ${exitCode}; saída:\n${cliOut}`);

const raw = await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8');
const session = JSON.parse(raw);
const types = session.steps.map((s) => s.type);

if (security) {
  check(!raw.includes(SENTINEL), 'VALOR DA SENHA VAZOU para o session.json');
  const pwdFill = session.steps.find((s) => s.type === 'fill' && s.selector === '#pwd');
  check(!!pwdFill, 'passo fill do campo de senha não registrado');
  check(pwdFill?.isPassword === true && pwdFill?.value === null, 'campo de senha sem máscara correta');
  check(session.steps.every((s) => s.screenshot === null), 'print gerado em página com campo de senha');
  const shots = await fs.readdir(path.join(sessionDir, 'shots')).catch(() => []);
  check(shots.length === 0, `shots/ deveria estar vazio, tem: ${shots.join(', ')}`);
} else {
  const fills = session.steps.filter((s) => s.type === 'fill');
  check(fills.some((s) => s.value === 'chamado de teste'), 'fill do Motivo ausente');
  check(fills.some((s) => s.value === 'duas linhas'), 'fill do Detalhe ausente');
  check(fills.length === 2, `esperava 2 fills, veio ${fills.length} (dedup quebrado?)`);
  check(session.steps.some((s) => s.type === 'select' && s.value === 'Requisição'), 'select ausente');
  check(session.steps.filter((s) => s.type === 'click').length >= 2, 'cliques de checkbox/submit ausentes');
  check(types.includes('navigation'), 'navegação ausente');
  const withShot = session.steps.filter((s) => s.screenshot);
  check(withShot.length > 0, 'nenhum print gerado');
  // marcador: pelo menos um print de clique tem pixels do anel (#e0245e puro no traço)
  const clickShot = session.steps.find((s) => s.type === 'click' && s.screenshot);
  check(!!clickShot, 'nenhum clique com print');
  if (clickShot) {
    const png = PNG.sync.read(await fs.readFile(path.join(sessionDir, clickShot.screenshot.replaceAll('/', path.sep))));
    let markerPixels = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i] === 224 && png.data[i + 1] === 36 && png.data[i + 2] === 94) markerPixels++;
    }
    check(markerPixels > 50, `anel do marcador não encontrado (pixels exatos: ${markerPixels})`);
  }
}

if (failures.length) {
  console.error(`SMOKE ${security ? 'SECURITY' : 'FORM'} FALHOU:`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`SMOKE ${security ? 'SECURITY' : 'FORM'} OK (${session.steps.length} passos em ${path.relative(repoRoot, sessionDir)})`);
