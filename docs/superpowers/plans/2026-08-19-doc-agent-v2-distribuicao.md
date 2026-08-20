# doc-agent v2 — Distribuição sem fricção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o doc-agent v1 (que exige Node/terminal) em uma ferramenta que o time usa só com Claude Code: clonar o repo, rodar `/documentar <nome>`, executar o procedimento, fechar o navegador e receber a doc (com PDF opcional).

**Architecture:** O repositório é reestruturado (fonte em `tools/recorder/`, skills em primeiro plano). O código roda na máquina do usuário como **bundle legível commitado** (`dist/doc-agent.mjs`, esbuild sem minify) sobre um **Node portátil oficial** baixado do nodejs.org na 1ª execução (`bootstrap.ps1` → `runtime/`, gitignored). `sharp` sai (vira `pngjs`, JS puro) para o bundle não ter binário nativo. Um subcomando `pdf` novo converte o markdown gerado em PDF via Chrome/Edge headless (CDP).

**Tech Stack:** Node.js ≥ 22 (ESM, `node:test`), `playwright-core`, `pngjs`, `marked`, `esbuild` (dev), PowerShell 5.1 (bootstrap).

**Spec:** `docs/superpowers/specs/2026-08-19-doc-agent-v2-distribuicao-design.md`

## Global Constraints

- **Nada de instalar nada** na máquina do usuário: sem npm install, sem winget/scoop, sem exe empacotado. O único binário da solução é o `node.exe` do zip oficial do nodejs.org (assinado OpenJS/DigiCert).
- O que roda no usuário é `runtime\node.exe dist\doc-agent.mjs ...` — o bundle é commitado, **legível (minify: false)**, gerado por `tools/recorder/build.mjs`.
- Encerramento da gravação: **fechar o navegador** (gatilho `disconnected` → finalize). Ctrl+C não faz parte da UX.
- Portas CDP: **9333** para gravação, **9334** para o PDF headless.
- `runtime/`, `sessions/`, `browser-profile/`, `node_modules/` e a documentação gerada (`docs/*` exceto `docs/superpowers/`) são **gitignored**. `dist/doc-agent.mjs` é **commitado**.
- Documentação gerada: pt-BR, tom imperativo (regras da SKILL.md de gerar-doc).
- Plataforma: Windows; Chrome ou Edge já instalados. PowerShell do bootstrap compatível com 5.1 (sem `&&`, sem ternário).
- Segurança (invariantes da v1 que os smokes desta v2 passam a garantir a cada build): valor de campo `type=password` nunca aparece no `session.json` (nem via `label`); páginas com campo de senha visível não geram prints.
- Máquina de desenvolvimento: node/npm via scoop em `~/scoop/apps/nodejs-lts/current` (pode faltar no PATH — prefixe `$env:Path = "$env:USERPROFILE\scoop\apps\nodejs-lts\current;$env:Path"` em PowerShell ou `export PATH="$HOME/scoop/apps/nodejs-lts/current:$PATH"` em bash).

## Estrutura de arquivos (estado final)

```
doc-agent/
├── README.md                          # reescrito (Task 6)
├── .gitignore                         # atualizado (Task 6)
├── .claude/skills/
│   ├── documentar/
│   │   ├── SKILL.md                   # nova (Task 6)
│   │   └── scripts/bootstrap.ps1      # novo (Task 5)
│   └── gerar-doc/SKILL.md             # revisada (Task 6)
├── tools/recorder/
│   ├── src/                           # movido de src/ (Task 1)
│   │   ├── cli.js                     # reescrito: subcomandos record|pdf (Task 4)
│   │   ├── pdf.js                     # novo (Task 4)
│   │   └── recorder/
│   │       ├── consolidate.js         # inalterado
│   │       ├── instrument.js          # inalterado
│   │       ├── recorder.js            # inalterado
│   │       ├── session.js             # inalterado
│   │       ├── marker.js              # reescrito com pngjs (Task 2)
│   │       └── launch.js              # ganha opção headless (Task 4)
│   ├── tests/                         # movido de tests/ (Task 1); marker/session adaptados (Task 2); pdf novo (Task 4)
│   ├── smoke/
│   │   ├── driver.mjs                 # smoke do bundle: form | security (Task 3)
│   │   ├── pdf.mjs                    # smoke do PDF (Task 4)
│   │   └── fixtures/{form,ok,login}.html  # (Task 3)
│   ├── package.json                   # movido; deps ajustadas (Tasks 1-4)
│   └── build.mjs                      # novo (Task 3)
├── dist/doc-agent.mjs                 # bundle commitado (Task 3, regenerado nas Tasks 4 e 7)
└── docs/superpowers/                  # única parte de docs/ versionada
```

---

### Task 1: Migrar a estrutura para tools/recorder

