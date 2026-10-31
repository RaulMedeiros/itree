# Especificações — índice

Fonte: [especificação consolidada v1](../referencia/especificacao-consolidada-v1.md).

## Foco atual: painel web desktop

O painel web é orientado a **gestão, análise territorial, supervisão e
configuração**. A execução de inspeções em campo é do aplicativo móvel, que será
especificado depois; o web, porém, precisa ler, revisar e validar o que vier do
campo e funcionar antes de o app existir (ver [W-00 §4](web/00-escopo-e-fases.md#4-origem-dos-dados-antes-do-app-móvel)).

### Specs do web

| ID   | Documento                                                    | Fase proposta |
| ---- | ------------------------------------------------------------ | ------------- |
| W-00 | [Escopo, fases e não-objetivos](web/00-escopo-e-fases.md)    | —             |
| W-01 | [Shell, navegação e padrões de UI](web/01-shell-navegacao.md) | F0            |
| W-02 | [Mapa geoespacial](web/02-mapa.md)                           | F1            |
| W-03 | [Inventário e detalhe de árvore](web/03-inventario.md)       | F1            |
| W-04 | [Ocorrências](web/04-ocorrencias.md)                         | F1            |
| W-05 | [Inspeções: consulta, revisão e validação](web/05-inspecoes.md) | F2         |
| W-06 | [Visão geral (dashboard)](web/06-visao-geral.md)             | F2            |
| W-07 | [Equipes e tarefas](web/07-equipes-tarefas.md)               | F2            |
| W-08 | [Alertas ambientais](web/08-alertas-ambientais.md)           | F3            |
| W-09 | [Análises, relatórios e exportações](web/09-analises-relatorios.md) | F3     |
| W-10 | [Administração](web/10-administracao.md)                     | F0 → F3       |

### Specs transversais

| ID   | Documento                                                        |
| ---- | ---------------------------------------------------------------- |
| T-01 | [Confiabilidade e proveniência de dados](transversal/01-proveniencia-confiabilidade.md) |
| T-02 | [Modelo conceitual de dados](transversal/02-modelo-dados.md)     |
| T-03 | [Acesso, papéis e permissões](transversal/03-acesso-permissoes.md) |
| T-04 | [IA assistiva](transversal/04-ia-assistiva.md)                   |
| T-05 | [Integrações e dados públicos](transversal/05-integracoes.md)    |
| T-06 | [Requisitos não funcionais do web](transversal/06-nao-funcionais.md) |

## Convenções

### Status de documento

`Rascunho` → `Em revisão` → `Aprovado` → `Implementado`. Todos começam em
**Rascunho**.

### Identificadores

| Prefixo | Significado                  | Exemplo        |
| ------- | ---------------------------- | -------------- |
| `RF-`   | Requisito funcional          | `RF-MAPA-003`  |
| `RN-`   | Regra de negócio / confiabilidade | `RN-INV-002` |
| `CA-`   | Critério de aceite           | `CA-OCO-004`   |
| `RNF-`  | Requisito não funcional      | `RNF-PERF-001` |
| `DP-`   | Decisão pendente             | `DP-07`        |

Módulos: `SHELL`, `MAPA`, `INV`, `OCO`, `INSP`, `VG`, `EQP`, `ALR`, `REL`,
`ADM`, `PROV`, `IA`, `INT`, `ACL`.

### Prioridade

`P0` fundação operacional · `P1` gestão e IA assistiva · `P2` avançado —
conforme §9 da especificação consolidada. A **fase** (F0–F3) é a proposta de
sequência de entrega do web e é independente da prioridade de produto.

### Linguagem obrigatória

Os termos abaixo têm significado fixo em toda a especificação e na interface:

| Termo                 | Significado                                                      |
| --------------------- | ---------------------------------------------------------------- |
| Condição aparente     | O que foi observado em campo. Não é diagnóstico.                 |
| Prioridade operacional | Ordem de atendimento definida pela gestão.                      |
| Risco confirmado      | Conclusão de avaliação técnica competente, registrada como tal.  |
| Alerta                | Sinal de fonte externa ou algoritmo. Não é ocorrência confirmada. |
| Ocorrência            | Situação registrada que demanda avaliação ou ação municipal.     |
| Sugestão (IA)         | Inferência armazenada à parte; não altera o cadastro sem ação humana. |
| Medido / Estimado / Inferido / Importado | Origem do valor (ver [T-01](transversal/01-proveniencia-confiabilidade.md)). |
