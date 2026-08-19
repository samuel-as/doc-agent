# doc-agent — Design

**Data:** 2026-08-19
**Status:** Aprovado em brainstorming, aguardando plano de implementação

## Problema

Criar documentação técnica de procedimentos do time (atendimento de chamados, uso de sistemas internos, processos padrão) é lento e manual. O objetivo é gravar o procedimento sendo executado no navegador — de forma **passiva**, sem narrar nada — e deixar o Claude transformar a gravação em um passo a passo pronto em markdown, com prints. Comportamento de referência: **Scribe** (scribehow.com).

## Visão geral

Duas partes desacopladas, conectadas por uma pasta de sessão no disco:

```
[1] GRAVAÇÃO (sem IA, sem tokens)              [2] GERAÇÃO (Claude Code)
┌─────────────────────────────────┐            ┌──────────────────────────────┐
│ CLI: doc-agent record <nome>    │            │ Skill: /gerar-doc <sessão>   │
│                                 │            │                              │
│ Abre Chrome (perfil dedicado)   │  pasta da  │ Lê session.json + prints,    │
│ conectado via CDP/Playwright.   │  sessão    │ entende o procedimento e     │
│ Usuário executa o procedimento  │ ────────►  │ escreve o passo a passo em   │
│ normalmente. A cada clique/     │            │ markdown (pt-BR, imperativo) │
│ digitação/navegação: registra   │            │ com os prints embutidos,     │
│ o passo + tira print na hora.   │            │ salvo em docs/ do projeto.   │
│ Ctrl+C encerra e consolida.     │            │                              │
└─────────────────────────────────┘            └──────────────────────────────┘
```

Decisões estruturais:

- **Captura passiva, sem extensão de navegador.** Um script Node conecta-se ao Chrome via CDP (`playwright.chromium.connectOverCDP`) e injeta listeners nas páginas. Alternativas descartadas: extensão própria (mais infraestrutura), `playwright codegen` + replay (re-executa ações reais em sistemas de produção — inaceitável), Claude assistindo em tempo real (exige narração e gasta tokens durante a gravação).
- **Perfil de navegador dedicado à gravação.** Chrome 136+ bloqueia CDP no perfil padrão; o gravador lança o Chrome com `--user-data-dir` próprio. No primeiro uso o usuário loga nos sistemas internos nesse perfil; os logins persistem entre gravações.
- **Gravar não consome tokens.** O Claude só entra na fase de geração, sob demanda, lendo uma pasta estática.

## Contrato entre as partes: a pasta de sessão

```
sessions/<AAAA-MM-DD>-<slug>/
├── session.json          # passos ordenados
└── shots/
    ├── step-001.png      # print no momento da ação, com marcador
    ├── step-002.png      #   vermelho no ponto clicado
    └── ...
```

Cada passo do `session.json` contém: tipo da ação (`click`, `fill`, `select`, `enter`, `navigation`), texto/label do elemento (fallback: aria-label → placeholder → title → texto próximo), seletor, valor final digitado (mascarado se senha), URL e título da página, timestamp, e o arquivo de print (`null` se a captura falhou).

`sessions/` fica no `.gitignore` — gravações contêm dados reais e nunca vão para o repositório.

## Componente 1: Gravador (CLI `doc-agent record <nome>`)

**Stack:** Node.js + Playwright + `sharp` (desenho do marcador). Sem banco, sem servidor.

**Mecânica:** lança o Chrome com perfil dedicado e porta de debug, conecta via CDP e injeta em toda página (init script) listeners na fase de captura. Eventos chegam ao processo Node via binding e disparam o registro do passo + screenshot.

**Eventos e passos:**

| Evento bruto | Vira passo? |
|---|---|
| Clique em elemento interativo | Sim — print marcado no ponto do clique |
| Digitação em campo de texto | Sim, **um passo por campo** (consolidado no blur/Enter) |
| Tecla Enter | Sim |
| Seleção em dropdown | Sim |
| Navegação / carregamento de página | Sim — print da tela nova após estabilizar |
| Scroll, movimento de mouse, clique em área vazia | Não — descartado |

