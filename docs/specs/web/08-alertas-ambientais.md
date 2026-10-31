# W-08 — Alertas ambientais

**Status:** Rascunho · **Fase:** F3 · **Prioridade:** P1

## 1. Objetivo

Ingerir sinais externos (focos de calor, supressão de vegetação) e apoiar a
**triagem humana**, sem jamais classificar automaticamente a legalidade de um
evento.

> **Regra crítica:** detecção por satélite, foco de calor ou ausência de licença
> encontrada em uma base não prova, por si só, ilegalidade.

## 2. Fontes iniciais

Ver [T-05](../transversal/05-integracoes.md). Candidatas: INPE BDQueimadas,
INPE TerraBrasilis, MapBiomas Alerta. Disponibilidade, licença e frequência
devem ser verificadas antes de cada integração (DP-11).

## 3. Vocabulário de status

| Status                                  | Significado                                       |
| --------------------------------------- | ------------------------------------------------- |
| Alerta detectado                        | Sinal produzido por fonte externa ou algoritmo.   |
| Em triagem                              | Aguardando análise.                               |
| Requer verificação                      | Evidência insuficiente ou contexto inconclusivo.  |
| Compatível com autorização localizada   | Referência de licença potencialmente relacionada; validade, polígono e condições a verificar. |
| Encaminhado à fiscalização              | Enviado para avaliação da autoridade.             |
| Confirmado pela autoridade              | Confirmação formal registrada (documento/protocolo). |
| Descartado                              | Analisado e não procedente, com justificativa.    |

## 4. Requisitos funcionais

- **RF-ALR-001** — Aba "Alertas ambientais" dentro de Ocorrências, visualmente
  distinta (cor, ícone, título) das ocorrências.
- **RF-ALR-002** — Lista com filtros: fonte, período de detecção, período de
  ingestão, status, bairro, área protegida/zoneamento.
- **RF-ALR-003** — Detalhe: fonte, identificador externo, link para o registro
  original quando houver, data de detecção, data de ingestão, geometria
  recebida, sistema de coordenadas original, cruzamentos territoriais
  (bairro, área protegida, zoneamento) com fonte e data de cada camada.
- **RF-ALR-004** — Mapa exibe a geometria como recebida (ponto, polígono), com
  nota sobre resolução da fonte quando conhecida.
- **RF-ALR-005** — Ações de triagem mudam status com justificativa; descarte e
  confirmação exigem justificativa e, para confirmação, referência ao documento
  da autoridade.
- **RF-ALR-006** — "Converter em ocorrência" cria ocorrência vinculada ao
  alerta (RF-OCO-008); "criar tarefa de verificação" cria tarefa (W-07).
- **RF-ALR-007** — Consulta a licenças/autorizações quando houver dado
  acessível e espacialmente compatível; resultado é apenas indicativo.
- **RF-ALR-008** — Alertas da mesma fonte e identificador externo não são
  duplicados em reingestões (idempotência).

## 5. Regras

- **RN-ALR-001** — Nenhum status, texto ou cor sugere "ilegal" ou "infração"
  antes de `Confirmado pela autoridade`.
- **RN-ALR-002** — Data de detecção e data de ingestão são campos distintos e
  ambos exibidos.
- **RN-ALR-003** — Toda mudança de status é auditada.

## 6. Critérios de aceite

- **CA-ALR-001** — Cada alerta mantém fonte e identificador externo.
- **CA-ALR-002** — Data de detecção e data de ingestão são distintas.
- **CA-ALR-003** — O mapa mostra a geometria recebida sem sugerir precisão
  inexistente.
- **CA-ALR-004** — O sistema não classifica automaticamente o evento como ilegal.
- **CA-ALR-005** — Análise e encaminhamento humanos ficam registrados.
- **CA-ALR-006** — Reingerir o mesmo lote da fonte não cria alertas duplicados.

## 7. Dependências e decisões

- [DP-11](../../decisoes/pendentes.md#dp-11) credenciais e limites das APIs.
- [DP-15](../../decisoes/pendentes.md#dp-15) fluxo institucional de
  encaminhamento e confirmação.
