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
- **Implementação:** fase **F0 — Fundação** do painel web: login OIDC, shell
  de navegação, administração de usuários, papéis, escopo territorial, equipes,
  territórios e trilha de auditoria.

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
docs/
├── referencia/          # Especificação consolidada de origem (não editar)
├── specs/               # Specs do web e transversais
├── decisoes/            # Decisões pendentes
└── adr/                 # Decisões de arquitetura
```

Comece por [`docs/specs/README.md`](docs/specs/README.md). Decisões técnicas
ficam em [`docs/adr/`](docs/adr/README.md); a stack está em
[ADR-0001](docs/adr/0001-stack-tecnica.md).

## Rodando localmente

Requisitos: Docker, Node 22 + pnpm 10, Python 3.13 + [uv](https://docs.astral.sh/uv/)
e GDAL (`apt install gdal-bin libgdal-dev` ou `brew install gdal`).

1. Serviços (PostGIS, Redis e Keycloak com o realm `itree` já configurado):

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

   | E-mail | Senha | Situação inicial |
   | ------ | ----- | ---------------- |
   | `admin@itree.local` | `admin` | Administrador (criado no passo 2) |
   | `gestor@itree.local` | `gestor` | Sem papéis até o administrador liberar |
   | `novo@itree.local` | `novo` | Sem papéis até o administrador liberar |

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