Mover fonte, testes e manifesto npm para `tools/recorder/` sem nenhuma mudança de código, mantendo a suíte verde.

**Files:**
- Move: `src/` → `tools/recorder/src/`
- Move: `tests/` → `tools/recorder/tests/`
- Move: `package.json`, `package-lock.json` → `tools/recorder/`

**Interfaces:**
- Consumes: repositório v1 no estado atual (suíte 26/26 verde na raiz).
- Produces: `tools/recorder/` autocontido; `npm test` rodado DENTRO de `tools/recorder` passa 26/26. Tarefas seguintes só trabalham dentro de `tools/recorder/` (exceto skills/README).

- [ ] **Step 1: Mover com git mv**

```bash
mkdir -p tools/recorder
git mv src tools/recorder/src
git mv tests tools/recorder/tests
git mv package.json tools/recorder/package.json
git mv package-lock.json tools/recorder/package-lock.json
```

- [ ] **Step 2: Recriar node_modules no novo local e remover o da raiz**

Run (PowerShell, na raiz do repo):
```powershell
$env:Path = "$env:USERPROFILE\scoop\apps\nodejs-lts\current;$env:Path"
Remove-Item -Recurse -Force node_modules
Set-Location tools\recorder
npm ci
```
Expected: instala sem erro (o lockfile foi junto; caminhos internos do package.json são relativos e continuam válidos).

- [ ] **Step 3: Rodar a suíte no novo local**

Run: `npm test` (dentro de `tools/recorder`)
Expected: PASS 26/26 — nenhum teste referencia caminho fora da pasta do pacote.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move fonte do gravador para tools/recorder (estrutura v2)"
```

---

### Task 2: marker.js com pngjs (fim do binário nativo)

Trocar sharp por pngjs no desenho do marcador e nos helpers de teste. Zero mudança de interface.

**Files:**
- Rewrite: `tools/recorder/src/recorder/marker.js`
- Modify: `tools/recorder/tests/marker.test.js` (helpers de PNG)
- Modify: `tools/recorder/tests/session.test.js` (helper `tinyPng`)
- Modify: `tools/recorder/package.json` (remove `sharp`, adiciona `pngjs`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `drawMarker(inputPng: Buffer, {x, y}) => Promise<Buffer>` — mesma assinatura da v1 (anel `#e0245e`, raio 22, traço 4, preenchimento translúcido 0.25, clamp nas bordas, mesmas dimensões). `session.js` não muda.

- [ ] **Step 1: Trocar as dependências**

Run (dentro de `tools/recorder`):
```powershell
npm uninstall sharp
npm install pngjs@^7.0.0
```
Expected: `package.json` fica com dependencies = `playwright-core`, `pngjs`.

- [ ] **Step 2: Adaptar os testes (falharão contra o marker.js atual, que ainda importa sharp)**

Substituir o conteúdo de `tools/recorder/tests/marker.test.js` por:

```js
// tests/marker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { drawMarker } from '../src/recorder/marker.js';

function blankPng(width, height) {
  const png = new PNG({ width, height });
  png.data.fill(255); // branco opaco (RGBA)
  return PNG.sync.write(png);
}

function pixelAt(pngBuffer, x, y) {
  const png = PNG.sync.read(pngBuffer);
  const i = (png.width * y + x) << 2;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
}

test('desenha anel vermelho nas coordenadas, mantendo dimensões', async () => {
  const out = await drawMarker(blankPng(200, 100), { x: 100, y: 50 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);

  const ring = pixelAt(out, 100 + 22, 50); // sobre o traço do anel (raio 22)
  assert.ok(ring.r > 150 && ring.g < 120, `esperava vermelho no anel, veio ${JSON.stringify(ring)}`);

  const outside = pixelAt(out, 10, 10);
  assert.ok(outside.r > 240 && outside.g > 240, 'longe do anel deve continuar branco');
});

test('coordenadas na borda são clampeadas sem lançar erro', async () => {
  const out = await drawMarker(blankPng(100, 100), { x: 0, y: 0 });
  const meta = PNG.sync.read(out);
  assert.equal(meta.width, 100);
});
```

Em `tools/recorder/tests/session.test.js`, trocar o import de sharp e o helper `tinyPng` (os `await tinyPng()` nos call sites continuam válidos — await de valor não-promise é no-op):

```js
// substituir: import sharp from 'sharp';
import { PNG } from 'pngjs';

// substituir a função tinyPng existente por:
function tinyPng() {
  const png = new PNG({ width: 50, height: 50 });
  png.data.fill(255);
  return PNG.sync.write(png);
}
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/marker.test.js tests/session.test.js`
Expected: FAIL — `Cannot find package 'sharp'` (marker.js ainda importa sharp, que foi removido).

- [ ] **Step 4: Reescrever marker.js com pngjs**

