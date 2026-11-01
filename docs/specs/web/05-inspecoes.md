# W-05 — Inspeções: consulta, revisão e validação

**Status:** Implementado (F2; registro pelo web pendente de DP-16) · **Fase:** F2 · **Prioridade:** P0 (consulta) / P1 (revisão e validação)

## 1. Objetivo

No web, inspeções são **consultadas, revisadas, devolvidas e validadas**. A
execução em campo pertence ao app móvel (spec futura).

## 2. Duas dimensões de estado

Estado de processo e estado de sincronização são independentes e exibidos com
selos distintos.

| Processo (negócio)       | Sincronização (transmissão)        |
| ------------------------ | ---------------------------------- |
| Rascunho                 | Pendente de sincronização          |
| Em revisão               | Sincronizando                      |
| Devolvida para correção  | Sincronizada                       |
| Validada                 | Com conflito / Com erro            |

No web, o estado de sincronização é informativo: mostra o que o servidor já
recebeu e, quando houver, o último estado reportado pelo dispositivo.

Transições de processo propostas:

```
Rascunho ──enviar──▶ Em revisão ──validar──▶ Validada
                         │
                         └──devolver (motivo)──▶ Devolvida para correção ──reenviar──▶ Em revisão
```

## 3. Requisitos funcionais

- **RF-INSP-001** — Lista de inspeções com filtros: período, técnico, equipe,
  bairro, estado de processo, estado de sincronização, "requer revisão",
  "possui ocorrência".
- **RF-INSP-002** — Fila de revisão: inspeções `Em revisão` ordenadas por data,
  com contagem e atribuição de revisor.
- **RF-INSP-003** — Detalhe da inspeção: data/hora, técnico, árvore, coordenadas
  e precisão GPS, evidências, espécie (identificada ou sugerida), medidas com
  unidade e método, condição aparente e sinais observados, observações,
  necessidade de encaminhamento, dispositivo e origem.
- **RF-INSP-004** — Comparação lado a lado com a inspeção anterior da mesma
  árvore e com o cadastro atual.
- **RF-INSP-005** — Ações do revisor: validar, devolver com motivo obrigatório,
  confirmar/corrigir espécie sugerida, aceitar/rejeitar sugestões de sinais
  visuais (T-04).
- **RF-INSP-006** — Ao validar, o revisor escolhe quais valores da inspeção
  atualizam o cadastro da árvore (ex.: medidas, espécie, condição aparente);
  nada é aplicado silenciosamente.
- **RF-INSP-007** — Inspeções com conflito de sincronização aparecem em lista
  própria com o detalhe do conflito e as versões envolvidas.
- **RF-INSP-008** — Registro de inspeção no web como contingência, se aprovado
  em [DP-16](../../decisoes/pendentes.md#dp-16): origem `web`, sem GPS de campo,
  marcado na lista.

## 4. Regras

- **RN-INSP-001** — Validação registra revisor, data e (quando decidido em DP-05)
  assinatura técnica.
- **RN-INSP-002** — Uma inspeção validada não é editável; correções geram nova
  versão auditada.
- **RN-INSP-003** — Fotografias permanecem vinculadas à inspeção de origem,
  mesmo quando exibidas no detalhe da árvore.
- **RN-INSP-004** — Sinais visuais apontados por IA usam linguagem "sinal
  visual possível" / "requer avaliação" (T-04).

## 5. Critérios de aceite

- **CA-INSP-001** — Devolver sem motivo não é permitido.
- **CA-INSP-002** — Uma inspeção pode aparecer como `Validada` e, ao mesmo
  tempo, um dispositivo pode reportar sync pendente de um anexo; ambos os selos
  ficam visíveis.
- **CA-INSP-003** — Validar sem selecionar atualizações não altera o cadastro
  da árvore.
- **CA-INSP-004** — Fotografias mostradas no detalhe pertencem à inspeção
  correta (sem mistura entre inspeções).

## 6. Dependências e decisões

- [DP-03](../../decisoes/pendentes.md#dp-03) protocolo e escalas de condição.
- [DP-04](../../decisoes/pendentes.md#dp-04) campos obrigatórios por tipo.
- [DP-05](../../decisoes/pendentes.md#dp-05) validação e assinatura técnica.
