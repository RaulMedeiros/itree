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

| Variável                                                                                | Obrigatória   | Descrição                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `DJANGO_SECRET_KEY`                                                                     | sim           | Chave secreta, longa e aleatória                                                                           |
| `DJANGO_ALLOWED_HOSTS`                                                                  | sim           | Domínios atendidos, separados por vírgula                                                                  |
| `DATABASE_URL`                                                                          | sim           | `postgis://usuario:senha@host:5432/banco`                                                                  |
| `REDIS_URL`                                                                             | sim           | Broker do Celery                                                                                           |
| `OIDC_ISSUER`                                                                           | sim           | Emissor dos tokens, como o navegador o vê                                                                  |
| `OIDC_JWKS_URL`                                                                         | não           | Endereço interno das chaves (padrão: derivado do emissor)                                                  |
| `OIDC_AUDIENCE`                                                                         | não           | Audiência exigida (padrão `itree-api`)                                                                     |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | para arquivos | Armazenamento S3-compatível privado                                                                        |
| `S3_ENDPOINT_URL_PUBLICO`                                                               | para arquivos | Endereço do armazenamento visto pelo navegador (URLs pré-assinadas)                                        |
| `CORS_ALLOWED_ORIGINS`                                                                  | não           | Origens do painel (também aplicadas ao CORS do bucket)                                                     |
| `CSRF_TRUSTED_ORIGINS`                                                                  | não           | Origens confiáveis para o admin do Django                                                                  |
| `ITREE_AMBIENTE`                                                                        | não           | `desenvolvimento`, `homologacao`, `demonstracao` ou `producao`                                             |
| `MIGRAR`                                                                                | não           | `1` aplica migrações e prepara o bucket ao subir a API                                                     |
| `GUNICORN_WORKERS`                                                                      | não           | Padrão 3                                                                                                   |
| `SSL_REDIRECIONAR`, `HSTS_SEGUNDOS`                                                     | não           | Ative quando todo o tráfego for HTTPS                                                                      |
| `ALERTAS_FONTES`                                                                        | não           | JSON `{"inpe_focos": "<url CSV>", "inpe_deter": "<url WFS GeoJSON>"}` para a coleta automática pelo `beat` |
| `ALERTAS_INTERVALO_HORAS`                                                               | não           | Intervalo da coleta automática, em horas (padrão 6)                                                        |

### Painel web

| Variável                        | Obrigatória | Descrição                                 |
| ------------------------------- | ----------- | ----------------------------------------- |
| `ITREE_API_UPSTREAM`            | sim         | `host:porta` da API para o proxy do nginx |
| `ITREE_OIDC_AUTHORITY`          | sim         | URL do realm OIDC                         |
| `ITREE_OIDC_CLIENT_ID`          | não         | Padrão `itree-web`                        |
| `ITREE_URL_API`                 | não         | Vazio = mesma origem (recomendado)        |
| `ITREE_MOSTRAR_MODULOS_FUTUROS` | não         | `true` só fora de produção                |

## Produção (checklist)

A hospedagem ainda está em aberto (DP-21). Independentemente do provedor:

- Termine o TLS num proxy de borda e envie `X-Forwarded-Proto`.
- Use PostgreSQL com PostGIS gerenciado ou com backup e restauração testados.
- Rode o Keycloak em modo `start` (não `start-dev`), com banco próprio e
  redirect URIs do domínio real; ou federe com o SSO da prefeitura (DP-19).
- Use um bucket privado; nunca torne o armazenamento público.
- Gere segredos fortes e guarde-os num cofre, não no compose.
- Rode `manage criar_administrador` uma vez para o primeiro acesso.
