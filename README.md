# doc-agent

Gera documentação técnica passo a passo (estilo Scribe) a partir de uma gravação
passiva das suas ações no navegador. Duas partes:

1. **Gravador** (`doc-agent record`) — abre um Chrome com perfil dedicado, registra
   cliques/digitação/navegação e tira prints automaticamente. Não usa IA nem tokens.
2. **Skill `/gerar-doc`** — o Claude Code lê a sessão gravada e escreve o markdown
   final em `docs/`, em pt-BR e tom imperativo.

## Requisitos

- Node.js ≥ 20, Google Chrome ou Microsoft Edge instalado.
- (Opcional) `DOC_AGENT_CHROME` apontando para o executável do navegador, se fora dos caminhos padrão.

## Uso

```powershell
npm install                              # uma vez
node src/cli.js record abertura-chamado-vpn
# → execute o procedimento no navegador que abriu; Ctrl+C encerra
# → sessions/2026-08-19-abertura-chamado-vpn/
```

Depois, numa sessão do Claude Code neste projeto:

```
/gerar-doc sessions/2026-08-19-abertura-chamado-vpn
# → docs/abertura-chamado-vpn/README.md + img/
```

**Revise os prints antes de publicar** — dados pessoais que estavam na tela aparecem nas imagens.

## Notas

- O primeiro `record` abre um perfil de navegador zerado (`browser-profile/`): logue nos
  sistemas uma vez; os logins persistem nas próximas gravações. (Chrome 136+ não permite
  gravar no seu perfil pessoal.)
- Telas de login com campo de senha não geram prints, e valores de senha nunca são registrados.
- `sessions/` e `browser-profile/` são locais e nunca vão para o git.
