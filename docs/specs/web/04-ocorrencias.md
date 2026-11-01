# W-04 — Ocorrências

**Status:** Implementado (F1) · **Fase:** F1 · **Prioridade:** P0 (básico)

## 1. Objetivo

Registrar e acompanhar situações que demandem avaliação ou ação municipal,
separando observação, prioridade de atendimento e risco confirmado.

## 2. Distinções obrigatórias

| Dimensão               | Quem define                        | Exemplo                          |
| ---------------------- | ---------------------------------- | -------------------------------- |
| Condição aparente      | Quem observou (campo ou registro)  | "Galho aparentemente quebrado"   |
| Prioridade operacional | Gestão / coordenação               | Alta, atender em 48 h            |
| Risco confirmado       | Avaliação técnica competente       | "Risco de queda confirmado" + responsável técnico |

As três aparecem em campos separados, com autor e data próprios.

## 3. Requisitos funcionais

- **RF-OCO-001** — Lista de ocorrências com filtros por tipo, estado,
  prioridade, bairro, equipe/responsável, prazo e origem; ação "ver no mapa".
- **RF-OCO-002** — Registro com campos: tipo, árvore ou área relacionada,
  localização, descrição, evidências, data e origem do registro, condição
  aparente, prioridade operacional, responsável/equipe, prazo.
- **RF-OCO-003** — Ocorrência pode ser vinculada a uma árvore existente ou a uma
  área/ponto sem árvore cadastrada.
- **RF-OCO-004** — Fluxo de estados configurável (W-10); proposta inicial:
  `Aberta` → `Em triagem` → `Encaminhada` → `Em atendimento` → `Concluída`,
  com `Cancelada` (com justificativa) a partir de qualquer estado não final.
- **RF-OCO-005** — Histórico de encaminhamentos: cada mudança de estado,
  responsável ou prioridade fica registrada na linha do tempo.
- **RF-OCO-006** — Registro de risco confirmado é ação separada, restrita a
  perfis habilitados, com responsável técnico e evidência/documento.
- **RF-OCO-007** — Prazo vencido destacado na lista e no detalhe.
- **RF-OCO-008** — Origem do registro: `web`, `app móvel`, `importação`,
  `conversão de alerta ambiental` (W-08), com referência ao item de origem.

## 4. Regras

- **RN-OCO-001** — Prioridade operacional não é derivada automaticamente da
  condição aparente; se houver sugestão de prioridade (P1, T-04), ela é
  exibida como sugestão com critérios explicáveis.
- **RN-OCO-002** — Alertas ambientais não aparecem na lista de ocorrências até
  serem explicitamente convertidos por um usuário (W-08).
- **RN-OCO-003** — Linguagem de risco ("risco de queda", "perigo") só aparece
  no campo de risco confirmado.

## 5. Critérios de aceite

- **CA-OCO-001** — Não é possível registrar risco confirmado sem perfil
  habilitado e responsável técnico.
- **CA-OCO-002** — Mudar prioridade gera evento no histórico com autor e data.
- **CA-OCO-003** — A lista de ocorrências não contém alertas ambientais não
  convertidos.
- **CA-OCO-004** — Ocorrência criada a partir do detalhe da árvore já vem
  vinculada à árvore e à sua localização.

## 6. Dependências e decisões

- [DP-01](../../decisoes/pendentes.md#dp-01) perfis e permissões.
- [DP-17](../../decisoes/pendentes.md#dp-17) tipos de ocorrência e SLAs.
