# Backend

Django + GeoDjango + Django REST Framework sobre PostgreSQL/PostGIS
([ADR-0001](../docs/adr/0001-stack-tecnica.md)).

## Estrutura

| Caminho | Conteúdo |
| ------- | -------- |
| `config/` | Configuração (variáveis de ambiente), rotas, Celery e agenda (`CELERY_BEAT_SCHEDULE`) |
| `itree/` | Um app Django por assunto; a responsabilidade de cada um está em [Arquitetura](../docs/arquitetura/README.md#apps-django-e-responsabilidades) |
| `itree/core/` | Modelo base (UUIDv7), sequências de códigos, cliente S3, paginação, saúde |
| `itree/contas/`, `itree/auditoria/` | Usuários, papéis, escopo, equipes, autenticação OIDC, permissões; contexto e consulta da trilha de auditoria |
| `itree/territorio/`, `itree/areas_verdes/` | Territórios e áreas verdes, com importação das fontes oficiais |
| `itree/inventario/`, `itree/evidencias/`, `itree/deteccao/` | Árvores, espécies, importação de bases legadas, fotos e detecção automática |
| `itree/ocorrencias/`, `itree/inspecoes/`, `itree/tarefas/`, `itree/alertas/` | Operação e alertas ambientais |
| `itree/indicadores/`, `itree/imoveis/`, `itree/iluminacao/`, `itree/conectores/` | Indicadores por bairro, imóveis e uso do solo, iluminação pública e fontes externas agendadas |
| `itree/mapa/`, `itree/relatorios/`, `itree/notificacoes/`, `itree/qualidade/` | Vector tiles e busca, análises e exportações, notificações, regras de qualidade e sugestões de IA |
| `tests/` | Testes (pytest) |

Os comandos de importação (`manage.py importar_*`) e a agenda estão no
[índice de integrações](../docs/integracoes/README.md). Variáveis de ambiente e
verificação da CI: [desenvolvimento](../docs/desenvolvimento.md).

## Desenvolvimento

Requer Python 3.14, [uv](https://docs.astral.sh/uv/), GDAL e os serviços do
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

Para os limites oficiais de Fortaleza (12 regionais e 121 bairros, do Fortaleza em
Mapas), sem precisar descobrir campos:

```bash
uv run python manage.py importar_limites_fortaleza   # lê a API; --arquivo-bairros/--arquivo-regionais para offline
```

Detalhes e fontes em [`docs/integracoes/fontes-publicas.md`](../docs/integracoes/fontes-publicas.md).

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
