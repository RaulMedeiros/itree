# Direção visual e princípios de interface

Referência para criticar e evoluir as telas. As specs ganham sempre: este
documento diz **como** apresentar, nunca **o que** o sistema afirma.

## Princípios

1. **O dado principal é o protagonista.** No mapa, as árvores. Na visão geral,
   os indicadores e o território. Formulários e filtros ficam recolhíveis e
   sobrepostos, sem roubar área.
2. **Cor carrega significado operacional.** Árvores são coloridas pela
   condição aparente, que mostra onde está o problema. Proveniência vira forma
   e contorno, sem disputar a cor.
3. **Forma antes de cor.** Ocorrência é triângulo, tarefa é quadrado, alerta é
   losango. Assim os símbolos continuam distinguíveis para daltônicos e em
   impressão monocromática.
4. **Honestidade visual.** "Não avaliada" é cinza, não verde. Uma localização
   estimada aparece vazada. Sinais externos ficam em grupo próprio, com aviso
   de que não provam irregularidade.
5. **Referência discreta.** O mapa base (OpenStreetMap) é dessaturado e
   clareado para dar contexto sem competir com os dados.
6. **Tudo o que é mostrado tem origem visível:** fonte, data e método a um
   clique, como no "Como é calculado" dos indicadores e em "Fontes dos dados"
   no mapa.

## Paleta do mapa

Fonte única: [`apps/web/src/mapa/simbologia.ts`](../../apps/web/src/mapa/simbologia.ts).
A legenda usa as mesmas constantes.

| Uso | Cor |
| --- | --- |
| Condição boa / regular / ruim / aparentemente morta / não avaliada | `#2f9e44` / `#e3a008` / `#e8590c` / `#6d4c41` / `#a3ada7` |
| Ocorrência: urgente / alta / média / baixa / sem prioridade | `#c92a2a` / `#e8590c` / `#e3a008` / `#1c7ed6` / `#495057` (triângulo) |
| Tarefa em aberto / atrasada | `#1c7ed6` / `#c92a2a` (quadrado) |
| Alerta ambiental | `#7048e8` (losango, área hachurada) |
| Seleção | `#0b7285` |

## Das referências geradas por IA (mockups de novembro de 2026)

| Ideia | Decisão | Motivo |
| --- | --- | --- |
| Mapa como peça central, com painel de camadas sobreposto | **Adotada** (iteração 1) | Mais área para o dado |
| Pontos coloridos por condição | **Adaptada** | Usa a condição aparente, que vem de inspeção humana validada, e não "saúde" inferida |
| Cartão da árvore com foto | **Adotada** | Ajuda a reconhecer a árvore em campo |
| Nomes de bairro no mapa | **Adotada** | Orientação imediata |
| Barra lateral verde-escura, cartões com ícone e tendência | Backlog | Iteração da visão geral |
| Gráficos de evolução (inspeções por mês, ocorrências por categoria) | Backlog | Iteração da visão geral |
| Metas municipais | Backlog | Depende de metas oficiais (DP-14) |
| Percentual de confiança da IA | **Rejeitada** | DP-13: só depois de calibração validada |
| "Saudável / Atenção / Risco" atribuído por IA | **Rejeitada** | Risco só com confirmação técnica (W-04) |
| CO₂ sequestrado, cobertura de copa, ilhas de calor, −2,1 °C | **Rejeitada por ora** | Sem fonte nem metodologia; pode voltar com fonte declarada |
| Satélite como base padrão | Bloqueada | Provedor pendente (DP-07) |
| Jornada do aplicativo de campo | Referência | Para a spec do app (ainda não iniciado) |
