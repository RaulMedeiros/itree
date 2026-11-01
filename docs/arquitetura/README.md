# Arquitetura — modelo C4

Diagramas da Engine de Inteligência Arbórea no modelo [C4](https://c4model.com/):
contexto, contêineres, componentes, implantação e fluxos dinâmicos. Eles
descrevem **o que está implementado** (fases F0–F3 do painel web). O que ainda
é plano aparece tracejado e marcado como _planejado_.

As decisões por trás das escolhas estão nos ADRs
([ADR-0001 — stack](../adr/0001-stack-tecnica.md),
[ADR-0002 — identidade e autorização](../adr/0002-identidade-e-autorizacao.md)).
As decisões ainda abertas estão em [`decisoes/pendentes.md`](../decisoes/pendentes.md).

Os diagramas são Mermaid: o GitHub os renderiza direto nesta página. Para
editar, altere o bloco de código; não há imagem gerada para manter em dia.

**Legenda.** Azul-escuro = pessoa; verde = contêiner ou componente deste
sistema; cinza = sistema externo; borda tracejada = planejado, ainda não
implementado.

---

## Nível 1 — Contexto do sistema

Quem usa a plataforma e com que sistemas ela conversa.

```mermaid
flowchart TB
    classDef pessoa fill:#08427b,stroke:#052e56,color:#fff
    classDef sistema fill:#1f6b45,stroke:#16502f,color:#fff
    classDef externo fill:#8a8f8c,stroke:#5f6461,color:#fff
    classDef planejado fill:#fff,stroke:#8a8f8c,color:#333,stroke-dasharray:5 5

    gestor["<b>Gestão e coordenação</b><br/>[Pessoa]<br/>Acompanha indicadores, prioriza ocorrências,<br/>cria e distribui tarefas"]:::pessoa
    revisor["<b>Revisão técnica</b><br/>[Pessoa]<br/>Valida inspeções, confirma espécies,<br/>importa e saneia o inventário"]:::pessoa
    tecnico["<b>Técnico de campo</b><br/>[Pessoa]<br/>Inspeciona árvores, registra medidas<br/>e evidências"]:::pessoa
    analista["<b>Analista ambiental</b><br/>[Pessoa]<br/>Tria alertas e os converte em ocorrências"]:::pessoa
    admin["<b>Administração</b><br/>[Pessoa]<br/>Usuários, papéis, escopos, catálogos<br/>e integrações"]:::pessoa

    engine["<b>Engine de Inteligência Arbórea</b><br/>[Sistema]<br/>Inventário arbóreo georreferenciado, inspeções,<br/>ocorrências, tarefas, alertas e indicadores,<br/>com proveniência e auditoria"]:::sistema

    idp["<b>Provedor de identidade</b><br/>[Sistema externo]<br/>Keycloak (OIDC); pode federar com o<br/>SSO da prefeitura (DP-19)"]:::externo
    inpe["<b>INPE / MapBiomas</b><br/>[Sistema externo]<br/>Focos de calor (BDQueimadas) e<br/>alertas de desmatamento (DETER)"]:::externo
    mapas["<b>Provedores de mapa base</b><br/>[Sistema externo]<br/>Ruas (OpenStreetMap) e satélite (DP-07)"]:::externo
    municipais["<b>Sistemas municipais</b><br/>[Sistema externo]<br/>CKAN, cadastro e protocolo (DP-10, DP-12)"]:::planejado

    gestor & revisor & analista & admin -- "Usa o painel web<br/>[HTTPS]" --> engine
    tecnico -- "Usa o aplicativo de campo (planejado)<br/>e o painel web [HTTPS]" --> engine
    engine -- "Delega login e valida tokens<br/>[OIDC/JWT]" --> idp
    engine -- "Ingere alertas periodicamente<br/>ou por arquivo [HTTPS]" --> inpe
    engine -- "Exibe camadas base<br/>[tiles HTTPS]" --> mapas
    engine -. "Importa dados e territórios<br/>(hoje por arquivo)" .-> municipais
```

Pontos do contexto:

- **Ninguém de fora da prefeitura acessa o sistema.** Não há portal público
  nem canal de cidadão nesta fase.
- **Alertas externos são sinais, não conclusões.** O sistema registra a fonte
  e o horário da detecção, e a decisão é sempre humana (W-08).
- **Território.** Bairros e limites municipais entram por importação
  (`importar_territorios`), com fonte e data de referência registradas.

---

## Nível 2 — Contêineres

Os processos e armazenamentos que compõem o sistema.

```mermaid
flowchart TB
    classDef pessoa fill:#08427b,stroke:#052e56,color:#fff
    classDef conteiner fill:#1f6b45,stroke:#16502f,color:#fff
    classDef dado fill:#2e7d57,stroke:#16502f,color:#fff
    classDef externo fill:#8a8f8c,stroke:#5f6461,color:#fff
    classDef planejado fill:#fff,stroke:#1f6b45,color:#333,stroke-dasharray:5 5

    usuario["<b>Usuários do painel</b><br/>[Pessoa]"]:::pessoa
    campo["<b>Técnico de campo</b><br/>[Pessoa]"]:::pessoa

    subgraph sistema["Engine de Inteligência Arbórea"]
        direction TB
        spa["<b>Painel web</b><br/>[SPA: React 19, TanStack Router/Query, MapLibre]<br/>Telas de gestão; roda no navegador"]:::conteiner
        nginx["<b>Servidor do painel</b><br/>[nginx]<br/>Entrega o SPA, CSP e cabeçalhos;<br/>proxy reverso de /api/ (mesma origem)"]:::conteiner
        app["<b>Aplicativo de campo</b><br/>[Expo/React Native + SQLite]<br/>Inspeção offline — <i>planejado</i>"]:::planejado
        api["<b>API</b><br/>[Django 5.2 + GeoDjango + DRF, gunicorn]<br/>Regras de negócio, autorização por papel e<br/>escopo territorial, vector tiles, exportações"]:::conteiner
        worker["<b>Worker</b><br/>[Celery]<br/>Ingestão de alertas externos"]:::conteiner
        beat["<b>Agendador</b><br/>[Celery beat]<br/>Dispara a ingestão a cada N horas"]:::conteiner
        db[("<b>Banco de dados</b><br/>[PostgreSQL 16 + PostGIS]<br/>Dados, geometrias, sequências de códigos<br/>e trilha de auditoria (pghistory)")]:::dado
        redis[("<b>Fila</b><br/>[Redis]<br/>Broker do Celery")]:::dado
        s3[("<b>Armazenamento de arquivos</b><br/>[S3-compatível: SeaweedFS local]<br/>Fotos e documentos; bucket privado")]:::dado
    end

    idp["<b>Keycloak</b><br/>[OIDC]"]:::externo
    inpe["<b>INPE / MapBiomas</b>"]:::externo
    tiles["<b>Mapa base</b><br/>[tiles raster]"]:::externo

    usuario -- "HTTPS" --> nginx
    nginx -- "Entrega HTML, JS e config.js" --> spa
    spa -- "REST/JSON e MVT em /api/v1<br/>[HTTPS, Bearer JWT]" --> nginx
    nginx -- "proxy /api/ [HTTP]" --> api
    spa -- "Login (Authorization Code + PKCE)" --> idp
    spa -- "PUT/GET por URL pré-assinada" --> s3
    spa -- "Tiles do mapa base" --> tiles
    campo -.-> app
    app -. "POST /inspecoes/sincronizar<br/>[HTTPS, Bearer JWT]" .-> api
    api -- "Valida assinatura (JWKS), iss, aud" --> idp
    api -- "SQL + PostGIS [TCP 5432]" --> db
    api -- "Assina URLs, confere arquivos" --> s3
    api -- "Enfileira" --> redis
    beat -- "Agenda" --> redis
    worker -- "Consome" --> redis
    worker -- "Grava alertas" --> db
    worker -- "Baixa focos e alertas [HTTPS]" --> inpe
```

| Contêiner | Tecnologia | Código | Imagem |
| --- | --- | --- | --- |
| Painel web + servidor | React + Vite, servido por nginx | `apps/web` | `apps/web/Dockerfile` |
| API | Django + DRF em gunicorn | `backend/` | `backend/Dockerfile` (papel `api`) |
| Worker / agendador | Celery worker / beat | `backend/itree/alertas/tasks.py` | mesma imagem (papéis `worker`, `beat`) |
| Banco | PostgreSQL 16 + PostGIS 3.4 | migrações em `backend/itree/*/migrations` | `postgis/postgis` |
| Fila | Redis 7 | — | `redis` |
| Arquivos | S3-compatível (SeaweedFS no ambiente local) | `backend/itree/core/armazenamento.py` | `chrislusf/seaweedfs` |
| Identidade | Keycloak 26 (realm `itree`) | `infra/docker/keycloak/` | `keycloak/keycloak` |

Escolhas que os diagramas não mostram:

- **Mesma origem.** O navegador fala só com o nginx, que repassa `/api/` à API.
  Por isso o navegador não precisa de CORS.
- **Arquivos não passam pela API.** A API cria a evidência, devolve uma URL
  pré-assinada com tamanho e tipo fixados, e depois confere o objeto no bucket
  antes de marcar a evidência como disponível.
- **Importação e exportação são síncronas** na API. Os limites ficam em 50 mil
  linhas por arquivo, e a exportação avisa quando o resultado foi cortado. O
  Celery hoje só cuida dos alertas; tarefas longas podem migrar para ele.
- **Contrato da API.** O `openapi.yaml` é gerado do código (drf-spectacular),
  e o cliente TypeScript (`packages/api-client`) é gerado dele (Orval). O CI
  falha se algum dos dois estiver desatualizado.

---

## Nível 3 — Componentes da API

Cada app Django é um componente com fronteira própria. Todas as rotas passam
pela mesma cadeia de autenticação, autorização e auditoria.

```mermaid
flowchart TB
    classDef comp fill:#1f6b45,stroke:#16502f,color:#fff
    classDef transversal fill:#16502f,stroke:#0d3520,color:#fff
    classDef dado fill:#2e7d57,stroke:#16502f,color:#fff
    classDef externo fill:#8a8f8c,stroke:#5f6461,color:#fff

    cliente["Painel web / aplicativo"]:::externo

    subgraph api["API — Django + DRF"]
        direction TB
        subgraph cadeia["Cadeia de cada requisição"]
            direction LR
            autent["<b>Autenticação OIDC</b><br/>contas.autenticacao<br/>JWT RS256/ES256 via JWKS;<br/>vincula sub ↔ usuário"]:::transversal
            acesso["<b>Autorização</b><br/>contas.permissoes / contas.acesso<br/>papel → permissões;<br/>escopo territorial (PostGIS)"]:::transversal
            auditoria["<b>Auditoria</b><br/>auditoria.middleware + pghistory<br/>autor, origem e motivo<br/>em cada alteração"]:::transversal
        end

        subgraph dominio["Domínio"]
            direction TB
            territorio["<b>territorio</b><br/>Municípios e bairros importados"]:::comp
            contas["<b>contas</b><br/>Usuários, papéis, escopos, equipes"]:::comp
            inventario["<b>inventario</b><br/>Árvores, espécies, medidas, proveniência;<br/>importação em lote, duplicidades e fusão"]:::comp
            evidencias["<b>evidencias</b><br/>Fotos/documentos via URL pré-assinada"]:::comp
            ocorrencias["<b>ocorrencias</b><br/>Registro, triagem, estados e prazos"]:::comp
            inspecoes["<b>inspecoes</b><br/>Sincronização idempotente com o app;<br/>revisão, validação seletiva, devolução"]:::comp
            tarefas["<b>tarefas</b><br/>Criação em lote, atribuição, andamento"]:::comp
            alertas["<b>alertas</b><br/>Leitura das fontes, deduplicação, triagem"]:::comp
            qualidade["<b>qualidade</b><br/>Regras de pendência; sugestões de IA<br/>com decisão humana"]:::comp
            territorio ~~~ contas ~~~ tarefas
            inventario ~~~ evidencias ~~~ ocorrencias
            inspecoes ~~~ alertas ~~~ qualidade
        end

        subgraph leitura["Consulta e saída"]
            direction LR
            mapa["<b>mapa</b><br/>Vector tiles (ST_AsMVT) com escopo e<br/>agrupamento; busca global; camadas"]:::comp
            indicadores["<b>indicadores</b><br/>Painel com definição, fórmula e fonte"]:::comp
            relatorios["<b>relatorios</b><br/>Análises; CSV, XLSX, GeoJSON, PDF;<br/>registro de cada exportação"]:::comp
        end

        core["<b>core</b><br/>UUIDv7, sequências de códigos (ARV-, OCO-…),<br/>cliente S3, utilidades geográficas"]:::transversal
    end

    db[("PostgreSQL + PostGIS")]:::dado
    s3[("Armazenamento S3")]:::dado
    idp["Keycloak (JWKS)"]:::externo
    fontes["INPE / MapBiomas"]:::externo

    cliente --> autent --> acesso --> auditoria
    auditoria --> dominio
    auditoria --> leitura
    autent -. "chaves públicas" .-> idp
    dominio --> core
    leitura --> core
    evidencias --> s3
    alertas --> fontes
    core --> db
    dominio --> db
    leitura --> db
```

Regras transversais, aplicadas em todos os componentes:

- **Escopo territorial no servidor.** Listas, tiles, busca e exportações
  filtram por interseção com a área do usuário (`filtrar_por_escopo`). As
  escritas validam o ponto com `ponto_no_escopo`. A união das áreas é
  calculada uma vez por requisição.
- **Proveniência.** Cada valor guarda a própria origem (medido, estimado,
  importado, sugerido por IA), e a localização guarda como foi obtida.
- **Auditoria append-only.** As triggers do pghistory gravam cada alteração
  junto com o contexto da requisição (usuário, origem web/app e motivo).

### Componentes do painel web

```mermaid
flowchart LR
    classDef comp fill:#1f6b45,stroke:#16502f,color:#fff
    classDef pacote fill:#2e7d57,stroke:#16502f,color:#fff
    classDef externo fill:#8a8f8c,stroke:#5f6461,color:#fff

    subgraph web["apps/web"]
        direction TB
        rotas["<b>rotas.tsx</b><br/>TanStack Router; filtros na URL<br/>validados com zod"]:::comp
        autenticacao["<b>autenticacao/</b><br/>oidc-client-ts; sessão e renovação"]:::comp
        acessoWeb["<b>acesso/</b><br/>Usuário atual, permissões,<br/>módulos por fase"]:::comp
        paginas["<b>paginas/</b><br/>Telas por módulo"]:::comp
        mapaWeb["<b>mapa/</b><br/>MapLibre 6, estilos, worker"]:::comp
        ui["<b>ui/ e componentes/</b><br/>Campos, diálogos, histórico,<br/>evidências, seletor de local"]:::comp
    end

    subgraph pacotes["packages/"]
        direction TB
        cliente["<b>api-client</b><br/>Hooks React Query gerados<br/>do openapi.yaml (Orval)"]:::pacote
        dominioPkg["<b>domain</b><br/>Rótulos e vocabulários"]:::pacote
        tokens["<b>ui-tokens</b><br/>Cores e tipografia (Tailwind 4)"]:::pacote
    end

    api["API /api/v1"]:::externo
    idp["Keycloak"]:::externo

    rotas --> paginas
    paginas --> ui & mapaWeb & cliente & dominioPkg
    acessoWeb --> cliente
    rotas --> acessoWeb
    autenticacao --> idp
    cliente -- "Bearer JWT" --> api
    mapaWeb -- "tiles MVT com token" --> api
    ui --> tokens
```

---

## Implantação

### Ambiente local (`infra/docker/compose.yml`)

```mermaid
flowchart LR
    classDef no fill:#1f6b45,stroke:#16502f,color:#fff
    classDef dado fill:#2e7d57,stroke:#16502f,color:#fff
    classDef perfil fill:#fff,stroke:#1f6b45,color:#333,stroke-dasharray:5 5

    navegador["Navegador"]

    subgraph compose["Docker Compose (rede itree)"]
        direction TB
        subgraph padrao["Perfil padrão — infraestrutura"]
            db[("db<br/>postgis 16-3.4<br/>:5432")]:::dado
            redis[("redis 7<br/>:6379")]:::dado
            kc["keycloak 26.4<br/>start-dev + realm itree<br/>:8080"]:::no
            s3[("armazenamento<br/>SeaweedFS S3<br/>:8333")]:::dado
        end
        subgraph completo["Perfil completo"]
            web["web<br/>nginx + SPA<br/>:8088"]:::no
            api["api<br/>gunicorn<br/>:8000"]:::no
            worker["worker<br/>Celery"]:::no
            beat["beat<br/>Celery beat"]:::no
        end
    end

    navegador -- ":8088" --> web
    navegador -- ":8080 login" --> kc
    navegador -- ":8333 upload/download" --> s3
    web -- "/api/" --> api
    api --> db & redis & s3
    api -- "JWKS" --> kc
    worker & beat --> redis
    worker --> db
```

Sem o perfil `completo`, só a infraestrutura sobe: a API roda no host
(`uv run python manage.py runserver`) e o painel no Vite (`pnpm dev`). Os
comandos estão no [README da infra](../../infra/README.md).

### Produção (referência; a hospedagem ainda é a DP-21)

```mermaid
flowchart LR
    classDef no fill:#1f6b45,stroke:#16502f,color:#fff
    classDef dado fill:#2e7d57,stroke:#16502f,color:#fff
    classDef externo fill:#8a8f8c,stroke:#5f6461,color:#fff

    usuario["Usuários<br/>(rede da prefeitura / internet)"]
    borda["<b>Proxy de borda</b><br/>Termina TLS; envia X-Forwarded-Proto"]:::externo

    subgraph app["Nós de aplicação (contêineres)"]
        web["web (nginx + SPA)<br/>N réplicas"]:::no
        api["api (gunicorn)<br/>N réplicas; MIGRAR=1 em uma só"]:::no
        worker["worker (Celery)"]:::no
        beat["beat (Celery) — <b>uma</b> instância"]:::no
    end

    subgraph gerenciados["Serviços gerenciados ou da prefeitura"]
        pg[("PostgreSQL + PostGIS<br/>com backup testado")]:::dado
        redisP[("Redis")]:::dado
        s3P[("Bucket S3 privado")]:::dado
        kcP["Keycloak em modo start<br/>(ou federado ao SSO — DP-19)"]:::externo
    end

    usuario --> borda --> web --> api
    usuario --> borda --> kcP
    usuario -- "URLs pré-assinadas" --> s3P
    api --> pg & redisP & s3P
    api -. JWKS .-> kcP
    worker --> redisP & pg
    beat --> redisP
```

O checklist de produção (segredos, cookies seguros, HSTS, CSP com origens
exatas) está no [README da infra](../../infra/README.md#produção-checklist).

---

## Fluxos dinâmicos

### Login e chamada autenticada

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant SPA as Painel (navegador)
    participant KC as Keycloak
    participant N as nginx
    participant API as API
    participant DB as PostGIS

    U->>SPA: abre /mapa
    SPA->>KC: redireciona (Authorization Code + PKCE)
    U->>KC: credenciais (+ MFA, se exigido)
    KC-->>SPA: código → tokens (access token JWT)
    SPA->>N: GET /api/v1/eu (Bearer JWT)
    N->>API: proxy
    API->>KC: JWKS (em cache)
    API->>API: valida assinatura, iss, aud, exp — vincula sub ao usuário
    API->>DB: papéis, permissões e territórios do escopo
    API-->>SPA: usuário, permissões, escopo
    SPA->>N: GET /api/v1/mapa/tiles/arvores/{z}/{x}/{y}
    N->>API: proxy
    API->>DB: ST_AsMVT filtrado pela área do escopo
    API-->>SPA: vector tile (MVT)
```

### Envio de evidência (foto)

```mermaid
sequenceDiagram
    autonumber
    participant SPA as Painel
    participant API as API
    participant S3 as Bucket S3
    participant DB as PostGIS

    SPA->>API: POST /evidencias {arvore, nome, tipo, tamanho}
    API->>API: permissão + alvo no escopo — tipo permitido — ≤ 25 MB
    API->>DB: cria evidência "aguardando envio" (chave UUIDv7)
    API-->>SPA: url_envio (PUT pré-assinado com Content-Type e Content-Length)
    SPA->>S3: PUT do arquivo (tamanho diferente é recusado pela assinatura)
    SPA->>API: POST /evidencias/{id}/confirmar
    API->>S3: HEAD do objeto
    alt tamanho confere
        API->>DB: evidência "disponível"
        API-->>SPA: evidência com URL de leitura temporária
    else divergente ou ausente
        API->>S3: apaga o objeto divergente
        API-->>SPA: 400 — envie novamente
    end
```

### Sincronização de inspeções (aplicativo de campo)

```mermaid
sequenceDiagram
    autonumber
    participant APP as Aplicativo (offline-first)
    participant API as API
    participant DB as PostGIS

    Note over APP: inspeção criada offline com UUIDv7 e versão local
    APP->>API: POST /inspecoes/sincronizar {dispositivo, inspecoes[]}
    loop cada item (um item inválido não derruba o lote)
        API->>API: árvore ativa e no escopo — tarefa da mesma árvore e do técnico
        alt ID novo
            API->>DB: cria (versão 1) — envio à revisão conclui a tarefa
        else reenvio sem versão base
            API-->>APP: ja_recebida (nada muda)
        else versão base diferente ou já em revisão
            API-->>APP: conflito — o servidor nunca resolve em silêncio
        end
    end
    API-->>APP: resultado por item {status, versão, estado}
```

### Ingestão de alertas ambientais

```mermaid
sequenceDiagram
    autonumber
    participant B as Celery beat
    participant W as Worker
    participant F as INPE / MapBiomas
    participant DB as PostGIS
    actor A as Analista ambiental

    B->>W: ingerir_fontes_configuradas (a cada ALERTAS_INTERVALO_HORAS)
    W->>F: baixa CSV/GeoJSON das fontes configuradas
    W->>DB: deduplica por (fonte, id externo) — descarta fora do município
    W->>DB: registra a ingestão (recebidos, novos, erros)
    A->>DB: tria pelo painel: em triagem → requer verificação → encaminhado à fiscalização (ou descartado)
    A->>DB: converte em ocorrência (vínculo preservado)
```

A administração também pode enviar o arquivo de uma fonte pelo painel
(Administração › Integrações). O caminho de ingestão é o mesmo.
