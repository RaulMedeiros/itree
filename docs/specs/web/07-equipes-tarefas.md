# W-07 — Equipes e tarefas

**Status:** Rascunho · **Fase:** F2 · **Prioridade:** P1

## 1. Objetivo

Organizar a execução das atividades de campo: quem faz o quê, onde e até quando.

## 2. Requisitos funcionais

- **RF-EQP-001** — Cadastro de equipes e membros (com W-10), incluindo escopo
  territorial da equipe.
- **RF-EQP-002** — Criar tarefa dos tipos: inspeção de árvore, inspeção de área,
  atendimento de ocorrência, verificação de alerta (F3).
- **RF-EQP-003** — Criação em lote a partir de seleção no mapa ou lista
  (RF-MAPA-022), gerando uma tarefa por item ou uma tarefa agrupada.
- **RF-EQP-004** — Atribuição a usuário ou equipe, com prazo e prioridade.
- **RF-EQP-005** — Estados de execução propostos: `Não iniciada`,
  `Em execução`, `Concluída`, `Bloqueada` (motivo), `Cancelada` (motivo).
- **RF-EQP-006** — Visão por responsável, por território e por prazo (lista e
  mapa); destaque de atrasadas.
- **RF-EQP-007** — Histórico de atribuições e reatribuições.
- **RF-EQP-008** — Tarefa de inspeção é concluída automaticamente quando a
  inspeção vinculada chega a `Em revisão`; o vínculo é visível.
- **RF-EQP-009** — Acompanhamento de pendências e produtividade por equipe e
  período, com definição explícita de cada métrica.

## 3. Regras

- **RN-EQP-001** — Atribuição respeita o escopo territorial do usuário/equipe
  (T-03); exceções exigem permissão.
- **RN-EQP-002** — Métricas de produtividade não ranqueiam pessoas por padrão;
  exibição individual depende de permissão (DP-09).
- **RN-EQP-003** — Rotas são recurso futuro (P2), fora do escopo.

## 4. Critérios de aceite

- **CA-EQP-001** — Selecionar 20 árvores no mapa e criar tarefas gera 20
  tarefas vinculadas, visíveis na lista do responsável.
- **CA-EQP-002** — Reatribuição aparece no histórico com autor, data e motivo.
- **CA-EQP-003** — Tarefas vencidas aparecem como atrasadas no dashboard (W-06)
  com o mesmo número da lista filtrada.
