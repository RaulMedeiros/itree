# Infraestrutura e implantação

## Imagens

| Imagem     | Dockerfile                             | Conteúdo                                                                                             |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| API        | `backend/Dockerfile`                   | Django + GDAL. Papéis do contêiner: `api` (gunicorn), `worker` e `beat` (Celery), `manage <comando>` |
| Painel web | `apps/web/Dockerfile` (contexto: raiz) | Build estático servido por nginx, que também faz proxy de `/api/` para a API                         |

```bash
docker build -t itree/api backend
docker build -t itree/web -f apps/web/Dockerfile .
```

As duas imagens rodam sem privilégios (a API como UID 10001) e têm
`HEALTHCHECK`. A mesma imagem do painel serve qualquer ambiente: a configuração
é gerada em `/config.js` na inicialização.

## Ambiente local completo

```bash
docker compose -f infra/docker/compose.yml --profile completo up -d --build
docker compose -f infra/docker/compose.yml exec api /app/docker/entrypoint.sh \
  manage criar_administrador --email admin@itree.local --nome "Ana Administradora"
```

| Serviço                      | Endereço                                  |
| ---------------------------- | ----------------------------------------- |
| Painel web                   | http://localhost:8088                     |
| API (direto)                 | http://localhost:8000/api/v1/saude        |
| Keycloak                     | http://localhost:8080 (`admin` / `admin`) |
| Armazenamento S3 (SeaweedFS) | http://localhost:8333                     |

Sem `--profile completo`, sobem só os serviços de apoio (banco, Redis,
Keycloak, armazenamento) para desenvolver backend e web fora de contêiner.

## Variáveis de ambiente

### API (`api`, `worker`, `beat`)

| Variável                                                                                | Obrigatória   | Descrição                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DJANGO_SECRET_KEY`                                                                     | sim           | Chave secreta, longa e aleatória                                                                                                                                                                                                                                                                                                                                     |
| `DJANGO_ALLOWED_HOSTS`                                                                  | sim           | Domínios atendidos, separados por vírgula                                                                                                                                                                                                                                                                                                                            |
| `DATABASE_URL`                                                                          | sim           | `postgis://usuario:senha@host:5432/banco`                                                                                                                                                                                                                                                                                                                            |
| `REDIS_URL`                                                                             | sim           | Broker do Celery                                                                                                                                                                                                                                                                                                                                                     |
| `OIDC_ISSUER`                                                                           | sim           | Emissor dos tokens, como o navegador o vê                                                                                                                                                                                                                                                                                                                            |
| `OIDC_JWKS_URL`                                                                         | não           | Endereço interno das chaves (padrão: derivado do emissor)                                                                                                                                                                                                                                                                                                            |
| `OIDC_AUDIENCE`                                                                         | não           | Audiência exigida (padrão `itree-api`)                                                                                                                                                                                                                                                                                                                               |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | para arquivos | Armazenamento S3-compatível privado                                                                                                                                                                                                                                                                                                                                  |
| `S3_ENDPOINT_URL_PUBLICO`                                                               | para arquivos | Endereço do armazenamento visto pelo navegador (URLs pré-assinadas)                                                                                                                                                                                                                                                                                                  |
| `CORS_ALLOWED_ORIGINS`                                                                  | não           | Origens do painel (também aplicadas ao CORS do bucket)                                                                                                                                                                                                                                                                                                               |
| `CSRF_TRUSTED_ORIGINS`                                                                  | não           | Origens confiáveis para o admin do Django                                                                                                                                                                                                                                                                                                                            |
| `ITREE_AMBIENTE`                                                                        | não           | `desenvolvimento`, `homologacao`, `demonstracao` ou `producao`                                                                                                                                                                                                                                                                                                       |
| `MIGRAR`                                                                                | não           | `1` aplica migrações e prepara o bucket ao subir a API                                                                                                                                                                                                                                                                                                               |
| `GUNICORN_WORKERS`                                                                      | não           | Padrão 3                                                                                                                                                                                                                                                                                                                                                             |
| `SSL_REDIRECIONAR`, `HSTS_SEGUNDOS`                                                     | não           | Ative quando todo o tráfego for HTTPS                                                                                                                                                                                                                                                                                                                                |
| `ALERTAS_FONTES`                                                                        | não           | JSON `{"inpe_focos": "<url CSV>", "inpe_deter": "<url WFS GeoJSON>"}` para a coleta automática pelo `beat`. A URL aceita `{data}` (AAAAMMDD do dia anterior) e `{data_hoje}`; ver [fontes públicas](../docs/integracoes/fontes-publicas.md)                                                                                                                          |
| `ITREE_CONECTORES_HOSTS_PERMITIDOS`                                                     | não           | Hosts que os conectores de fontes externas podem buscar, separados por vírgula (só HTTPS). Padrão: `mapas.fortaleza.ce.gov.br,dados.fortaleza.ce.gov.br`. Limites opcionais: `ITREE_CONECTORES_TIMEOUT`, `ITREE_CONECTORES_MAX_BYTES`, `ITREE_CONECTORES_MAX_FEICOES`, `ITREE_CONECTORES_MAX_PAGINAS`; ver [fontes públicas](../docs/integracoes/fontes-publicas.md) |
| `ALERTAS_INTERVALO_HORAS`                                                               | não           | Intervalo da coleta automática, em horas (padrão 6)                                                                                                                                                                                                                                                                                                                  |