**Consolidação de ruído** (o núcleo da complexidade): eventos de teclado são acumulados e viram um único passo "preencher campo X" quando o campo perde o foco ou recebe Enter, guardando o valor final. Cliques repetidos no mesmo elemento em <500 ms viram um passo só.

**Timing do print:** capturado no instante da ação (mousedown), mostrando a tela como estava quando o usuário agiu; o marcador vermelho é desenhado depois nas coordenadas do clique. Navegações geram um print adicional quando a página nova estabiliza. (Comportamento Scribe: o leitor vê a tela que terá na frente + onde clicar.)

**Multi-abas e popups:** o gravador anexa-se automaticamente a novas abas/janelas do mesmo navegador.

**Proteção de dados (nível básico):**
- Campos `type=password` nunca têm o valor registrado — o passo anota apenas o label do campo.
- Prints são suprimidos em páginas com campo de senha visível (telas de login).
- Dados pessoais nos demais prints são responsabilidade da revisão humana antes de publicar (a skill lembra disso ao final).

**Encerramento:** `Ctrl+C` consolida o `session.json` e imprime o caminho da pasta.

**Erros:** falha em um screenshot não derruba a gravação (passo registrado com `"screenshot": null`); aba fechada é registrada e a gravação segue nas demais.

## Componente 2: Skill `/gerar-doc <pasta-da-sessão>`

Skill de projeto em `.claude/skills/gerar-doc/`. Fluxo:

1. Lê o `session.json` e **cada print** (o Claude lê PNGs nativamente) — as imagens corrigem e enriquecem o log: nome real da tela, mensagens exibidas, contexto visual.
2. Escreve a doc em **pt-BR, tom imperativo** ("Preencha o campo Senha", "Clique em **Novo Chamado**" — nunca narração no passado), seguindo o template:

```markdown
# <Título do procedimento>

> **Objetivo:** o que este procedimento realiza e quando usá-lo.
> **Pré-requisitos:** acessos/sistemas necessários (inferidos das URLs e telas de login).

## Passo a passo

### 1. Acesse o sistema <X>
Acesse `<url>`. A tela inicial será exibida.
![Passo 1](img/step-001.png)

### 2. Clique em **Novo Chamado**
...
```

3. **Agrupa micro-ações em etapas lógicas** — preencher 4 campos de um formulário vira uma etapa com sub-instruções, não 4 headings. É o que diferencia uma doc de um log.
4. Salva em `docs/<slug>/README.md` e copia apenas os prints referenciados para `docs/<slug>/img/`.
5. Ao final, lembra o usuário de revisar dados pessoais nos prints antes de publicar.

**Erros:** sessão sem `session.json` ou prints ilegíveis → mensagem clara pedindo regravação; nunca gera doc pela metade silenciosamente.

## Fluxo de uso completo

```bash
doc-agent record abertura-chamado-vpn   # grava; Ctrl+C encerra
# → sessions/2026-08-19-abertura-chamado-vpn/
/gerar-doc sessions/2026-08-19-abertura-chamado-vpn
# → docs/abertura-chamado-vpn/README.md + img/
# revisão humana → publicar onde o time quiser
```

## Testes

- **Unitários** na lógica de consolidação (digitação → 1 passo, dedup de cliques) e no mascaramento de senha — onde mora a complexidade real.
- **Smoke test** de gravação em site público (formulário de demo), validando a estrutura da pasta de sessão.
- Qualidade da doc gerada valida-se com o primeiro procedimento real, revisado pelo usuário.

## Fora de escopo (por ora)

- Redaction automático de dados sensíveis nos prints.
- Validação automática da doc re-executando o procedimento (possível uso futuro de Playwright MCP em homologação).
- Suporte a ações fora do navegador (desktop).
- Publicação automática em wiki/SharePoint/Confluence — a saída é o markdown em `docs/`.
