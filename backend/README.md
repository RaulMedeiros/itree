# Backend

Django + GeoDjango + Django REST Framework sobre PostgreSQL/PostGIS
([ADR-0001](../docs/adr/0001-stack-tecnica.md)).

## Estrutura

| Caminho | Conteúdo |
| ------- | -------- |
| `config/` | Configuração (variáveis de ambiente), rotas, Celery |
| `itree/core/` | Modelo base (UUIDv7), paginação, saúde |
| `itree/territorio/` | Territórios (município, regionais, bairros) e importação |
| `itree/contas/` | Usuários, papéis, escopo, equipes, autenticação OIDC, permissões |
| `itree/auditoria/` | Contexto e consulta da trilha de auditoria |
| `tests/` | Testes (pytest) |

## Desenvolvimento

Requer Python 3.13, [uv](https://docs.astral.sh/uv/), GDAL e os serviços do
`infra/docker/compose.yml` (veja o README da raiz).

```bash
cp .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py criar_administrador --email admin@itree.local --nome "Ana Administradora"
uv run python manage.py runserver
```

### Testes e qualidade

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

### Contrato da API

O OpenAPI é gerado do código e versionado em `packages/api-client/openapi.yaml`.
Depois de mudar a API:

```bash
uv run python manage.py spectacular --file ../packages/api-client/openapi.yaml --validate
cd .. && pnpm gerar:api
```

A CI falha se o contrato ou o cliente gerado estiverem desatualizados.

## Importar territórios

O comando aceita GeoJSON, Shapefile e outros formatos lidos pelo GDAL,
reprojeta para WGS 84 guardando o SRC original e é idempotente por
`(tipo, código)`. Fonte e data são obrigatórias para a proveniência
(RN-PROV-003):

```bash
uv run python manage.py importar_territorios bairros.geojson \
  --tipo bairro --campo-nome <campo do nome> --campo-codigo <campo do código> \
  --fonte "Fortaleza Dados Abertos" --fonte-url <url do conjunto> \
  --data-referencia <AAAA-MM-DD> --municipio Fortaleza
```

Os nomes dos campos dependem do arquivo publicado. Para descobri-los:
`ogrinfo -so -al bairros.geojson`. O conjunto oficial de bairros e o
responsável por ele ainda são uma decisão pendente (DP-10).

## Autenticação e permissões

- Tokens OIDC do Keycloak, validados pela audiência `itree-api`
  ([ADR-0002](../docs/adr/0002-identidade-e-autorizacao.md)).
- Papéis e escopo territorial são administrados no painel, não no Keycloak.
- Matriz provisória de permissões: `itree/contas/permissoes.py` (T-03, DP-01).
- Toda alteração em usuários, equipes e territórios é registrada por triggers
  no banco (`django-pghistory`), com usuário, origem (`web`, `app`, `api`,
  `cli`), URL e justificativa. As tabelas de eventos só aceitam inclusão.
