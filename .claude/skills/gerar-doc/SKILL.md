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
   - Se `runtime/node.exe` não existir, rode antes:
     `powershell -ExecutionPolicy Bypass -File .claude/skills/documentar/scripts/bootstrap.ps1`
   - Rode: `runtime/node.exe dist/doc-agent.mjs pdf docs/<slug>/README.md`
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
