# doc-agent

[![CI](https://github.com/samuel-as/doc-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/samuel-as/doc-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B%20(portable%20fallback)-5FA04E?logo=nodedotjs&logoColor=white)
![Browser: Chrome or Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285F4?logo=googlechrome&logoColor=white)
![Built for Claude Code](https://img.shields.io/badge/Claude%20Code-skills-D97757)

[EN](README.md) · **PT-BR**

**Documente um procedimento executando-o.** Você abre o navegador e faz o processo como
sempre; o doc-agent grava cada passo com um print, e o Claude Code transforma isso num
guia passo a passo em markdown — com PDF opcional.

```
você executa no navegador  →  o gravador registra passos + prints  →  o Claude escreve o doc
        (5 minutos)                       (automático)                      (automático)
```

Sem escrever tutorial à mão, sem recortar print, sem manter documentação sincronizada com
telas que mudaram: regravar é mais rápido.

---

## Requisitos

| O quê | Por quê |
|---|---|
| Windows 10/11 | o bootstrap e o runtime são `.ps1` + `node.exe` |
| Google Chrome **ou** Microsoft Edge | o gravador se conecta ao navegador por CDP |
| [Claude Code](https://claude.com/claude-code) | executa a skill `/document` |

Você **não** precisa instalar Node, npm nem dependência alguma: na primeira execução o
doc-agent reaproveita um Node.js 22+ já instalado na máquina ou baixa o Node portátil
oficial (zip fixado, de `nodejs.org`) — uma vez por máquina, em `%LOCALAPPDATA%\doc-agent`
— sem direitos de administrador, sem mexer no PATH, sem registro.

## Instalação

### Como plugin — recomendado, e o único que se atualiza sozinho

No Claude Code:

```
/plugin marketplace add samuel-as/doc-agent
```

```
/plugin install doc-agent@doc-agent
```

Instala uma vez e fica disponível em **todos** os projetos, como `/doc-agent:document`.
Cada release publicada na `main` chega sozinha, na sessão seguinte do Claude Code — sem
Node e sem `npx` no caminho.

### Como skill, em um projeto só

```bash
npx skills add samuel-as/doc-agent
```

Coloca a skill no projeto atual, como `/document`. Precisa de `npx` (ou seja, Node
instalado) e entrega uma cópia congelada: para ir para uma versão nova, rode o comando de
novo.

### Sem Node, sem npx

Clone o repositório e abra o Claude Code nessa pasta:

```bash
git clone https://github.com/samuel-as/doc-agent.git
```

Ou, sem git também: baixe o ZIP do repositório no GitHub ("Code" → "Download ZIP") e
copie de dentro dele a pasta `.claude/skills/document` para `.claude/skills/` do seu
projeto. A skill é autocontida — ela carrega o próprio bootstrap de runtime.

## Uso

### Documentar um procedimento novo

```
/document vpn-ticket-request
```

(instalado como plugin, o comando é `/doc-agent:document vpn-ticket-request` — o resto
deste README escreve `/document` para encurtar)

O que acontece:

1. O runtime é preparado (silencioso quando já está tudo certo).
2. Um navegador de gravação abre com perfil próprio.
3. **Você executa o procedimento como sempre.**
4. **Feche o navegador** para encerrar — a gravação é consolidada e o documento é escrito.

Na primeira gravação, entre nos seus sistemas nesse navegador: o perfil fica em
`%LOCALAPPDATA%\doc-agent\browser-profile`, então as gravações seguintes já começam
autenticadas — em qualquer projeto.

### Regerar a documentação de uma gravação anterior

```
/document vpn-ticket-request
```

O mesmo comando: quando já existe uma gravação com esse nome no projeto, a skill regera a
documentação a partir dela em vez de gravar de novo — útil para reescrever o texto ou
gerar o PDF depois. Rode `/document` sem argumento para escolher entre as gravações
existentes.

## O que você recebe

Tudo de um procedimento fica numa única pasta do projeto onde você rodou `/document`:

```
docs/vpn-ticket-request/
├── README.md                       ← guia passo a passo
├── screenshots/step-01.png ...     ← só os prints que o guia referencia
├── vpn-ticket-request.pdf          ← opcional
└── sessions/2026-08-31-1745/       ← uma pasta por gravação (mantida como histórico)
    ├── session.json                ← o log de passos gravado
    └── shots/step-001.png ...      ← todos os prints daquela gravação
```

Versionar essa pasta (ou não) é decisão sua — o doc-agent nunca mexe no seu `.gitignore`.
Os dados de máquina ficam fora do projeto, em `%LOCALAPPDATA%\doc-agent` (mude com a
variável de ambiente `DOC_AGENT_HOME`): o runtime portátil e o perfil do navegador de
gravação.

O gravador acompanha a interação inteira: cliques (inclusive dentro de shadow DOM e na
`div`/`span` comum que uma SPA transforma em botão — reconhecida pelo cursor de ponteiro),
texto digitado em campos, seleção em listas, checkbox e radio, atalhos de teclado, arrastar
e soltar, e a rolagem necessária para alcançar um controle fora da tela. Depois de uma
navegação ele espera a nova tela ser pintada, então uma página ou rota de SPA que renderiza
tarde é capturada com o conteúdo, não com o spinner.

O texto sai no imperativo ("Clique em **Salvar**"), com microações agrupadas em passos
lógicos — um formulário inteiro vira um passo, não dez. É escrito no **idioma das telas
gravadas**, então uma interface em português produz um guia em português e uma em inglês
produz um em inglês.

## Privacidade e segurança

O gravador foi desenhado partindo do princípio de que você vai passar por telas de login e
formulários com dados pessoais:

- **Valores sensíveis nunca são gravados.** Senhas, códigos de uso único/MFA, números de
  cartão e códigos de segurança, documentos pessoais (CPF, CNPJ, RG, passaporte, SSN…) e
  telefones ficam com `value: null` no passo. A detecção usa o atributo `autocomplete` do
  campo, seu nome/rótulo (em vários idiomas, português incluído) e, para documentos e
  cartões, o próprio valor (dígito verificador / Luhn).
- **Campos sensíveis recebem uma tarja em todo print**, um retângulo sólido, antes de a
  imagem ir para o disco — inclusive na captura temporária mantida durante a gravação, para
  que uma gravação interrompida não deixe campo legível para trás. Se a pintura falhar,
  aquele passo fica sem print nenhum.
- **Limites conhecidos da tarja:** a detecção varre apenas o light DOM do frame de topo
  mais o elemento efetivamente usado — um campo sensível dentro de um shadow root que não
  seja o da interação pode não ser tarjado. Uma ação **dentro de um iframe não gera
  print**: as coordenadas são relativas ao iframe, então uma tarja pintada a partir delas
  cobriria a área errada da página; o passo é gravado sem imagem. Elementos
  `contenteditable` têm os valores sensíveis excluídos da gravação igual a
  `<input>`/`<textarea>`, mas hoje não são tarjados nos prints.
- **Uma navegação que sai de uma tela de senha** tem a URL gravada sem `query` nem
  `#fragment` (um submit de login pode carregar credencial ali). A proteção vale enquanto a
  página continuar a mesma, e é controlada por aba.
- **E-mail e outros valores comuns são gravados** e usados como exemplo no guia.
- **Nada sai da sua máquina pelo gravador.** Os logins ficam em
  `%LOCALAPPDATA%\doc-agent\browser-profile`, nunca dentro de um repositório.

Ainda assim: **revise os prints antes de compartilhar a documentação.** Dado sensível
exibido como texto comum numa tela (uma lista de usuários, um relatório) não é campo de
formulário e vai aparecer na imagem — tanto no documento (`docs/<slug>/screenshots/`)
quanto na gravação bruta (`docs/<slug>/sessions/`).

## Organização do repositório

```
.claude-plugin/marketplace.json   ← faz do repositório um marketplace do Claude Code
.claude/skills/document/          ← a skill (autocontida, viaja inteira via npx)
├── SKILL.md                      ← fluxo de gravar + regerar
├── references/write-doc.md       ← como a documentação é escrita
├── LICENSE.txt                   ← MIT
├── THIRD-PARTY-NOTICES.md        ← licenças dos pacotes compilados no bundle
└── scripts/
    ├── bootstrap.ps1             ← prepara o runtime portátil
    └── doc-agent.mjs             ← bundle do gravador, versionado (é o que roda)
tools/recorder/                   ← código-fonte do gravador, testes e smokes
docs/superpowers/                 ← specs de design e planos de implementação
```

O bundle é versionado de propósito: é o que faz a instalação como plugin, o
`npx skills add` e o clone-e-use funcionarem sem `npm install`.

## Desenvolvimento

Tudo fica em `tools/recorder` (lá você roda, sim, `npm install`):

```bash
npm test               # testes unitários (node --test), sem navegador
npm run build          # regera o bundle + THIRD-PARTY-NOTICES.md — commite junto
npm run smoke          # pipeline ponta a ponta (precisa de Chrome/Edge)
npm run smoke:security # valores sensíveis, tarjas e schema 2 numa tela de login
npm run smoke:dynamic  # shadow DOM + settle de SPA
npm run smoke:pdf      # exportação para PDF
```

- Mexeu em `src/`? Rode `npm run build` e commite os arquivos regerados
  `.claude/skills/document/scripts/doc-agent.mjs` e
  `.claude/skills/document/THIRD-PARTY-NOTICES.md` no mesmo commit — caso contrário o CI
  rejeita a mudança.
- Para atualizar o Node portátil: edite `$NodeVersion` em
  `.claude/skills/document/scripts/bootstrap.ps1`.
- Vai lançar uma release? A versão vive em dois arquivos — `tools/recorder/package.json` e
  a entrada do plugin em `.claude-plugin/marketplace.json`. O CI falha quando os dois
  discordam, porque a instalação como plugin só pega a versão nova quando esse número muda.

## Resolução de problemas

| Sintoma | O que fazer |
|---|---|
| "Chrome/Edge not found" | defina `DOC_AGENT_CHROME` com o caminho do executável |
| Falha ao baixar o runtime | a saída do bootstrap traz o link do zip e a pasta de destino para instalação manual |
| A gravação terminou sem passos | o navegador foi fechado sem nenhuma ação gravada — grave de novo |
| Sessão inválida ou vazia | não gere documentação parcial: grave de novo com `/document <nome>` |
| Preciso dos dados em outro lugar | defina `DOC_AGENT_HOME` para mover runtime + perfil do navegador |

## Licença

[MIT](LICENSE) © Samuel Alves

O bundle versionado `.claude/skills/document/scripts/doc-agent.mjs` redistribui cópias
compiladas de pacotes de terceiros — as licenças estão reproduzidas em
[THIRD-PARTY-NOTICES.md](.claude/skills/document/THIRD-PARTY-NOTICES.md), dentro da pasta
da skill para viajarem junto com o bundle também no `npx skills add` (regerado por
`npm run build`).
