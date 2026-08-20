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
2. Execute EM BACKGROUND: `runtime/node.exe dist/doc-agent.mjs record <nome>`
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
