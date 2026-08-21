# doc-agent

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
![Plataforma: Windows](https://img.shields.io/badge/plataforma-Windows-0078D4?logo=windows&logoColor=white)
![Node.js 24 portátil](https://img.shields.io/badge/Node.js-24.x%20port%C3%A1til-5FA04E?logo=nodedotjs&logoColor=white)
![Navegador: Chrome ou Edge](https://img.shields.io/badge/navegador-Chrome%20%7C%20Edge-4285F4?logo=googlechrome&logoColor=white)
![Feito para Claude Code](https://img.shields.io/badge/Claude%20Code-skills-D97757)

**Documente um procedimento executando-o.** Você abre o navegador e faz o processo
normalmente; o doc-agent grava cada passo com print de tela e o Claude Code transforma
isso num passo a passo em markdown — com PDF opcional.

```
você executa no navegador  →  o gravador registra passos + prints  →  o Claude escreve a doc
        (5 minutos)                    (automático)                       (automático)
```

Nada de escrever tutorial à mão, nada de recortar print, nada de manter a doc sincronizada
com telas que mudaram: é mais rápido regravar.

---

## Requisitos

| O quê | Por quê |
|---|---|
| Windows 10/11 | o bootstrap e o runtime são `.ps1` + `node.exe` |
| Google Chrome **ou** Microsoft Edge | o gravador se conecta ao navegador por CDP |
| [Claude Code](https://claude.com/claude-code) | executa as skills `/documentar` e `/gerar-doc` |

Você **não** precisa instalar Node, npm ou qualquer dependência: na primeira execução o
próprio projeto baixa o Node portátil oficial (zip pinado do `nodejs.org`) para `runtime/`,
sem admin, sem PATH e sem mexer no registro.

## Instalação

```bash
git clone https://github.com/<seu-usuario>/doc-agent.git
```

Abra o Claude Code na pasta clonada. Pronto — as skills já estão em `.claude/skills/`.

## Uso

### Documentar um procedimento novo

Dentro do Claude Code:

```
/documentar abertura-chamado-vpn
```

O que acontece:

1. O runtime é preparado (silencioso se já estiver ok).
2. Abre um navegador de gravação com perfil próprio.
3. **Você executa o procedimento normalmente.**
4. **Feche o navegador** para encerrar — a gravação é consolidada e a doc é escrita.

Na primeira gravação, logue nos sistemas nesse navegador: o perfil fica salvo em
`browser-profile/` e as próximas gravações já começam autenticadas.

### Regerar a doc de uma gravação antiga

```
/gerar-doc sessions/2026-08-19-abertura-chamado-vpn
```

Útil para refazer o texto sem repetir o procedimento — ou para gerar o PDF depois.

### Usar o CLI direto (sem Claude Code)

O bundle é autocontido; só a escrita do texto depende do Claude.

```bash
runtime/node.exe dist/doc-agent.mjs record abertura-chamado-vpn
runtime/node.exe dist/doc-agent.mjs pdf docs/abertura-chamado-vpn/README.md
```

## O que sai no final

```
sessions/2026-08-19-abertura-chamado-vpn/   ← gravação bruta (local, fora do git)
├── session.json                            ← passos consolidados
└── shots/step-001.png ...                  ← prints, com o clique marcado em vermelho

docs/abertura-chamado-vpn/                  ← documentação gerada (local, fora do git)
├── README.md                               ← passo a passo em pt-BR
├── img/passo-01.png ...                    ← só os prints referenciados
└── abertura-chamado-vpn.pdf                ← opcional
```

O texto sai em tom imperativo ("Clique em **Salvar**"), com micro-ações agrupadas em etapas
lógicas — um formulário inteiro vira um passo, não dez.

## Privacidade e segurança

O gravador foi desenhado assumindo que você vai passar por telas de login:

- **Tela com campo de senha não gera print.** Na dúvida (falha ao inspecionar a página),
  também não gera.
- **Valores de senha nunca são registrados** — o passo fica com `value: null`.
- **Navegação que sai de uma tela de senha** tem a URL gravada sem `query` nem `#fragment`
  (um submit de login pode carregar credencial ali) e não gera print. A proteção continua
  enquanto a página for a mesma.
- **O estado é por aba:** uma tela de login na aba A não suprime prints da aba B.
- **Nada sai da sua máquina pelo gravador.** `sessions/`, `browser-profile/`, `runtime/` e a
  documentação gerada são locais e estão no `.gitignore` — só as specs do próprio projeto,
  em `docs/superpowers/`, são versionadas.

Ainda assim: **confira os prints antes de divulgar a documentação**. Se aparecer dado
sensível numa tela que não é de senha, ele estará na imagem.

## Estrutura do repositório

```
.claude/skills/
├── documentar/       ← skill do fluxo completo (+ bootstrap.ps1 do runtime)
└── gerar-doc/        ← skill que escreve a doc a partir de uma sessão
dist/doc-agent.mjs    ← bundle do gravador, versionado (é o que roda no cliente)
tools/recorder/       ← código-fonte do gravador, testes e smokes
docs/superpowers/     ← specs e planos de implementação do projeto
```

O `dist/doc-agent.mjs` é commitado de propósito: é ele que permite clonar e usar sem
`npm install`.

## Desenvolvimento

Tudo dentro de `tools/recorder` (aí sim com `npm install`):

```bash
npm test               # 31 testes unitários (node --test), sem navegador
npm run build          # regera dist/doc-agent.mjs — commite o bundle junto
npm run smoke          # pipeline ponta a ponta (exige Chrome/Edge)
npm run smoke:security # supressão de prints e URLs em telas de senha
npm run smoke:pdf      # exportação em PDF
```

- Alterou `src/`? Rode `npm run build` e commite o `dist/` no mesmo commit.
- Atualizar o Node portátil: edite `$NodeVersion` em
  `.claude/skills/documentar/scripts/bootstrap.ps1`.

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| "Chrome/Edge não encontrado" | defina `DOC_AGENT_CHROME` com o caminho do executável |
| Falha no download do runtime | a saída do bootstrap traz o link do zip e a pasta de destino para a instalação manual |
| A gravação terminou sem passos | o navegador foi fechado sem nenhuma ação registrada — regrave |
| Sessão inválida ou vazia | não gere doc parcial: regrave com `/documentar <nome>` |

## Licença

[MIT](LICENSE) © Samuel Alves