```js
// src/recorder/marker.js
import { PNG } from 'pngjs';

const RADIUS = 22;
const STROKE = 4;
const COLOR = { r: 224, g: 36, b: 94 }; // #e0245e
const FILL_ALPHA = 0.25;

export async function drawMarker(inputPng, { x, y }) {
  const png = PNG.sync.read(inputPng);
  const { width, height, data } = png;
  const cx = Math.min(Math.max(Math.round(x), RADIUS), width - RADIUS);
  const cy = Math.min(Math.max(Math.round(y), RADIUS), height - RADIUS);
  const outer = RADIUS + STROKE / 2;
  const inner = RADIUS - STROKE / 2;
  const x0 = Math.max(0, cx - Math.ceil(outer));
  const x1 = Math.min(width - 1, cx + Math.ceil(outer));
  const y0 = Math.max(0, cy - Math.ceil(outer));
  const y1 = Math.min(height - 1, cy + Math.ceil(outer));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.hypot(px - cx, py - cy);
      let alpha = 0;
      if (d >= inner && d <= outer) alpha = 1;      // traço do anel
      else if (d < inner) alpha = FILL_ALPHA;        // preenchimento translúcido
      else continue;
      const i = (width * py + px) << 2;
      data[i] = Math.round(COLOR.r * alpha + data[i] * (1 - alpha));
      data[i + 1] = Math.round(COLOR.g * alpha + data[i + 1] * (1 - alpha));
      data[i + 2] = Math.round(COLOR.b * alpha + data[i + 2] * (1 - alpha));
    }
  }
  return PNG.sync.write(png);
}
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS 26/26 (mesma contagem da v1 — nada foi adicionado, só trocada a lib).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: marcador com pngjs (JS puro) — remove sharp e todo binário nativo"
```

---

### Task 3: Bundle legível (build.mjs) + smoke do bundle + smoke de segurança

Gerar `dist/doc-agent.mjs` com esbuild e provar, com Chrome real, que o bundle grava (fixture sem senha) e protege (fixture com senha).

**Files:**
- Create: `tools/recorder/build.mjs`
- Create: `tools/recorder/smoke/fixtures/form.html`, `ok.html`, `login.html`
- Create: `tools/recorder/smoke/driver.mjs`
- Modify: `tools/recorder/package.json` (devDependency `esbuild`, scripts `build`/`smoke`/`smoke:security`)
- Create: `dist/doc-agent.mjs` (artefato commitado)

**Interfaces:**
- Consumes: fonte completo de `tools/recorder/src` (Tasks 1-2).
- Produces: `dist/doc-agent.mjs` executável com `node dist/doc-agent.mjs record <nome>` a partir da RAIZ do repo (sessões caem em `<raiz>/sessions/`). Scripts npm: `npm run build`, `npm run smoke`, `npm run smoke:security` (rodados de `tools/recorder`, exigem Chrome/Edge na máquina). Task 4 acrescenta o subcomando `pdf` ao mesmo bundle.

- [ ] **Step 1: Instalar esbuild e criar build.mjs**

Run (dentro de `tools/recorder`): `npm install --save-dev esbuild`

```js
// tools/recorder/build.mjs
// Gera dist/doc-agent.mjs: bundle LEGÍVEL (sem minify) para rodar com o Node portátil.
import * as esbuild from 'esbuild';

// O playwright-core referencia 'electron' num caminho que nunca usamos (só usamos connectOverCDP).
// Stub vazio evita erro de resolução no bundle.
const stubs = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /^electron(\/|$)/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};' }));
  },
};

await esbuild.build({
  entryPoints: ['src/cli.js'],
  outfile: '../../dist/doc-agent.mjs',
  bundle: true,
  minify: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  plugins: [stubs],
  banner: {
    js: [
      '// doc-agent — bundle gerado por tools/recorder/build.mjs (esbuild, SEM minificação).',
      '// O código-fonte canônico está em tools/recorder/src/. Este arquivo existe para',
      '// executar sem npm install: runtime\\node.exe dist\\doc-agent.mjs <comando>',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});
console.log('bundle gerado: dist/doc-agent.mjs');
```

Nota ao implementador: se o build ou o smoke falharem por outro recurso do playwright-core (ex.: `browsers.json`, assets `.png` internos), a correção é ampliar o plugin `stubs` com o mesmo padrão (resolver o caminho problemático para um stub vazio ou `{}`), NUNCA ativar minify nem marcar `playwright-core` inteiro como external. Documente cada stub adicionado com um comentário de uma linha.

- [ ] **Step 2: Adicionar scripts npm**

Em `tools/recorder/package.json`, acrescentar em `scripts`:

```json
"build": "node build.mjs",
"smoke": "node smoke/driver.mjs",
"smoke:security": "node smoke/driver.mjs security"
```

- [ ] **Step 3: Rodar o build**