### Painel web

| Variável                                      | Obrigatória | Descrição                                                                           |
| --------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `ITREE_API_UPSTREAM`                          | sim         | `host:porta` da API para o proxy do nginx                                           |
| `ITREE_OIDC_AUTHORITY`                        | sim         | URL do realm OIDC                                                                   |
| `ITREE_OIDC_CLIENT_ID`                        | não         | Padrão `itree-web`                                                                  |
| `ITREE_URL_API`                               | não         | Vazio = mesma origem (recomendado)                                                  |
| `ITREE_MOSTRAR_MODULOS_FUTUROS`               | não         | `true` só fora de produção                                                          |
| `ITREE_CSP_ORIGENS`                           | não         | Origens extras na CSP (padrão `https:`)                                             |
| `ITREE_MAPA_SATELITE_URL`                     | não         | Tiles raster do satélite, com `{z}/{y}/{x}`. Vazio = a opção "Satélite" não aparece |
| `ITREE_MAPA_SATELITE_ATRIBUICAO`              | não         | Atribuição exigida pelo provedor; aparece no mapa e em "Fontes dos dados"           |
| `ITREE_MAPA_SATELITE_ZOOM_MAXIMO`             | não         | Maior zoom com imagem real (padrão 19); acima dele o mapa sobreamostra              |
| `ITREE_MAPA_SATELITE_NOME`, `_DATA`, `_AVISO` | não         | Nome, data (`AAAA-MM-DD`) e aviso de resolução mostrados ao lado do seletor         |

### Mapa base de satélite

O padrão de desenvolvimento e de demonstração (`apps/web/.env.example` e
`infra/docker/compose.demonstracao.yml`) é o **Sentinel-2 cloudless 2016**, da
EOX (camada `s2cloudless_3857`, a de 2016 sem ano no nome; licença CC BY 4.0).
O WMTS da EOX usa a ordem `{z}/{y}/{x}`. A resolução é de 10 m: a imagem mostra
manchas de vegetação, não árvores individuais, e o painel avisa isso ao lado do
seletor. O zoom nativo é 14; além dele o mapa só amplia a imagem. A atribuição
obrigatória é "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH
(Contains modified Copernicus Sentinel data 2016)". Os anos de 2019 em diante
têm licença CC BY-NC-SA, que não serve para o uso da prefeitura.

Não há provedor de satélite de produção: a escolha (ortofoto da prefeitura ou
imagem comercial de alta resolução, com licença e custo) entra só com a DP-21.
Em produção, inclua o host dos tiles em `ITREE_CSP_ORIGENS`
(`https://tiles.maps.eox.at`, no caso da EOX).

`ITREE_CSP_ORIGENS` entra em `img-src`, `connect-src` e `frame-src` da
Content-Security-Policy do painel. Em produção, prefira listar as origens
exatas do provedor OIDC, do armazenamento S3 e dos mapas base, por exemplo
`https://sso.prefeitura.gov.br https://arquivos.prefeitura.gov.br https://tile.openstreetmap.org`.
A camada "Ilha de calor (UrbVerde)" do mapa busca tiles em `https://urbverde.iau.usp.br`: com a lista de
origens exatas, inclua esse host.
O nginx envia CSP, `X-Frame-Options`, `nosniff` e `Referrer-Policy` só nas
respostas do painel; as rotas da API recebem os cabeçalhos do próprio Django.

## Produção (checklist)

A hospedagem ainda está em aberto (DP-21). Independentemente do provedor:

- Termine o TLS num proxy de borda que sobrescreva `X-Forwarded-Proto` e defina
  `ITREE_CONFIAR_X_FORWARDED_PROTO=sim` no contêiner do painel. Só assim o nginx
  repassa esse valor à API. O padrão (`nao`) ignora o cabeçalho vindo do cliente
  e usa o esquema da própria conexão.
- Não publique a porta 8000 da API: ela deve receber só o nginx do painel. Se
  publicar, restrinja `GUNICORN_FORWARDED_ALLOW_IPS` ao endereço do nginx.
- Use PostgreSQL com PostGIS gerenciado ou com backup e restauração testados.
- Rode o Keycloak em modo `start` (não `start-dev`), com banco próprio e
  redirect URIs do domínio real; ou federe com o SSO da prefeitura (DP-19).
- Use um bucket privado; nunca torne o armazenamento público.
- Defina `EMAIL_HOST` (e `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`,
  `EMAIL_USE_TLS`, que já vem ligado por padrão) do SMTP da prefeitura. Sem `DJANGO_DEBUG`, o padrão de
  `EMAIL_BACKEND` é o SMTP; o console só vale com `DJANGO_DEBUG=true`.
- Gere segredos fortes e guarde-os num cofre, não no compose.
- Rode `manage criar_administrador` uma vez para o primeiro acesso.
