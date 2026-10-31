# T-06 — Requisitos não funcionais do web

**Status:** Rascunho · Metas iniciais propostas; revisar após definição de
infraestrutura e volume real do inventário.

## Desempenho

- **RNF-PERF-001** — Telas de lista respondem em até 2 s (p95) para filtros
  comuns.
- **RNF-PERF-002** — Mapa navegável com ao menos 100 mil árvores (agrupamento
  e/ou tiles vetoriais servidos pelo backend).
- **RNF-PERF-003** — Indicadores do dashboard em até 3 s (p95); cálculos caros
  podem ser pré-agregados, informando a hora do cálculo.

## Compatibilidade

- **RNF-COMP-001** — Navegadores: duas últimas versões de Chrome, Edge e Firefox.
- **RNF-COMP-002** — Resolução mínima de 1366×768; otimizado para 1920×1080.

## Acessibilidade

- **RNF-A11Y-001** — WCAG 2.2 AA: contraste, navegação por teclado, foco
  visível, rótulos para leitores de tela.
- **RNF-A11Y-002** — Estado nunca comunicado apenas por cor.
- **RNF-A11Y-003** — Dados do mapa também acessíveis em forma de lista.

## Idioma e formatos

- **RNF-I18N-001** — Interface em português do Brasil.
- **RNF-I18N-002** — Datas `dd/mm/aaaa`, fuso America/Fortaleza; números com
  vírgula decimal; unidades do SI.

## Segurança e privacidade

- **RNF-SEG-001** — Comunicação somente via HTTPS.
- **RNF-SEG-002** — Autorização aplicada no servidor (RF-ACL-002).
- **RNF-SEG-003** — Conformidade com a LGPD para dados pessoais de usuários e
  de terceiros em fotografias (DP-09).
- **RNF-SEG-004** — Auditoria imutável para o usuário (somente inclusão).

## Operação

- **RNF-OPS-001** — Ambientes separados: desenvolvimento, homologação,
  demonstração (dados fictícios rotulados) e produção.
- **RNF-OPS-002** — Monitoramento de falhas de integração com alerta ao
  administrador.
