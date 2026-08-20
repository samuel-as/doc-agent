// tools/recorder/build.mjs
// Gera dist/doc-agent.mjs: bundle LEGÍVEL (sem minify) para rodar com o Node portátil.
import fs from 'node:fs';
import * as esbuild from 'esbuild';

// O playwright-core referencia 'electron' num caminho que nunca usamos (só usamos connectOverCDP).
// Stub vazio evita erro de resolução no bundle.
const stubs = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /^electron(\/|$)/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    // chromium-bidi: dependência opcional do playwright-core para o protocolo BiDi (Firefox); só usamos CDP.
    build.onResolve({ filter: /^chromium-bidi(\/|$)/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};' }));
  },
};

// O playwright-core lê estes dois JSONs em TEMPO DE EXECUÇÃO via require(caminho calculado com
// __dirname) — nenhum stub de build resolve isso. Embutimos o conteúdo (≈3 KB) no banner e
// interceptamos o require para o bundle ser 100% autônomo (roda de qualquer pasta, sem node_modules).
const pwPackageJSON = fs.readFileSync('node_modules/playwright-core/package.json', 'utf8');
const pwBrowsersJSON = fs.readFileSync('node_modules/playwright-core/browsers.json', 'utf8');

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
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import __path from 'node:path';",
      '// __dirname/__filename: o código CJS do playwright-core convertido para ESM referencia os dois.',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __path.dirname(__filename);',
      '// package.json e browsers.json do playwright-core, embutidos no build (ver comentário no build.mjs).',
      `const __pwPackageJSON = ${JSON.stringify(JSON.parse(pwPackageJSON))};`,
      `const __pwBrowsersJSON = ${JSON.stringify(JSON.parse(pwBrowsersJSON))};`,
      'const __rawRequire = __createRequire(import.meta.url);',
      "const __pwPackageRoot = __path.join(__dirname, '..'); // packageRoot calculado pelo playwright-core em runtime",
      'const require = Object.assign((id) => {',
      "  if (id === __path.join(__pwPackageRoot, 'package.json')) return __pwPackageJSON;",
      "  if (id === __path.join(__pwPackageRoot, 'browsers.json')) return __pwBrowsersJSON;",
      '  return __rawRequire(id);',
      '}, __rawRequire);',
    ].join('\n'),
  },
});
console.log('bundle gerado: dist/doc-agent.mjs');