Run: `npm run build`
Expected: `dist/doc-agent.mjs` criado na raiz do repo, tamanho na casa de poucos MB, primeiro bloco do arquivo é o banner legível. Warnings de esbuild são aceitáveis; erros não.

- [ ] **Step 4: Criar as fixtures**

```html
<!-- tools/recorder/smoke/fixtures/form.html -->
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Formulário de Demo</title></head>
<body>
  <h1>Abertura de Chamado (demo)</h1>
  <form action="ok.html" method="get">
    <p><label for="motivo">Motivo</label> <input id="motivo" name="motivo" type="text"></p>
    <p><label for="detalhe">Detalhe</label> <textarea id="detalhe" name="detalhe"></textarea></p>
    <p><label for="tipo">Tipo</label>
      <select id="tipo" name="tipo"><option>Incidente</option><option>Requisição</option></select></p>
    <p><label><input type="checkbox" id="urgente" name="urgente"> Urgente</label></p>
    <p><button id="enviar" type="submit">Enviar chamado</button></p>
  </form>
</body></html>
```

```html
<!-- tools/recorder/smoke/fixtures/ok.html -->
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Confirmação</title></head>
<body><h1>Chamado registrado</h1><p>Recebido com sucesso.</p></body></html>
```

```html
<!-- tools/recorder/smoke/fixtures/login.html -->
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Login de Demo</title></head>
<body>
  <h1>Login (demo)</h1>
  <form action="ok.html" method="get">
    <p><label for="user">Usuário</label> <input id="user" name="user" type="text"></p>
    <p><label for="pwd">Senha</label> <input id="pwd" name="pwd" type="password"></p>
    <p><button id="entrar" type="submit">Entrar</button></p>
  </form>
</body></html>
```

- [ ] **Step 5: Escrever o driver de smoke**

```js
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
await new Promise((r) => setTimeout(r, 800)); // eventos assentarem

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
```

- [ ] **Step 6: Rodar os dois smokes e ver passar**

Run (dentro de `tools/recorder`, com Chrome fechado — o gravador abre o dele):
```powershell
npm run smoke
npm run smoke:security
```
Expected: `SMOKE FORM OK` e `SMOKE SECURITY OK`. Se falhar com "Cannot find module" vindo do bundle, volte ao Step 1 (ampliar stubs) e refaça `npm run build`.

- [ ] **Step 7: Rodar a suíte unitária (regressão) e commitar**

Run: `npm test` → PASS 26/26.

```bash
git add -A ../../dist/doc-agent.mjs
git commit -m "feat: bundle legivel dist/doc-agent.mjs (esbuild) + smokes de pipeline e seguranca"
```

---

### Task 4: Subcomando `pdf` (markdown → PDF via Chrome headless)

**Files:**
- Modify: `tools/recorder/src/recorder/launch.js` (opção `headless`)
- Create: `tools/recorder/src/pdf.js`
- Rewrite: `tools/recorder/src/cli.js` (dispatcher `record` | `pdf`)
- Test: `tools/recorder/tests/pdf.test.js`
- Create: `tools/recorder/smoke/pdf.mjs`
- Modify: `tools/recorder/package.json` (dep `marked`, script `smoke:pdf`)

**Interfaces:**
- Consumes: `launchBrowser` (Task 1/v1), bundle da Task 3.
- Produces: `renderHtml(markdown: string) => string` e `exportPdf(readmePath: string) => Promise<string>` (caminho do PDF gerado: `docs/<slug>/<slug>.pdf`, onde `<slug>` = nome da pasta do README). CLI: `node dist/doc-agent.mjs pdf <caminho-do-README.md>` → exit 0 e imprime o caminho; exit 1 com mensagem em falha. `launchBrowser({ profileDir, port = 9333, headless = false })`.

- [ ] **Step 1: Instalar marked**

Run (dentro de `tools/recorder`): `npm install marked@^15.0.0`

- [ ] **Step 2: Escrever o teste unitário do render (falhando)**

```js
// tests/pdf.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/pdf.js';

test('renderHtml produz documento completo com título, imagem e negrito', () => {
  const html = renderHtml('# Título do Doc\n\n![Passo 1](img/passo-01.png)\n\nClique em **Salvar**.');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('charset="utf-8"'));
  assert.ok(html.includes('<style>'));
  assert.ok(/<h1[^>]*>Título do Doc<\/h1>/.test(html));
  assert.ok(html.includes('<img src="img/passo-01.png"'));
  assert.ok(html.includes('<strong>Salvar</strong>'));
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/pdf.test.js`
Expected: FAIL — `Cannot find module '../src/pdf.js'`.

- [ ] **Step 4: Adicionar opção headless ao launchBrowser**

Em `tools/recorder/src/recorder/launch.js`, substituir a assinatura e a montagem de args de `launchBrowser`:

