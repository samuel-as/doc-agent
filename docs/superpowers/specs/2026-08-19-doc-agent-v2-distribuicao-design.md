# doc-agent v2 — Distribuição e uso sem fricção

**Data:** 2026-08-19
**Status:** Aprovado em brainstorming, aguardando plano de implementação
**Spec anterior:** [2026-08-19-doc-agent-design.md](2026-08-19-doc-agent-design.md) (v1 — gravador + skill, validados de ponta a ponta)

## Problema

A v1 funciona, mas exige do usuário: instalar Node, ajustar PATH, rodar comando no terminal e depois abrir o Claude Code para gerar a doc. O público-alvo — **time técnico, com licença do Claude Code** — não deve precisar saber o que é Node nem tocar num terminal. Meta: **clonar a pasta, abrir o Claude Code e usar um único comando.**

Restrições estabelecidas com o usuário:

- **Nada de instalar nada** na máquina (sem npm install, sem winget/scoop — comportamento varia por máquina).
- **Nada de executável opaco** (`doc-agent.exe` via pkg/SEA): risco documentado de falso positivo em antivírus corporativo e código ilegível. O modelo desejado é o "estilo Python": *interpretador confiável + código-fonte legível*.
- O `node.exe` do zip oficial do nodejs.org é assinado (OpenJS Foundation/DigiCert) e portátil — extrair basta, sem admin. É o único binário da solução.

## Decisões

| Decisão | Escolha |
|---|---|
| Runtime | Node portátil oficial, **baixado do nodejs.org na 1ª execução** (versão pinada), extraído em `runtime/` (gitignored) |
| Dependências JS | **Bundle legível commitado**: `dist/doc-agent.mjs` gerado com esbuild **sem minificar** (playwright-core + pngjs embutidos) |
| sharp | **Substituído por pngjs** (JS puro) — o marcador vermelho passa a ser desenhado pintando pixels; zero binário nativo |
| UX diária | **Tudo no Claude Code**: comando único `/documentar <nome>` (grava + gera); `/gerar-doc` mantida para regenerar sessões antigas |
| Encerramento da gravação | **Fechar o navegador** (caminho `disconnected` → finalize, validado na v1); Ctrl+C deixa de fazer parte da UX |
| Distribuição | Repositório git leve (sem node_modules, sem binários); estrutura profissional de repo de skills |
| Nome | `doc-agent` (mantido) |
| Plataforma | Windows (máquinas do time); Chrome ou Edge já instalados |

## Layout do repositório

```
doc-agent/
├── README.md                     # o que é, uso em 3 passos
├── .claude/
│   └── skills/
│       ├── documentar/           # ★ skill principal (fluxo completo)
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       └── bootstrap.ps1 # baixa o zip oficial do Node (versão pinada) e extrai em runtime/
│       └── gerar-doc/
│           └── SKILL.md          # gerar/regenerar doc de sessão já gravada
├── tools/
│   └── recorder/                 # fonte do gravador (o src/ atual movido para cá)
│       ├── src/                  # cli.js, recorder/*.js
│       ├── tests/                # suíte de testes (26 na v1, cresce nesta v2)
│       ├── package.json
│       └── build.mjs             # esbuild: src → ../../dist/doc-agent.mjs (bundle, SEM minify)
├── dist/
│   └── doc-agent.mjs             # bundle legível COMMITADO — o que roda na máquina do usuário
├── docs/                         # documentação gerada (docs/<slug>/) + specs (docs/superpowers/)
├── runtime/                      # Node portátil oficial (runtime\node.exe) — GITIGNORED
├── sessions/                     # gravações — GITIGNORED
└── browser-profile/              # perfil do Chrome — GITIGNORED
```

- O usuário roda, via skill: `runtime\node.exe dist\doc-agent.mjs record <nome>`.
- O fonte real vive em `tools/recorder/src/`; o bundle é artefato de build commitado, legível (não minificado) para inspeção.
- O bootstrap extrai o conteúdo do zip direto em `runtime/` (caminho estável `runtime\node.exe`, sem subpasta versionada).

## Componente 1: Gravador — mudanças sobre a v1

1. **`marker.js` reescrito com pngjs**: decodifica o PNG, desenha o anel (traço ~4px, raio 22, cor `#e0245e`, preenchimento translúcido) calculando distância ao centro pixel a pixel, recodifica. Mesma interface `drawMarker(png, {x,y})`; os testes de pixel existentes se adaptam (decodificação via pngjs em vez de sharp).
2. **`build.mjs`** (novo): esbuild com `bundle: true, minify: false, platform: 'node', format: 'esm'`, entry `src/cli.js`, saída `dist/doc-agent.mjs`. Deve tratar os problemas conhecidos de bundling do playwright-core (ex.: resolução de `browsers.json` e requires dinâmicos) — via `external`/shim/define conforme o build revelar. O bundle NÃO inclui browsers do Playwright (usamos só `connectOverCDP`).
3. **Nenhuma outra mudança funcional** no gravador — consolidação, supressão de prints, mascaramento de senha e CLI permanecem como na v1.

