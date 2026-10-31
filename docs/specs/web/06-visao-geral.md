# W-06 — Visão geral (dashboard)

**Status:** Rascunho · **Fase:** F2 · **Prioridade:** P1

## 1. Objetivo

Oferecer leitura operacional e territorial do estado da arborização e das
atividades municipais, apenas com indicadores definidos e rastreáveis.

## 2. Contrato de indicador

Todo indicador exibido é definido em um catálogo (configurável em W-10) com:

| Campo               | Descrição                                               |
| ------------------- | ------------------------------------------------------- |
| Nome                | Rótulo exibido.                                         |
| Definição           | Texto em linguagem simples.                             |
| Fórmula             | Regra de cálculo, incluindo tratamento de ausentes.     |
| Período             | Janela padrão e se é instantâneo ou acumulado.          |
| Filtros aplicáveis  | Território, equipe, espécie etc.                        |
| Fonte               | Base(s) usadas e data da última atualização.            |
| Base de registros   | Total ou apenas válidos (RN-INV-001).                   |

Indicadores oficiais e fórmulas dependem de
[DP-14](../../decisoes/pendentes.md#dp-14); os abaixo são propostos.

## 3. Componentes propostos

| Componente                                 | Observação                              |
| ------------------------------------------ | --------------------------------------- |
| Árvores cadastradas (total e válidas)      | Dois números lado a lado.               |
| Inspeções pendentes, atrasadas e concluídas | Atrasada depende de prazo de tarefa.   |
| Distribuição por espécie                   | Somente espécies `Confirmada`; restante em "não confirmada". |
| Distribuição por condição aparente         | Inclui "sem avaliação registrada".      |
| Ocorrências abertas por prioridade         | Separadas de alertas ambientais.        |
| Completude e qualidade do inventário       | % com localização válida, com espécie confirmada, com medidas. |
| Mapa de árvores e ocorrências              | Reaproveita W-02.                       |
| Alertas ambientais por fonte               | Bloco separado, com fonte e data (F3).  |
| Desempenho por equipe e período            | Inspeções concluídas, tempo de atendimento. |
| Atividades recentes                        | Últimos eventos de auditoria relevantes. |

## 4. Requisitos funcionais

- **RF-VG-001** — Filtros globais: período, bairro/território, equipe.
- **RF-VG-002** — Cada cartão abre a definição do indicador e leva à lista
  filtrada que o compõe (drill-down).
- **RF-VG-003** — Cartão mostra fonte e data da última atualização; se
  desatualizado além do limite da fonte, mostra aviso.

## 5. Regras

- **RN-VG-001** — Dado ausente não vira zero sem regra explícita na fórmula.
- **RN-VG-002** — Não inferir condição de saúde sem inspeção/evidência.
- **RN-VG-003** — Alertas externos e ocorrências confirmadas nunca são somados.

## 6. Critérios de aceite

- **CA-VG-001** — Todo indicador possui definição e período visíveis.
- **CA-VG-002** — Aplicar filtro altera todos os cartões de forma consistente e
  o drill-down reproduz o mesmo número.
- **CA-VG-003** — Com fonte indisponível, o cartão informa a indisponibilidade
  em vez de exibir valor.
