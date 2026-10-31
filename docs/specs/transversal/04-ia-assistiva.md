# T-04 — IA assistiva

**Status:** Rascunho

## 1. Princípio

A IA **sugere**; pessoas habilitadas **decidem**. Toda saída de IA é
identificada, rastreável e reversível.

## 2. Capacidades e uso no web

| Capacidade                      | Prioridade | Uso no web                                    |
| ------------------------------- | ---------- | --------------------------------------------- |
| Qualidade e completude de dados | P0         | Apontar campos inconsistentes no inventário.  |
| Possíveis duplicados            | P0         | Fila de pares para revisão (RF-INV-013).      |
| Sugestão de espécie por imagem  | P0/P1      | Revisor confirma/corrige na revisão (W-05).   |
| Apoio visual à inspeção         | P0/P1      | Revisor aceita/rejeita sinais apontados.      |
| Estimativa de medidas por imagem | P1        | Somente com calibração; marcado `Estimado`.   |
| Priorização de inspeções        | P1         | Ordenação sugerida com critérios explicáveis. |
| Inteligência territorial        | P1         | Cruzamento de indicadores e camadas.          |
| Relatórios assistidos           | P1         | Rascunho com fontes rastreáveis (RF-REL-006). |
| Copiloto de gestão              | P1/P2      | Fora de F0–F3.                                |

## 3. Regras

- **RN-IA-001** — Conteúdo gerado por IA é identificado visualmente
  ("Sugestão de IA").
- **RN-IA-002** — Registrar modelo, versão, data, entrada e resultado original
  de cada inferência.
- **RN-IA-003** — Não exibir percentuais de confiança sem calibração validada
  ([DP-13](../../decisoes/pendentes.md#dp-13)); até lá, usar no máximo
  categorias qualitativas definidas na validação, ou nenhuma.
- **RN-IA-004** — Mostrar alternativas quando a evidência for inconclusiva e
  indicar quando a imagem tem qualidade insuficiente.
- **RN-IA-005** — Sinais visuais usam linguagem "sinal visual possível" /
  "requer avaliação"; nunca diagnóstico fitossanitário ou de risco de queda.
- **RN-IA-006** — Sugestão aceita registra quem aceitou e quando; rejeitada é
  mantida para avaliação do modelo.
- **RN-IA-007** — Não inventar medições, eventos ou indicadores; não converter
  correlação em causalidade; não emitir conclusão legal.
- **RN-IA-008** — Recursos de IA em nuvem podem estar indisponíveis; a interface
  informa e o fluxo continua sem IA.