## Componente 2: Bootstrap do runtime (`bootstrap.ps1`)

- Versão do Node **pinada no script** — a versão exata (LTS vigente, ≥22) é fixada no plano de implementação; o script é o único lugar onde ela vive, e atualizá-la é editar uma linha.
- Fluxo: se `runtime\node.exe` existe E `node.exe --version` == versão pinada → não faz nada. Senão: baixa `https://nodejs.org/dist/<versão>/node-<versão>-win-x64.zip` (Invoke-WebRequest), extrai (Expand-Archive) e move o conteúdo para `runtime/` (achatando a subpasta do zip).
- Sem privilégios de admin, sem registro, sem alteração de PATH.
- **Falha de rede/proxy**: termina com mensagem clara contendo o link exato do zip e a instrução de um passo (baixar manualmente e extrair em `runtime/`).

## Componente 3: Skill `/documentar <nome>` (nova, principal)

1. **Checagem de ambiente** (idempotente, silenciosa quando tudo ok): roda `bootstrap.ps1`; verifica Chrome/Edge (mesma detecção do gravador). Falta algo → mensagem clara e para.
2. **Gravação**: executa `runtime\node.exe dist\doc-agent.mjs record <nome>` em background e instrui: *"O navegador de gravação abriu. Execute o procedimento normalmente e **feche o navegador** ao terminar."* Na primeira gravação, avisa que é preciso logar nos sistemas uma vez nesse perfil (logins persistem).
3. **Fim da gravação**: processo termina → exit 0 = sessão consolidada; exit 1 = falha na consolidação → informa e para (nunca gera doc de sessão quebrada).
4. **Geração**: aplica o processo da skill `gerar-doc` na mesma sessão (validar `session.json`, ler cada print, agrupar micro-ações em etapas lógicas, escrever `docs/<slug>/README.md` + `img/passo-NN.png`, pt-BR imperativo).
5. **Nota final** (não mais alerta enfático — a documentação é interna ao time): uma linha lembrando de conferir os prints antes de divulgar fora do time.

A skill `/gerar-doc` é mantida com o mesmo processo da v1, ajustando apenas a mesma nota final.

## Tratamento de erros

- **Download do Node bloqueado (proxy)**: plano B manual de um passo, com link exato (ver Componente 2).
- **Sessão vazia** (navegador fechado sem ações): exit 0 com `steps` vazio → skill informa "nada foi gravado" e não gera doc.
- **Runtime desatualizado** (clone antigo): bootstrap compara versão e reinstala sozinho.
- **Gravação com falha de consolidação**: exit 1 → mensagem e parada (comportamento v1 preservado).

## Testes e validação

1. **Suíte unitária** continua no fonte (`tools/recorder/`): os 26 testes da v1, com `marker.test.js` adaptado a pngjs.
2. **Smoke do bundle** (novo, obrigatório a cada build): o driver CDP da v1 roda o fluxo completo contra `dist/doc-agent.mjs` (não contra o fonte) num formulário de demo sem senha — prova que o bundle empacotou playwright-core corretamente.
3. **Teste de segurança do bundle** (novo, obrigatório a cada build): passada do smoke numa página COM campo de senha, com asserções de que (a) nenhum `value` de campo password aparece no `session.json` (inclusive via `label`), e (b) nenhum print foi gerado naquela página. Formaliza como teste automatizado o que na v1 foi verificação manual.
4. **Teste do bootstrap**: rodar `bootstrap.ps1` numa pasta limpa e validar `runtime\node.exe --version` == versão pinada; rodar de novo e validar que é no-op.
5. **Validação final de ponta a ponta**: `/documentar` num procedimento real, numa máquina SEM Node instalado (critério de aceite da v2: clonar → abrir Claude Code → `/documentar` → doc gerada, sem nenhum passo manual além de executar o procedimento no navegador).

## Migração da v1

- `git mv src tools/recorder/src`, `git mv tests tools/recorder/tests`, package.json/lock acompanham; caminhos internos e script de teste ajustados.
- `sharp` sai das dependências; `pngjs` e `esbuild` (devDependency) entram.
- `.claude/skills/gerar-doc/` é revisada (nota final); `.claude/skills/documentar/` é criada.
- README reescrito para o usuário final (3 passos: clonar, abrir Claude Code, `/documentar`).
- `.gitignore` ganha `runtime/`; `dist/doc-agent.mjs` passa a ser commitado.

## Fora de escopo

- Plugin/marketplace do Claude Code (possível evolução futura).
- Suporte a macOS/Linux (time usa Windows).
- Assinatura de código própria, exe empacotado, instaladores.
- Redaction automático de dados sensíveis nos prints (segue sendo revisão humana).
- Repositório multi-skills do time (decisão: este repo permanece exclusivo do doc-agent).
