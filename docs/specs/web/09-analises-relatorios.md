# W-09 — Análises, relatórios e exportações

**Status:** Rascunho · **Fase:** F3 · **Prioridade:** P1

## 1. Objetivo

Transformar dados validados em indicadores e documentos para gestão, com
exportação rastreável.

## 2. Análises propostas

- Árvores cadastradas por bairro.
- Inspeções por período e equipe.
- Percentual de registros com localização válida.
- Distribuição das condições aparentes registradas.
- Ocorrências por tipo, estado e prioridade.
- Tempo entre abertura e atendimento de ocorrência.
- Evolução do inventário e da cobertura de inspeções.
- Alertas ambientais por fonte, período e território.

Todas seguem o contrato de indicador de [W-06 §2](06-visao-geral.md#2-contrato-de-indicador).

## 3. Requisitos funcionais

- **RF-REL-001** — Tela de análise com seleção de indicador, filtros, quebra
  (bairro, equipe, período) e visualização em tabela, gráfico e mapa coroplético
  por bairro.
- **RF-REL-002** — Exportações: CSV, XLSX, PDF e GeoJSON, conforme tipo de dado
  e permissão.
- **RF-REL-003** — Todo arquivo exportado inclui metadados: data de geração,
  usuário, filtros, definição dos indicadores, fontes e datas de atualização.
  Em GeoJSON, também o sistema de referência.
- **RF-REL-004** — Exportações ficam registradas na auditoria.
- **RF-REL-005** — Relatórios salvos (filtros + indicadores) reutilizáveis.
- **RF-REL-006** — Rascunho de relatório assistido por IA (P1, posterior): texto
  marcado como gerado por IA, com referências aos dados usados, editável antes
  de exportar (T-04).

## 4. Regras

- **RN-REL-001** — Exportações de dados pessoais ou localização sensível
  respeitam DP-09.
- **RN-REL-002** — Mapas coropléticos normalizam por área ou população apenas
  quando a fonte do denominador estiver identificada.
- **RN-REL-003** — Não converter correlação em causalidade em textos gerados.

## 5. Critérios de aceite

- **CA-REL-001** — O total exportado em CSV coincide com o total mostrado na
  tela para os mesmos filtros.
- **CA-REL-002** — PDF exportado contém definição, período e fontes de cada
  indicador.
- **CA-REL-003** — Usuário sem permissão de exportação não vê as ações de
  exportar.
