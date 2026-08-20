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
