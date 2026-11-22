# Arquitetura — modelo C4

Diagramas da Engine de Inteligência Arbórea no modelo [C4](https://c4model.com/):
contexto, contêineres, componentes, implantação e fluxos dinâmicos. Eles
descrevem **o que está implementado**: o painel web (F0 a F3) e o que veio depois,
como detecção automática, conectores, imóveis, população e a regra 3-30-300. O que
ainda é plano aparece tracejado e marcado como _planejado_. O rumo atual (pesquisa
e ONG, nada público) está em [decisões de 21/11/2026](../decisoes/2026-11-21-rumo-do-produto.md).

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
    deteccao["<b>Projeto de detecção</b><br/>[Sistema externo]<br/>Detecta árvores em vídeo de carros<br/>e em imagens de satélite"]:::externo
    fontes["<b>Fontes públicas de dados</b><br/>[Sistemas externos]<br/>Fortaleza em Mapas, CKAN, IBGE, INPE,<br/>UrbVerde, Google Open Buildings"]:::externo
    mapas["<b>Provedores de mapa base</b><br/>[Sistema externo]<br/>Ruas (OpenStreetMap) e satélite (DP-07)"]:::externo
    municipais["<b>Sistemas municipais</b><br/>[Sistema externo]<br/>CKAN, cadastro e protocolo (DP-10, DP-12)"]:::planejado

    gestor & revisor & analista & admin -- "Usa o painel web<br/>[HTTPS]" --> engine
    tecnico -- "Usa o aplicativo de campo (planejado)<br/>e o painel web [HTTPS]" --> engine
    engine -- "Delega login e valida tokens<br/>[OIDC/JWT]" --> idp
    deteccao -- "Envia lotes de detecções<br/>[HTTPS, token de integração]" --> engine
    engine -- "Importa e atualiza dados em segundo plano<br/>[HTTPS]" --> fontes
    engine -- "Exibe camadas base<br/>[tiles HTTPS]" --> mapas
    engine -. "Importa dados e territórios<br/>(hoje por arquivo)" .-> municipais
```

Pontos do contexto:

- **Ninguém de fora da prefeitura acessa o sistema.** Não há portal público
  nem canal de cidadão nesta fase.
- **A base de árvores vem, em boa parte, de detecção automática.** Um projeto
  externo envia lotes pela API ou por pacote ZIP. A detecção entra direto no
  inventário, com selo de confiança e origem, e a inspeção ou a revisão humana a
  confirma. O contrato está em
  [detecção automática](../integracoes/deteccao-automatica.md).
- **Alertas externos são sinais, não conclusões.** O sistema registra a fonte
  e o horário da detecção, e a decisão é sempre humana (W-08).
- **Território.** Bairros e limites municipais entram por importação
  (`importar_territorios`), com fonte e data de referência registradas.
- **Fontes públicas.** O que cada fonte alimenta, o comando de importação, a
  periodicidade e a licença estão no [índice de integrações](../integracoes/README.md).
- **Áreas verdes.** Praças, parques urbanos e unidades de conservação entram
  pelo comando `importar_areas_verdes`, a partir da API do Fortaleza em Mapas
  (mapas 99, 86 e 737), com fonte, licença, data de referência e data de
  ingestão. São camada de contexto: não alteram o inventário. A ficha da árvore
  informa a área verde que a contém.

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
        worker["<b>Worker</b><br/>[Celery]<br/>Importações, ingestões, conectores,<br/>detecção e cálculos pesados"]:::conteiner
        beat["<b>Agendador</b><br/>[Celery beat]<br/>Reimportações e cálculos periódicos<br/>(ver Tarefas Celery e agenda)"]:::conteiner
        db[("<b>Banco de dados</b><br/>[PostgreSQL 16 + PostGIS]<br/>Dados, geometrias, sequências de códigos<br/>e trilha de auditoria (pghistory)")]:::dado
        redis[("<b>Fila</b><br/>[Redis]<br/>Broker do Celery")]:::dado
        s3[("<b>Armazenamento de arquivos</b><br/>[S3-compatível: SeaweedFS local]<br/>Fotos e documentos; bucket privado")]:::dado
    end

    idp["<b>Keycloak</b><br/>[OIDC]"]:::externo
    inpe["<b>Fontes públicas</b><br/>[INPE, IBGE, Mapas, CKAN…]"]:::externo
    detector["<b>Projeto de detecção</b>"]:::externo
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
    detector -- "POST /deteccoes/lotes<br/>[HTTPS, Token]" --> nginx
    api -- "Valida assinatura (JWKS), iss, aud" --> idp
    api -- "SQL + PostGIS [TCP 5432]" --> db
    api -- "Assina URLs, confere arquivos" --> s3
    api -- "Enfileira" --> redis
    beat -- "Agenda" --> redis
    worker -- "Consome" --> redis
    worker -- "Grava alertas" --> db
    worker -- "Baixa dados das fontes [HTTPS]" --> inpe
```

| Contêiner | Tecnologia | Código | Imagem |
| --- | --- | --- | --- |
| Painel web + servidor | React + Vite, servido por nginx | `apps/web` | `apps/web/Dockerfile` |
| API | Django + DRF em gunicorn | `backend/` | `backend/Dockerfile` (papel `api`) |
| Worker / agendador | Celery worker / beat | `backend/itree/*/tasks.py`, agenda em `backend/config/settings.py` | mesma imagem (papéis `worker`, `beat`) |
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
- **O trabalho pesado roda no Celery.** A confirmação de importação com mais de
  500 linhas válidas, lotes de detecção com mais de 200 detecções, ações em lote
  grandes, sincronização de conectores, reimportação das fontes e cálculo da
  regra 3-30-300 vão para o worker. Abaixo desses limites, a própria requisição
  resolve (200 ou 201); acima, a API responde 202 e a tela acompanha a situação.
  As exportações continuam síncronas e avisam quando o resultado foi cortado.
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
            areas_verdes["<b>areas_verdes</b><br/>Praças, parques e unidades<br/>de conservação importados"]:::comp
            contas["<b>contas</b><br/>Usuários, papéis, escopos, equipes"]:::comp
            inventario["<b>inventario</b><br/>Árvores, espécies, medidas, proveniência;<br/>importação em lote, duplicidades e fusão"]:::comp
            evidencias["<b>evidencias</b><br/>Fotos/documentos via URL pré-assinada"]:::comp
            ocorrencias["<b>ocorrencias</b><br/>Registro, triagem, estados e prazos"]:::comp
            inspecoes["<b>inspecoes</b><br/>Sincronização idempotente com o app;<br/>revisão, validação seletiva, devolução"]:::comp
            tarefas["<b>tarefas</b><br/>Criação em lote, atribuição, andamento"]:::comp
            alertas["<b>alertas</b><br/>Leitura das fontes, deduplicação, triagem"]:::comp
            qualidade["<b>qualidade</b><br/>Regras de pendência; sugestões de IA<br/>com decisão humana"]:::comp
            deteccao["<b>deteccao</b><br/>Lotes de detecção automática, observações,<br/>pontos de plantio, sinais de remoção, tokens"]:::comp
            conectores["<b>conectores</b><br/>Fontes externas agendadas (GeoJSON, WFS,<br/>ArcGIS, CKAN); camadas de referência"]:::comp
            imoveis["<b>imoveis</b><br/>Edificações, uso por lote, macrozoneamento,<br/>IPTU e áreas edificadas por bairro"]:::comp
            iluminacao["<b>iluminacao</b><br/>Pontos de iluminação pública;<br/>conflito entre árvore e poste"]:::comp
            notificacoes["<b>notificacoes</b><br/>Sino, preferências e e-mail"]:::comp
            territorio ~~~ contas ~~~ tarefas
            inventario ~~~ evidencias ~~~ ocorrencias
            inspecoes ~~~ alertas ~~~ qualidade
            deteccao ~~~ conectores ~~~ imoveis
            iluminacao ~~~ notificacoes
        end

        subgraph leitura["Consulta e saída"]
            direction LR
            mapa["<b>mapa</b><br/>Vector tiles (ST_AsMVT) com escopo e<br/>agrupamento; busca global; camadas"]:::comp
            indicadores["<b>indicadores</b><br/>Painel, ficha do bairro, população, renda, IDH,<br/>regra 3-30-300 e Onde plantar"]:::comp
            relatorios["<b>relatorios</b><br/>Análises; CSV, XLSX, GeoJSON, PDF;<br/>registro de cada exportação"]:::comp
        end

        core["<b>core</b><br/>UUIDv7, sequências de códigos (ARV-, OCO-…),<br/>cliente S3, utilidades geográficas"]:::transversal
    end

    db[("PostgreSQL + PostGIS")]:::dado
    s3[("Armazenamento S3")]:::dado
    idp["Keycloak (JWKS)"]:::externo
    fontes["Fontes públicas e<br/>projeto de detecção"]:::externo

    cliente --> autent --> acesso --> auditoria
    auditoria --> dominio
    auditoria --> leitura
    autent -. "chaves públicas" .-> idp
    dominio --> core
    leitura --> core
    evidencias --> s3
    alertas & conectores & imoveis & iluminacao & indicadores --> fontes
    fontes -. "lotes de detecção" .-> deteccao
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

### Apps Django e responsabilidades

Cada app tem um módulo `tasks.py` só quando roda algo em segundo plano.

| App | Responsabilidade |
| --- | --- |
| `core` | Modelo base (UUIDv7), sequências de códigos, cliente S3, utilidades geográficas, paginação e ações em lote em segundo plano |
| `contas` | Usuários, papéis, escopo territorial, equipes, autenticação OIDC e matriz de permissões |
| `auditoria` | Contexto da requisição para a trilha (pghistory) e consulta da auditoria |
| `territorio` | Município, regionais e bairros; ficha do bairro; importação dos limites oficiais |
| `areas_verdes` | Praças, parques e unidades de conservação; subtipos; conferência com o CNUC; adoção de praças |
| `inventario` | Árvores, espécies e suas referências (Wikidata, Commons, GBIF), medidas, importação de bases legadas, duplicidades e histórico visual |
| `evidencias` | Fotos e documentos por URL pré-assinada, com miniaturas |
| `ocorrencias`, `inspecoes`, `tarefas` | Fluxo operacional: registro, inspeção em campo (sincronização idempotente) e tarefas |
| `alertas` | Focos de calor e supressão de vegetação (INPE), PRODES Caatinga, deduplicação e triagem humana |
| `notificacoes` | Notificações no sino e por e-mail, preferências e retenção |
| `qualidade` | Regras de pendência de dados e registro de sugestões de IA com decisão humana |
| `deteccao` | Recebimento de lotes de detecção automática (API e pacote ZIP), selo de confiança, junção à árvore mais próxima, pontos de plantio e sinais de remoção |
| `conectores` | Fontes externas agendadas com hosts permitidos e bloqueio de rede interna; destino em camada de referência ou lote em prévia |
| `iluminacao` | Pontos de iluminação pública (SEINF) e árvores a até o raio provisório de um poste |
| `imoveis` | Edificações (Google Open Buildings), uso por lote (SEFIN), macrozoneamento, IPTU e áreas edificadas por bairro |
| `indicadores` | Painel da visão geral, instantâneos diários, indicadores externos por bairro (Censo, IDH, renda, ilha de calor), regra 3-30-300, "Onde plantar" e dados da URBFOR |
| `mapa` | Vector tiles com escopo, busca global, camadas, linha do tempo e seleção por área |
| `relatorios` | Análises, exportações (CSV, XLSX, GeoJSON, PDF) e registro de cada exportação |

### Vector tiles do mapa

`GET /api/v1/mapa/tiles/{camada}/{z}/{x}/{y}` gera o tile no PostGIS com
`ST_AsMVT`, já recortado pelo escopo do usuário. As camadas são `arvores`,
`ocorrencias`, `tarefas`, `iluminacao`, `edificacoes` e `macrozoneamento`; cada
uma exige a permissão própria. As regras principais estão em
`backend/itree/mapa/views.py`:

- **Árvores, ocorrências e tarefas:** abaixo do zoom 12, as árvores vêm
  agrupadas por bairro; abaixo do 16, em células com a contagem; a partir do 16,
  uma feição por registro. Árvores e ocorrências aceitam `ate` (linha do tempo).
- **Iluminação e edificações:** centenas de milhares de feições, sem
  agrupamento, só a partir do zoom 15. Abaixo dele o tile vem vazio.
- **Camadas de referência dos conectores** e a camada de população por bairro
  não são MVT: vão em GeoJSON. A ilha de calor é WMS, direto do servidor da
  UrbVerde.

### Tarefas Celery e agenda

O `beat` lê `CELERY_BEAT_SCHEDULE` em `backend/config/settings.py`, no fuso
`America/Fortaleza`. Só uma instância do `beat` deve rodar.

| Tarefa agendada | Quando | O que faz |
| --- | --- | --- |
| `registrar_indicadores` | todo dia, 01:30 | Grava os instantâneos da visão geral por território |
| `limpar_notificacoes_antigas` | todo dia, 02:15 | Apaga notificações vencidas pela retenção |
| `retomar_referencias_com_erro` | todo dia, 05:45 | Tenta de novo as referências de espécies que falharam |
| `disparar_conectores_vencidos` | de hora em hora (minuto 10) | Sincroniza os conectores cuja periodicidade venceu |
| `atualizar_referencias_antigas` | dia 1, 03:30 | Renova as referências de espécies mais antigas |
| `reimportar_areas_verdes` | dia 2, 04:00 | Praças, parques e unidades de conservação |
| `reimportar_adocao_pracas` | dia 2, 04:30 | Adoção de praças |
| `reimportar_iluminacao_publica` | dia 3, 04:00 | Pontos de iluminação pública |
| `reimportar_dados_imobiliarios` | dia 4, 04:40 | IPTU, áreas edificadas e macrozoneamento; depois chama o cálculo 3-30-300 |
| `renovar_fontes_populacao` | dia 6, 05:00 | Confere população, renda, estimativa e IDH e reimporta o que mudou |
| `calcular_3_30_300` | dia 7, 06:20 | Recalcula a regra 3-30-300 por bairro |
| `reimportar_ilha_calor` | 5 de fevereiro, 05:00 | Ilha de calor por bairro (só grava com `URBVERDE_GRAVAR_VALORES`) |
| `ingerir_fontes_configuradas` | a cada `ALERTAS_INTERVALO_HORAS` (padrão 6) | Só existe se `ALERTAS_FONTES` não estiver vazio |

Tarefas sob demanda, disparadas pela API ou por outra tarefa:
`confirmar_importacao` (importação grande), `processar_lote` (detecção),
`sincronizar_conector`, `executar_operacao_em_lote`, `atualizar_referencias_especie`
e `enviar_email_notificacao`.

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

### Importação de fontes públicas

```mermaid
flowchart LR
    beat["Celery beat<br/>(mensal ou anual)"] --> tarefa["tarefa reimportar_*"]
    cli["manage.py importar_*<br/>(uso manual ou offline)"] --> cmd
    tarefa --> cmd["comando de importação"]
    cmd -- "baixa ou lê --arquivo" --> fonte["fonte pública"]
    cmd --> valida["valida, filtra pelo município,<br/>descarta dado pessoal"]
    valida --> db[("PostGIS<br/>valor + fonte, licença,<br/>data de referência e de ingestão")]
    db --> api["API e telas<br/>(mapa, ficha do bairro, Análises)"]
```

Todo importador é **idempotente** e grava a proveniência junto do dado. Se a
fonte falha, a importação atômica não muda nada e a falha sobe para o Celery;
o aviso de "fonte desatualizada" aparece quando a última importação passa do
limite. A lista de fontes está no [índice de integrações](../integracoes/README.md).

### Conectores de fontes externas

```mermaid
sequenceDiagram
    autonumber
    participant B as Celery beat
    participant W as Worker
    participant F as Fonte externa (HTTPS)
    participant DB as PostGIS
    actor P as Pessoa autorizada

    B->>W: disparar_conectores_vencidos (de hora em hora)
    W->>W: confere host permitido, porta 443, IP público e limites
    W->>F: busca GeoJSON, WFS, ArcGIS REST ou CKAN
    alt destino: camada de referência
        W->>DB: troca as feições numa única transação
    else destino: lote de importação
        W->>DB: cria o lote em prévia e para
        P->>DB: revisa e confirma a importação
    end
    W->>DB: registra a execução (origem, resultado, erros)
```

### Detecção automática

```mermaid
sequenceDiagram
    autonumber
    participant D as Projeto de detecção
    participant API as API
    participant W as Worker
    participant DB as PostGIS
    actor R as Pessoa na revisão

    D->>API: POST /deteccoes/lotes (JSON ou multipart) ou pacote ZIP
    API->>API: valida o contrato, guarda as fotos aceitas, registra o lote
    alt até DETECCAO_LIMITE_SINCRONO detecções
        API->>DB: processa na requisição (201)
    else lote grande
        API->>W: processar_lote (202; a origem acompanha a situação)
        W->>DB: processa em blocos, com ponto de retomada
    end
    Note over DB: junta a observação à árvore ativa mais próxima<br/>ou cria árvore nova, com selo de confiança e origem
    Note over DB: berço vazio e toco viram ponto de plantio;<br/>árvore conhecida não vista vira sinal de possível remoção
    R->>DB: confirma a árvore ou decide sobre a remoção
```

Nada é removido sozinho: o sinal de remoção só pede revisão humana. Os selos
(baixa, média, alta) e os raios de junção vêm de configuração
([variáveis de ambiente](../desenvolvimento.md#variáveis-de-ambiente)).