```js
export async function launchBrowser({ profileDir, port = 9333, headless = false }) {
  const exe = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`, // Chrome 136+ exige perfil dedicado para CDP
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');
  args.push('about:blank');
  const proc = spawn(exe, args, { stdio: 'ignore' });
  // ... restante (polling /json/version, connectOverCDP, kill no timeout) permanece idêntico
}
```

- [ ] **Step 5: Implementar pdf.js**

```js
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
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${marked.parse(markdown)}</body></html>`;
}

export async function exportPdf(readmePath) {
  const mdAbs = path.resolve(readmePath);
  const dir = path.dirname(mdAbs);
  const markdown = await fs.readFile(mdAbs, 'utf8');
  const htmlPath = path.join(dir, '.doc-agent-print.html'); // ao lado do README: img/ relativo resolve
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
    await page.waitForTimeout(300); // imagens file:// assentarem
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
  } finally {
    try { proc?.kill(); } catch {}
    await fs.rm(htmlPath, { force: true });
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return pdfPath;
}
```

- [ ] **Step 6: Reescrever cli.js como dispatcher**

Substituir o conteúdo de `tools/recorder/src/cli.js` por:

```js
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
```

- [ ] **Step 7: Rodar o teste unitário e a suíte**

Run: `node --test tests/pdf.test.js` → PASS (1 teste). Depois `npm test` → PASS 27/27.

- [ ] **Step 8: Regenerar o bundle e criar o smoke do PDF**

Run: `npm run build`

```js
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
```

Em `tools/recorder/package.json`, acrescentar o script: `"smoke:pdf": "node smoke/pdf.mjs"`.

- [ ] **Step 9: Rodar os smokes (PDF + regressão dos outros dois)**

Run: `npm run smoke:pdf` → `SMOKE PDF OK`. Depois `npm run smoke` e `npm run smoke:security` → OK (garante que a reescrita do cli.js não quebrou a gravação no bundle).

- [ ] **Step 10: Commit**

```bash
git add -A ../../dist/doc-agent.mjs
git commit -m "feat: subcomando pdf (markdown -> PDF via Chrome headless) + smoke"
```

---

### Task 5: bootstrap.ps1 (runtime portátil na 1ª execução)

**Files:**
- Create: `.claude/skills/documentar/scripts/bootstrap.ps1`

**Interfaces:**
- Consumes: nada do código — script standalone.
- Produces: `runtime\node.exe` na raiz do repo, na versão pinada. Exit 0 = pronto (ou já estava); exit 1 = falha com instrução de plano B impressa. Idempotente e auto-atualizável (versão divergente → reinstala). Task 6 (skills) invoca este script.

- [ ] **Step 1: Escrever o bootstrap.ps1**

Nota: a versão pinada abaixo é a LTS que o time já validou (24.19.0). Antes de commitar, o Step 2 confirma que a URL existe; se o nodejs.org tiver removido essa versão, escolha a v24.x mais recente listada em `https://nodejs.org/dist/` e atualize a variável (é a única linha que muda).

```powershell
# .claude/skills/documentar/scripts/bootstrap.ps1
# Garante o Node portátil oficial em <repo>\runtime\node.exe (versão pinada).
# Idempotente: com o runtime correto presente, não faz nada. Sem admin, sem PATH, sem registro.
$ErrorActionPreference = 'Stop'

$NodeVersion = 'v24.19.0'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$RuntimeDir = Join-Path $RepoRoot 'runtime'
$NodeExe = Join-Path $RuntimeDir 'node.exe'

if (Test-Path $NodeExe) {
  $current = (& $NodeExe --version).Trim()
  if ($current -eq $NodeVersion) {
    Write-Output "runtime ok ($current)"
    exit 0
  }
  Write-Output "runtime desatualizado ($current -> $NodeVersion); reinstalando..."
  Remove-Item -Recurse -Force $RuntimeDir
}

$zipBase = "node-$NodeVersion-win-x64"
$url = "https://nodejs.org/dist/$NodeVersion/$zipBase.zip"
$tmpZip = Join-Path $env:TEMP "$zipBase.zip"
$tmpExtract = Join-Path $env:TEMP "$zipBase-extract"

Write-Output "Baixando o Node portátil oficial: $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
} catch {
  Write-Output 'FALHA no download (rede/proxy).'
  Write-Output "Plano B manual (1 passo): baixe $url e extraia o CONTEUDO da pasta $zipBase para: $RuntimeDir"
  exit 1
}

if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Move-Item -Path (Join-Path $tmpExtract "$zipBase\*") -Destination $RuntimeDir
Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpExtract

$installed = (& $NodeExe --version).Trim()
if ($installed -ne $NodeVersion) {
  Write-Output "ERRO: versao instalada ($installed) difere da pinada ($NodeVersion)"
  exit 1
}
Write-Output "runtime pronto ($installed)"
```

