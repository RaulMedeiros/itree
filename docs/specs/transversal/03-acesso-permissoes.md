# T-03 — Acesso, papéis e permissões

**Status:** Rascunho · Matriz definitiva depende de
[DP-01](../../decisoes/pendentes.md#dp-01).

## 1. Modelo

Permissão = **papel** × **módulo/ação** × **escopo territorial**.

- Escopo territorial: município inteiro, regional(is) ou bairro(s).
- Usuário pode ter mais de um papel; permissões efetivas são a união.

## 2. Matriz provisória (proposta)

Legenda: L = ler · E = criar/editar · V = validar/decidir · A = administrar · — sem acesso

| Módulo / ação                 | Gestor | Coord. | Revisor | Analista amb. | Técnico | Consulta | Admin |
| ----------------------------- | ------ | ------ | ------- | ------------- | ------- | -------- | ----- |
| Mapa e inventário             | L      | L      | L/E     | L             | L/E     | L        | L     |
| Fusão/exclusão de árvore      | —      | —      | V       | —             | —       | —        | V     |
| Importação em lote            | —      | —      | E       | —             | —       | —        | E     |
| Inspeções — revisão/validação | L      | L      | V       | —             | L       | —        | L     |
| Ocorrências                   | L/E    | L/E    | L/E     | L             | L/E     | L        | L     |
| Prioridade operacional        | E      | E      | —       | —             | —       | —        | —     |
| Risco confirmado              | —      | —      | V*      | —             | —       | —        | —     |
| Alertas ambientais — triagem  | L      | —      | —       | V             | —       | L        | L     |
| Equipes e tarefas             | L      | E      | L       | L             | L       | —        | E     |
| Relatórios e exportações      | L/E    | L/E    | L       | L/E           | —       | L        | L     |
| Administração                 | —      | —      | —       | —             | —       | —        | A     |

\* Somente revisores com qualificação técnica registrada (DP-05).

## 3. Requisitos

- **RF-ACL-001** — Autenticação com provedor a definir (preferência por SSO
  institucional da prefeitura, se disponível).
- **RF-ACL-002** — Autorização aplicada no servidor; a interface apenas oculta
  o que não é permitido.
- **RF-ACL-003** — Dados fora do escopo territorial não aparecem em listas,
  mapas, indicadores nem exportações.
- **RF-ACL-004** — Sessões expiram por inatividade (tempo a definir).
