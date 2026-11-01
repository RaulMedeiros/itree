# Engine de Inteligência Arbórea

Plataforma municipal para inventariar, inspecionar, monitorar e gerir árvores e
áreas verdes, com dados rastreáveis, IA assistiva e operação de campo resiliente
à conectividade.

- **Território inicial:** Fortaleza, Ceará, Brasil
- **Plataformas:** painel web desktop (gestão) e aplicativo móvel (campo)
- **Foco atual:** **painel web desktop**, fase F0
- **Direção visual:** C — Field Operations

> Status: especificação em elaboração. Nada aqui é decisão aprovada, salvo
> quando marcado explicitamente como **Decidido**.

## Estado atual

- **Especificação:** em `docs/` (ver abaixo).
- **Implementação do painel web:**
  - **F0 — Fundação:** login OIDC, navegação por permissão, usuários, papéis,
    escopo territorial, equipes, territórios e trilha de auditoria.
  - **F1 — Inventário territorial:** mapa (vector tiles com escopo e
    agrupamento), inventário com proveniência, medidas, importação em lote,
    possíveis duplicidades e fusão, evidências (fotos no armazenamento S3),
    ocorrências e busca global.
  - **F2 — Gestão operacional:** inspeções (API de sincronização idempotente
    para o aplicativo, fila de revisão, validação seletiva e devolução),
    equipes e tarefas (criação em lote, andamento, reatribuição) e visão geral
    com indicadores definidos e rastreáveis.
  - **F3 — Inteligência e integrações:** alertas ambientais (ingestão
    idempotente de INPE/MapBiomas, triagem humana com vocabulário que nunca
    afirma infração, conversão em ocorrência), análises e exportações
    (CSV, XLSX, GeoJSON e PDF com metadados e auditoria), qualidade de dados
    por regras explícitas e registro de sugestões de IA com decisão humana.

O aplicativo móvel de campo ainda não foi iniciado; o backend já expõe a API
de sincronização de inspeções que ele vai consumir.

- **Arquitetura:** diagramas C4 (contexto, contêineres, componentes,
  implantação e fluxos) em [`docs/arquitetura/`](docs/arquitetura/README.md).
- **Telas:** capturas de todas as telas do painel, com dados sintéticos, em
  [`docs/telas/`](docs/telas/README.md).
- **Melhoria contínua:** ciclo, backlog priorizado e direção visual em
  [`docs/melhoria/`](docs/melhoria/README.md).

![Mapa do painel](docs/telas/02-mapa.png)

## Estrutura do repositório

```
apps/
└── web/                 # Painel web (React + Vite + TanStack + MapLibre a partir da F1)
backend/                 # API Django + GeoDjango + DRF (ver backend/README.md)
packages/
├── api-client/          # Cliente gerado do contrato OpenAPI (openapi.yaml)
├── domain/              # Rótulos e vocabulários compartilhados web/app
└── ui-tokens/           # Tokens de design Field Operations
infra/
└── docker/              # Ambiente local: PostGIS, Redis, Keycloak
scripts/
└── telas/               # Gerador das capturas de tela (dados sintéticos)
docs/
├── arquitetura/         # Diagramas C4
├── telas/               # Capturas das telas do painel
├── melhoria/            # Ciclo de melhoria contínua, backlog e direção visual
├── referencia/          # Especificação consolidada de origem (não editar)
├── specs/               # Specs do web e transversais
├── decisoes/            # Decisões pendentes
└── adr/                 # Decisões de arquitetura
```

Comece por [`docs/specs/README.md`](docs/specs/README.md). Decisões técnicas
ficam em [`docs/adr/`](docs/adr/README.md); a stack está em
[ADR-0001](docs/adr/0001-stack-tecnica.md).

## Rodando tudo em contêineres

```bash
docker compose -f infra/docker/compose.yml --profile completo up -d --build
docker compose -f infra/docker/compose.yml exec api /app/docker/entrypoint.sh \
  manage criar_administrador --email admin@itree.local --nome "Ana Administradora"
```

Painel em http://localhost:8088. Detalhes, variáveis de ambiente e checklist de
produção em [`infra/README.md`](infra/README.md).

## Rodando localmente (desenvolvimento)

Requisitos: Docker, Node 22 + pnpm 10, Python 3.13 + [uv](https://docs.astral.sh/uv/)
e GDAL (`apt install gdal-bin libgdal-dev` ou `brew install gdal`).

1. Serviços de apoio (PostGIS, Redis, Keycloak com o realm `itree` e armazenamento S3):

   ```bash
   docker compose -f infra/docker/compose.yml up -d
   ```

2. Backend, em outro terminal:

   ```bash
   cd backend
   cp .env.example .env
   uv sync
   uv run python manage.py migrate
   uv run python manage.py criar_administrador --email admin@itree.local --nome "Ana Administradora"
   uv run python manage.py runserver
   ```

3. Web, em outro terminal:

   ```bash
   pnpm install
   cp apps/web/.env.example apps/web/.env
   pnpm --filter @itree/web dev
   ```

4. Abra http://localhost:5173 e entre com um dos usuários de desenvolvimento do
   Keycloak:

   | E-mail               | Senha    | Situação inicial                       |
   | -------------------- | -------- | -------------------------------------- |
   | `admin@itree.local`  | `admin`  | Administrador (criado no passo 2)      |
   | `gestor@itree.local` | `gestor` | Sem papéis até o administrador liberar |
   | `novo@itree.local`   | `novo`   | Sem papéis até o administrador liberar |

   Console do Keycloak: http://localhost:8080 (`admin` / `admin`). Essas senhas
   valem **só** para o ambiente local.

Para ter territórios, importe os bairros com `importar_territorios`
(ver [`backend/README.md`](backend/README.md#importar-territórios)).

### Verificações

```bash
pnpm lint && pnpm typecheck && pnpm test     # web e pacotes
cd backend && uv run ruff check . && uv run pytest
```

A CI (`.github/workflows/ci.yml`) roda tudo isso e também confere se o contrato
OpenAPI e o cliente gerado estão atualizados.

## Como contribuir com as specs

1. Toda mudança de spec é feita via pull request.
2. Requisitos têm identificador estável (ex.: `RF-MAPA-003`). Não reutilize IDs
   removidos; marque-os como `Removido`.
3. Ao fechar uma decisão de [`docs/decisoes/pendentes.md`](docs/decisoes/pendentes.md),
   registre data, responsável e as specs afetadas.
4. O documento em `docs/referencia/` é a fonte original e não deve ser alterado;
   divergências são tratadas nas specs.