- [ ] **Step 2: Testar o ciclo completo do bootstrap**

Run (PowerShell, na raiz do repo):
```powershell
if (Test-Path runtime) { Rename-Item runtime runtime-bak }
powershell -ExecutionPolicy Bypass -File .claude\skills\documentar\scripts\bootstrap.ps1
& runtime\node.exe --version
powershell -ExecutionPolicy Bypass -File .claude\skills\documentar\scripts\bootstrap.ps1
```
Expected: 1ª execução baixa e termina com `runtime pronto (v24.19.0)`; `--version` imprime `v24.19.0`; 2ª execução imprime `runtime ok (v24.19.0)` sem baixar nada. Se o download der 404, ajuste a versão pinada (ver nota do Step 1) e repita. Ao final: `Remove-Item -Recurse -Force runtime-bak` se existir.

- [ ] **Step 3: Validar o bundle com o runtime baixado (não com o Node de dev)**

Run (na raiz): `& runtime\node.exe dist\doc-agent.mjs`
Expected: imprime as duas linhas de uso e sai com código 1 — prova que o runtime portátil executa o bundle.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/documentar/scripts/bootstrap.ps1
git commit -m "feat: bootstrap.ps1 baixa o Node portatil oficial pinado em runtime/"
```

---

### Task 6: Skills (/documentar nova, /gerar-doc revisada), README e .gitignore

**Files:**
- Create: `.claude/skills/documentar/SKILL.md`
- Rewrite: `.claude/skills/gerar-doc/SKILL.md`
- Rewrite: `README.md`
- Rewrite: `.gitignore`

**Interfaces:**
- Consumes: `bootstrap.ps1` (Task 5), `dist/doc-agent.mjs` com subcomandos `record`/`pdf` (Tasks 3-4).
- Produces: comandos `/documentar <nome>` e `/gerar-doc <sessão>` prontos para o usuário final; repositório com gitignore definitivo.

- [ ] **Step 1: Escrever .claude/skills/documentar/SKILL.md**

````markdown
---
name: documentar
description: Grava um procedimento executado no navegador e gera a documentação passo a passo automaticamente (markdown + PDF opcional). Use quando o usuário pedir para documentar/gravar um procedimento ou invocar /documentar <nome-do-procedimento>.
---

# Documentar um procedimento (gravar + gerar)

Você recebe o nome do procedimento (ex.: `abertura-chamado-vpn`). O fluxo completo é:
preparar o ambiente → gravar → gerar a documentação. O usuário só interage com o navegador.

## 1. Preparar o ambiente (silencioso quando tudo está ok)

1. Rode o bootstrap do runtime (idempotente, rápido quando já instalado):
   `powershell -ExecutionPolicy Bypass -File .claude/skills/documentar/scripts/bootstrap.ps1`
   - Terminou com exit 0 → siga.
   - Exit 1 → mostre ao usuário a saída do script (ela contém o plano B manual com o
     link exato do zip) e PARE.
2. Confirme que `dist/doc-agent.mjs` existe. Se não existir, o clone está incompleto —
   peça para reclonarem o repositório e PARE.

## 2. Gravar

1. Anote se `browser-profile/` já existe (define a mensagem do próximo passo).
2. Execute EM BACKGROUND: `runtime\node.exe dist\doc-agent.mjs record <nome>`
3. Diga ao usuário: "O navegador de gravação abriu. Execute o procedimento normalmente
   e **feche o navegador** quando terminar." Se `browser-profile/` NÃO existia, acrescente:
   "Primeira gravação: logue nos sistemas nesse navegador — os logins ficam salvos para
   as próximas."
4. Aguarde o processo em background terminar (a notificação chega sozinha; não fique
   consultando o status).

## 3. Tratar o encerramento

- **Exit 0**: a saída do CLI contém `Sessão pronta: sessions/<pasta>`. Leia o
  `session.json` dessa pasta; se `steps` estiver vazio, informe "nada foi gravado —
  o navegador foi fechado sem ações" e PARE.
- **Exit 1**: mostre a saída do CLI ao usuário e PARE. Nunca gere documentação de uma
  sessão que falhou na consolidação. Caso particular: se o processo terminou em segundos
  com erro citando Chrome/Edge/`DOC_AGENT_CHROME`, a máquina não tem navegador suportado —
  explique isso ao usuário em uma frase.

## 4. Gerar a documentação

Leia `.claude/skills/gerar-doc/SKILL.md` e siga o processo de lá, do início, usando a
sessão recém-criada (validação, leitura de cada print, agrupamento em etapas lógicas,
template, cópia das imagens, oferta de PDF e nota final).
````

- [ ] **Step 2: Reescrever .claude/skills/gerar-doc/SKILL.md**

Substituir o arquivo inteiro por (mudanças vs v1: passos 6-7 — oferta de PDF e nota branda no lugar do alerta enfático; resto idêntico):

````markdown
---
name: gerar-doc
description: Gera documentação passo a passo em markdown a partir de uma sessão gravada pelo doc-agent (pasta sessions/AAAA-MM-DD-nome). Use quando o usuário pedir para gerar a documentação de uma gravação ou invocar /gerar-doc <pasta-da-sessão>.
---

# Gerar documentação a partir de uma sessão gravada

Você recebe o caminho de uma pasta de sessão (ex.: `sessions/2026-08-19-abertura-chamado-vpn`).
O slug do procedimento é o nome da pasta SEM o prefixo de data (ex.: `abertura-chamado-vpn`).

## Processo (siga na ordem)

1. **Valide a sessão.** Leia `<sessão>/session.json`. Se o arquivo não existir, estiver corrompido
   ou `steps` estiver vazio, PARE imediatamente e informe: "Sessão inválida ou vazia — regrave com
   `/documentar <nome>`". NUNCA gere documentação parcial silenciosamente.

2. **Olhe cada print.** Para todo passo com `screenshot`, leia a imagem em `<sessão>/<screenshot>`
   com a ferramenta Read. As imagens são a fonte da verdade sobre o que a tela mostra — use-as para:
   - corrigir labels genéricos ou truncados do log (o texto real do botão/campo está no print);
   - identificar o nome real da tela e do sistema;
   - capturar mensagens, avisos e estados exibidos que o log de eventos não registra.

3. **Agrupe micro-ações em etapas lógicas.** O leitor quer um guia, não um log:
   - Passos `fill`/`select` consecutivos no mesmo formulário viram UMA etapa
     ("Preencha o formulário de abertura") com as sub-instruções em lista, usando o print
     mais representativo.
   - Um `click` imediatamente seguido de `navigation` é uma etapa só: a instrução é o clique,
     e o print da navegação mostra o resultado ("A tela X será exibida").
   - Passos `enter` viram parte da instrução do campo ("...e pressione Enter"), não etapa própria.

4. **Escreva a documentação** em `docs/<slug>/README.md`, seguindo exatamente este template:

   # <Título do procedimento — inferido do nome da sessão e das telas>

   > **Objetivo:** <o que este procedimento realiza e quando usá-lo>
   > **Pré-requisitos:** <acessos/sistemas necessários, inferidos das URLs e telas de login>

   ## Passo a passo

   ### 1. <Instrução imperativa da etapa>
   <Detalhe da ação. Se houver print: a frase referencia o que o leitor verá.>
   ![Passo 1](img/passo-01.png)

   ### 2. ...

5. **Copie os prints referenciados** de `<sessão>/shots/` para `docs/<slug>/img/`, renomeando
   para `passo-NN.png` na ordem das etapas finais. NÃO copie prints que a doc não referencia.

6. **Ofereça o PDF.** Pergunte se o usuário quer também a versão em PDF (ou gere direto, se o
   pedido original já mencionou PDF). Se sim:
   - Se `runtime\node.exe` não existir, rode antes:
     `powershell -ExecutionPolicy Bypass -File .claude/skills/documentar/scripts/bootstrap.ps1`
   - Rode: `runtime\node.exe dist\doc-agent.mjs pdf docs/<slug>/README.md`
   - Entregue `docs/<slug>/<slug>.pdf` ao usuário.

7. **Nota final** (na sua resposta, uma linha, sem alarde — a documentação é interna ao time):
   lembre de conferir os prints antes de divulgar o material fora do time.

## Regras de estilo (obrigatórias)

- **pt-BR, tom imperativo, sempre**: "Clique em **Salvar**", "Preencha o campo **Motivo**",
  "Selecione **Duas vias** no campo **Tipo**". NUNCA narração no passado ("o usuário clicou").
- Nomes de botões, campos e menus em **negrito**, exatamente como aparecem na tela (use os prints).
- Passos de senha: escreva apenas "Preencha o campo **Senha**" — o valor nunca está no log
  e não deve ser inventado. O mesmo vale para qualquer valor `null`.
- Não invente passos que não estão na sessão. Se a sequência parecer ter um buraco
  (ex.: a tela mudou sem clique registrado), adicione "> **Nota:** revisar este trecho —
  a gravação pode ter perdido uma ação" no ponto correspondente.
- Valores digitados na gravação são EXEMPLOS: generalize na instrução
  ("Descreva o problema — ex.: _VPN caiu_"), não os apresente como valor obrigatório.
````

- [ ] **Step 3: Reescrever README.md**

````markdown
# doc-agent

Documente procedimentos do time gravando o que você faz no navegador.
Você executa o procedimento; o doc-agent registra os passos e os prints,
e o Claude escreve o passo a passo em markdown — com PDF opcional.

## Requisitos

- Windows com Google Chrome ou Microsoft Edge
- Claude Code
- Mais nada: sem Node, sem npm, sem instalação — o runtime é baixado
  automaticamente na primeira execução (zip oficial do nodejs.org).

## Uso

1. Clone este repositório e abra o Claude Code na pasta.
2. Rode `/documentar <nome-do-procedimento>` (ex.: `/documentar abertura-chamado-vpn`).
3. Execute o procedimento no navegador que abrir e **feche o navegador** ao terminar.

A documentação sai em `docs/<nome>/README.md` (+ `docs/<nome>/<nome>.pdf`, se você pedir).
Para regenerar a doc de uma gravação antiga: `/gerar-doc sessions/<pasta-da-sessão>`.

## Notas

- Primeira gravação: logue nos sistemas no navegador que abrir — os logins ficam
  salvos localmente (`browser-profile/`) para as próximas gravações.
- Telas com campo de senha não geram prints, e senhas nunca são registradas.
- `sessions/`, `runtime/`, `browser-profile/` e a documentação gerada são locais —
  nunca vão para o git.

## Para mantenedores

- Fonte do gravador: `tools/recorder/src/` — testes: `npm test` (em `tools/recorder`).
- Alterou o fonte? Regenere e commite o bundle: `npm run build` → `dist/doc-agent.mjs`.
- Smokes (exigem Chrome/Edge): `npm run smoke`, `npm run smoke:security`, `npm run smoke:pdf`.
- Atualizar a versão do Node portátil: editar `$NodeVersion` em
  `.claude/skills/documentar/scripts/bootstrap.ps1`.
````

- [ ] **Step 4: Reescrever .gitignore**

```
node_modules/
sessions/
browser-profile/
runtime/
docs/*
!docs/superpowers/
```

- [ ] **Step 5: Verificar o efeito do gitignore**

Run: `git status --short`
Expected: os docs gerados existentes (`docs/adicionar-usuario-aws/`, `docs/criar-servidor-plataforma-pesquisador/`, `docs/expandir-particao-ext4-raiz-ubuntu-24/`) NÃO aparecem mais; `docs/superpowers/` continua rastreado (`git ls-files docs/` lista apenas docs/superpowers/...).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/documentar/SKILL.md .claude/skills/gerar-doc/SKILL.md README.md .gitignore
git commit -m "feat: skill /documentar (fluxo completo), /gerar-doc com PDF, README v2 e gitignore definitivo"
```

---

### Task 7: Validação de ponta a ponta simulando a máquina do usuário

Provar o critério de aceite da spec usando SOMENTE o runtime portátil (nunca o Node de dev): bootstrap do zero → gravação via bundle → segurança → PDF.

**Files:**
- Nenhum arquivo novo — validação e, se necessário, correções pontuais + rebuild.

**Interfaces:**
- Consumes: tudo das Tasks 1-6.
- Produces: repositório v2 validado; critério de aceite atendido.

- [ ] **Step 1: Zerar o ambiente local (simular máquina limpa)**

Run (PowerShell, na raiz):
```powershell
if (Test-Path runtime) { Remove-Item -Recurse -Force runtime }
powershell -ExecutionPolicy Bypass -File .claude\skills\documentar\scripts\bootstrap.ps1
& runtime\node.exe --version
```
Expected: download + `runtime pronto (v24.19.0)`; `--version` confirma.

- [ ] **Step 2: Rodar os três smokes com o RUNTIME (não o Node de dev)**

Run (em `tools/recorder`; o driver usa `process.execPath`, então invocar com o runtime garante que o bundle roda no Node portátil):
```powershell
& ..\..\runtime\node.exe smoke\driver.mjs
& ..\..\runtime\node.exe smoke\driver.mjs security
& ..\..\runtime\node.exe smoke\pdf.mjs
```
Expected: `SMOKE FORM OK`, `SMOKE SECURITY OK`, `SMOKE PDF OK`.

- [ ] **Step 3: Suíte unitária final**

Run (em `tools/recorder`): `npm test`
Expected: PASS 27/27.

- [ ] **Step 4: Conferir higiene do repositório**

Run: `git status --short` na raiz.
Expected: árvore limpa (sessions/, runtime/, docs gerados e browser-profile ignorados; dist/doc-agent.mjs sem diff pendente — se houver diff, é bundle desatualizado: rode `npm run build`, confira e commite).

- [ ] **Step 5: Commit final (se o Step 4 gerou rebuild)**

```bash
git add -A
git commit -m "chore: valida v2 de ponta a ponta com runtime portatil"
```

Validação com usuário real (pós-plano, manual): na máquina de um colega SEM Node — clonar, abrir Claude Code, `/documentar <procedimento real>`, fechar navegador, receber doc + PDF. É o critério de aceite da spec e não depende de código novo.
