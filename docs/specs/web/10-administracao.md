# W-10 — Administração

**Status:** Em implementação (F0: usuários, equipes, territórios, auditoria) · **Fase:** F0 (usuários, papéis, equipes) → F3 (integrações)

## 1. Objetivo

Configurar acesso, catálogos, parâmetros e integrações, com auditoria completa.

## 2. Seções

| Seção                         | Fase | Conteúdo                                                   |
| ----------------------------- | ---- | ---------------------------------------------------------- |
| Usuários                      | F0   | Convite, ativação/desativação, papéis, escopo territorial. |
| Equipes                       | F0   | Equipes, membros, coordenador, território.                 |
| Papéis e permissões           | F0   | Matriz por módulo e ação (T-03).                           |
| Auditoria                     | F0   | Consulta de eventos com filtros e exportação.              |
| Catálogo de espécies          | F1   | Nome científico, nomes comuns, status, fonte taxonômica.   |
| Tipos e estados de ocorrência | F1   | Tipos, fluxo de estados, prazos padrão.                    |
| Parâmetros de inspeção        | F2   | Escalas de condição aparente, campos obrigatórios por tipo. |
| Catálogo de indicadores       | F2   | Contrato de indicador (W-06 §2).                           |
| Dispositivos e sincronização  | F2   | Dispositivos registrados, última sincronização, pendências. |
| Integrações e credenciais     | F3   | Fontes externas, agendamento, estado, último sucesso/erro. |
| Notificações                  | F2   | Eventos que notificam e canais.                            |

## 3. Requisitos funcionais

- **RF-ADM-001** — Usuário desativado perde acesso imediatamente; seus registros
  permanecem com autoria preservada.
- **RF-ADM-002** — Alteração de papel ou permissão é auditada e exige
  confirmação.
- **RF-ADM-003** — Auditoria filtrável por entidade, usuário, ação, período e
  origem (web, app, importação, integração).
- **RF-ADM-004** — Espécies não são excluídas se referenciadas; podem ser
  marcadas como obsoletas com sinônimo/sucessora.
- **RF-ADM-005** — Credenciais de integração nunca são exibidas após salvas
  (apenas substituídas); acesso restrito a administradores.
- **RF-ADM-006** — Estado das integrações: última execução, sucesso/erro,
  registros ingeridos, próxima execução.

## 4. Critérios de aceite

- **CA-ADM-001** — Toda alteração de configuração aparece na auditoria com
  valor anterior e novo.
- **CA-ADM-002** — Credencial salva não pode ser lida pela interface nem pela API.
- **CA-ADM-003** — Remover uma permissão reflete na navegação do usuário afetado
  na próxima requisição.
