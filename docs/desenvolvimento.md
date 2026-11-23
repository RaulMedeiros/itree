# Desenvolvimento

Guia do dia a dia para quem contribui com o código. Para subir o ambiente pela
primeira vez, use o [README](../README.md). Para imagens, contêineres e produção,
veja a [infra](../infra/README.md).

Requisitos: Docker, Node 24 e pnpm 10, Python 3.14 com [uv](https://docs.astral.sh/uv/)
e GDAL.

## Rodar no dia a dia

Serviços de apoio (PostGIS, Redis, Keycloak e armazenamento S3) em contêineres, e
API e painel no host:

```bash
docker compose -f infra/docker/compose.yml up -d      # apoio
cd backend && uv run python manage.py runserver        # API em :8000
pnpm --filter @itree/web dev                           # painel em :5173
```

Tarefas em segundo plano (importações grandes, detecção, conectores) só rodam com
um worker. Se precisar delas fora de contêiner:

```bash
cd backend
uv run celery -A config worker --loglevel INFO
uv run celery -A config beat --loglevel INFO      # só quando quiser testar a agenda
```

Para que fotos funcionem fora de contêiner, o `backend/.env` precisa apontar para
o armazenamento do compose (SeaweedFS), e o bucket precisa existir:

```bash
S3_BUCKET=itree
S3_ENDPOINT_URL=http://localhost:8333
S3_ACCESS_KEY_ID=itree
S3_SECRET_ACCESS_KEY=itree-armazenamento-dev
```

```bash
cd backend && uv run python manage.py preparar_armazenamento
```

## Testes

```bash
# Backend (precisa do PostGIS do compose, ou de um banco próprio)
cd backend
uv run pytest                      # tudo
uv run pytest tests/test_x.py -k nome

# Web e pacotes
pnpm test                          # vitest, via turbo
pnpm --filter @itree/web test
```

- Os testes do backend nunca acessam a rede: a consulta automática de referências
  das espécies é desligada e as fontes externas são simuladas.
- Toda regra nova de servidor vem com um teste que falha sem a correção.
- Quando outra sessão ou outro agente usa o banco ao mesmo tempo, dê um banco
  próprio a cada um: `DATABASE_URL=postgis://itree:itree@localhost:5432/itree_<nome>`.

## Verificação igual à da CI

A CI (`.github/workflows/ci.yml`) roda estes passos. Rode todos antes de abrir um
PR, nesta ordem. O merge só acontece com todas as verificações em `success` (ou
`skipped`).

Backend, em `backend/`:

```bash
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run python manage.py makemigrations --check --dry-run
uv run pytest
uv run python manage.py spectacular --file ../packages/api-client/openapi.yaml \
  --validate --fail-on-warn
```

Web, na raiz:

```bash
pnpm install --frozen-lockfile
pnpm gerar:api
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Depois de gerar, confira `git diff`: o contrato (`openapi.yaml`) e o cliente
(`packages/api-client/src/gerado`) precisam estar commitados e iguais ao gerado.
Para corrigir a formatação, `pnpm format` (todo o repositório) ou
`pnpm exec prettier --write <arquivos>`. No Python, `uv run ruff format .`.

A CI ainda audita as dependências de produção (`pip-audit` e `pnpm audit`),
constrói as duas imagens, roda `manage check --deploy` na imagem da API e sobe a
pilha completa para conferir `/api/v1/saude` e os cabeçalhos de segurança.

## Contrato da API e cliente gerado

O `openapi.yaml` é gerado do código (drf-spectacular) e o cliente TypeScript, dele
(Orval). Nunca edite nenhum dos dois à mão.

1. Mude a view ou o serializador. Dê um `operation_id` estável às rotas novas.
2. Gere o contrato com o `spectacular` (passo acima).
3. Gere o cliente com `pnpm gerar:api`.
4. Commite os dois arquivos juntos com a mudança de API.

Em rebase, não mescle esses arquivos à mão: resolva o código e gere de novo.

## Migrações

```bash
cd backend
uv run python manage.py makemigrations <app>
uv run python manage.py makemigrations --check --dry-run   # como na CI
uv run python manage.py migrate
```

- Uma migração por assunto, com nome que diga o que faz.
- Teste com dados antigos: uma migração que passa em banco vazio pode quebrar com
  lotes anteriores a ela. As capturas (abaixo) sobem a pilha completa e pegam isso.
- A auditoria usa triggers do pghistory. Se mexer em um modelo auditado, confira
  a migração gerada para o modelo de eventos.

## Capturas das telas

`scripts/telas/gerar.sh` recria a pilha com dados sintéticos e regenera
[`docs/telas/`](telas/README.md). Elas são o teste de ponta a ponta do produto:
sobem a pilha real, com dados antigos e novos.

```bash
docker compose -f infra/docker/compose.yml --profile completo build
scripts/telas/gerar.sh
```

- **Apaga o banco e os arquivos do ambiente local** (`docker compose down -v`).
- Disputa a porta 5432 com o banco de testes local: gere as capturas só quando
  nada mais estiver usando o banco.
- Confira o disco antes (`df -h /`). Com ele cheio, o armazenamento S3 local falha.
- Para refazer só algumas telas: `SO=01,15 node scripts/telas/capturar.js /tmp/telas-ids.json docs/telas`.
- Gere as capturas ao fim de todo trabalho que mude modelo, migração ou importação.

Detalhes em [`scripts/telas/README.md`](../scripts/telas/README.md).

## Dados de demonstração

- **Dados de demonstração são sempre sintéticos e declarados.** Árvores,
  ocorrências, inspeções, tarefas, pessoas, alertas e detecções de exemplo são
  inventados. As fotos são ilustrações geradas por código.
- O ambiente de demonstração é declarado por `ITREE_AMBIENTE=demonstracao`
  (`infra/docker/compose.demonstracao.yml`). Com ele, a API avisa que os dados são
  sintéticos e o painel mostra a faixa de aviso.
- Os limites territoriais e as fontes de contexto são dados públicos reais, com
  fonte. Eles não são sintéticos e vêm de `importar_limites_fortaleza` e dos outros
  importadores do [índice de integrações](integracoes/README.md).
- `simular_deteccoes` gera um lote de detecções sintético e o declara como tal.
- Nenhum número ambiental aparece sem fonte e método. Se a fonte falta, a tela diz
  "sem dados".
- Os logins `admin@itree.local`, `gestor@itree.local` e `novo@itree.local` existem
  só no realm de desenvolvimento do Keycloak. Nunca use essas senhas fora do
  ambiente local.

## Variáveis de ambiente

Todas são lidas em `backend/config/settings.py`. O modelo de arquivo é
`backend/.env.example`. **Nunca ponha segredos no repositório**: use o cofre do
ambiente. A lista de variáveis do painel web (`ITREE_*`) e o checklist de produção
estão em [`infra/README.md`](../infra/README.md); em desenvolvimento, o painel lê
`apps/web/.env` (variáveis `VITE_*`, modelo em `apps/web/.env.example`).

### Núcleo, segurança e identidade

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | nenhum (obrigatória) | Chave secreta do Django |
| `DJANGO_DEBUG` | `false` | Modo de depuração; também muda o e-mail padrão para o console |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Domínios atendidos |
| `ITREE_AMBIENTE` | `desenvolvimento` | `desenvolvimento`, `homologacao`, `demonstracao` ou `producao`; a demonstração mostra o aviso de dados sintéticos |
| `DATABASE_URL` | `postgis://itree:itree@localhost:5432/itree` | Banco PostGIS |
| `REDIS_URL` | `redis://localhost:6379/0` | Broker do Celery |
| `OIDC_ISSUER` | `http://localhost:8080/realms/itree` | Emissor dos tokens |
| `OIDC_JWKS_URL` | derivado do emissor | Endereço das chaves públicas |
| `OIDC_AUDIENCE` | `itree-api` | Audiência exigida no token |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Origens do painel |
| `CSRF_TRUSTED_ORIGINS` | vazio | Origens confiáveis para o admin do Django |
| `COOKIES_SEGUROS` | `true` (fora do modo de depuração) | Cookies só por HTTPS |
| `SSL_REDIRECIONAR` | `false` | Redireciona para HTTPS |
| `HSTS_SEGUNDOS` | `0` | Liga o HSTS quando maior que zero |
| `LOG_LEVEL` | `INFO` | Nível do log |

### Armazenamento e e-mail

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `S3_BUCKET` | vazio | Bucket privado de fotos e documentos |
| `S3_ENDPOINT_URL` | nenhum | Endereço interno do armazenamento S3 |
| `S3_ENDPOINT_URL_PUBLICO` | igual ao interno | Endereço visto pelo navegador (URLs pré-assinadas) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | nenhum | Credenciais do armazenamento |
| `S3_REGION` | `us-east-1` | Região |
| `EMAIL_BACKEND` | console com `DJANGO_DEBUG`, SMTP sem ele | Backend de e-mail |
| `EMAIL_HOST`, `EMAIL_PORT` | `localhost`, `25` | SMTP |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | vazios | Credenciais do SMTP |
| `EMAIL_USE_TLS` | `true` | STARTTLS |
| `DEFAULT_FROM_EMAIL` | `iTree <nao-responda@itree.local>` | Remetente |
| `WEB_URL_PUBLICA` | vazio | Endereço do painel nos links dos e-mails |

### Alertas, referências e importação

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `ALERTAS_FONTES` | `{}` | JSON com as URLs das fontes de alerta (`inpe_focos`, `inpe_deter`); vazio desliga a coleta agendada |
| `ALERTAS_INTERVALO_HORAS` | `6` | Intervalo da coleta agendada |
| `ALERTAS_FOCOS_RAIO_AREA_VERDE_KM` | `1.0` | Raio dos focos de calor junto a parques e unidades de conservação |
| `ALERTAS_FOCOS_RAIO_PARQUE_KM`, `ALERTAS_FOCOS_RAIO_UC_KM` | vazios | Raio por tipo de área; vazio usa o geral |
| `PRODES_CAATINGA_BUFFER_KM` | `2.0` | Buffer do município para o PRODES Caatinga |
| `REFERENCIAS_USER_AGENT` | identificação do iTree | Identificação exigida pela Wikimedia |
| `REFERENCIAS_TIMEOUT` | `15` | Tempo limite das consultas, em segundos |
| `REFERENCIAS_AUTOMATICAS` | `true` | Consulta as referências ao cadastrar espécie |
| `REFERENCIAS_IDADE_MAXIMA_DIAS` | `30` | Idade a partir da qual a referência é reconsultada |
| `REFERENCIAS_INTERVALO_SEGUNDOS` | `1.0` | Pausa entre consultas |
| `REFERENCIAS_REPETIR_ERRO_HORAS` | `12` | Espera antes de tentar de novo uma consulta com erro |
| `IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA` | `500` | Acima deste número de linhas, a confirmação vai para o Celery |
| `IMPORTACAO_TAMANHO_MAXIMO_MB` | `50` | Tamanho máximo do arquivo de importação |
| `IMPORTACAO_MAX_MEMBROS_ZIP`, `IMPORTACAO_MAX_DESCOMPACTADO_MB` | `50`, `200` | Limites de ZIP, KMZ e XLSX |
| `IMPORTACAO_RAIO_DUPLICATAS_M` | `2.0` | Distância abaixo da qual uma árvore é possível duplicata |
| `NOTIFICACOES_RETENCAO_LIDAS_DIAS` | `90` | Retenção das notificações lidas |
| `NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS` | `365` | Retenção das não lidas |

### Fontes e indicadores

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `AREAS_VERDES_IDADE_MAXIMA_DIAS` | `60` | Depois deste prazo, a fonte de áreas verdes aparece como desatualizada |
| `ILUMINACAO_RAIO_CONFLITO_M` | `3.0` | Raio **provisório** de conflito entre árvore e poste |
| `URBVERDE_GRAVAR_VALORES` | `false` | Grava a ilha de calor por bairro (uso acadêmico e não comercial, com citação); a demonstração liga |
| `URBVERDE_TIMEOUT` | `180` | Tempo limite das consultas à UrbVerde, em segundos |
| `VEGETACAO_LIMIAR_NDVI` | `0.4` | NDVI a partir do qual conta como vegetação (o "30") |
| `VEGETACAO_COBERTURA_WCS` | `urbverde__NDVI-10m-2021` | Cobertura WCS do NDVI |
| `REGRA_3_30_300_META_RESIDENCIAS_PCT` | `100` | Percentual de residências em "3" e "300" para o bairro atender |

### Conectores e detecção automática

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `ITREE_CONECTORES_HOSTS_PERMITIDOS` | `mapas.fortaleza.ce.gov.br,dados.fortaleza.ce.gov.br` | Hosts que os conectores podem buscar (só HTTPS) |
| `ITREE_CONECTORES_TIMEOUT` | `30` | Tempo limite por busca, em segundos |
| `ITREE_CONECTORES_MAX_BYTES` | 50 MB | Tamanho máximo baixado |
| `ITREE_CONECTORES_MAX_FEICOES` | `20000` | Máximo de feições por execução |
| `ITREE_CONECTORES_MAX_PAGINAS` | `50` | Máximo de páginas por execução |
| `DETECCAO_LIMITE_SINCRONO` | `200` | Lotes até este tamanho são tratados na requisição |
| `DETECCAO_MAX_DETECCOES` | `20000` | Detecções por lote |
| `DETECCAO_MAX_FOTOS_POR_DETECCAO` | `5` | Fotos por detecção |
| `DETECCAO_MAX_FOTO_MB` | `10` | Tamanho de cada foto |
| `DETECCAO_MAX_CORPO_MB` | `100` | Tamanho do corpo da requisição |
| `DETECCAO_PACOTE_MAX_MEMBROS` | `5000` | Arquivos por pacote ZIP |
| `DETECCAO_RAIO_JUNCAO_MINIMO_M`, `DETECCAO_RAIO_JUNCAO_MAXIMO_M` | `2.0`, `15.0` | Raio mínimo e teto para juntar uma observação à árvore mais próxima |
| `DETECCAO_CONFIANCA_MEDIA`, `DETECCAO_CONFIANCA_ALTA` | `0.5`, `0.8` | Faixas do selo de confiança (baixa, média e alta) |
| `ITREE_DETECCAO_HOSTS_FOTOS` | vazio | Hosts de onde o servidor baixa fotos por URL; vazio aceita só multipart e pacote |

No contêiner da API, o `entrypoint.sh` também lê `MIGRAR` (`1` aplica migrações e
prepara o bucket), `GUNICORN_WORKERS` (padrão 3) e `GUNICORN_FORWARDED_ALLOW_IPS`.
