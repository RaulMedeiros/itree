# Detecção automática de árvores: contrato de dados e recebimento

Decisões de 21/11/2026 ([rumo do produto](../decisoes/2026-11-21-rumo-do-produto.md), itens 1 a 5):
a base de árvores virá de outro projeto, que **detecta árvores em vídeo de carros e em imagens de
satélite**. O iTree define o contrato e o outro projeto se adapta. A detecção **entra direto** no
inventário, com **selo de confiança** e **origem** ("via satélite" ou "via vídeo de rua"); a
inspeção de campo ou a revisão humana a promove a **confirmada**.

Este documento é a referência do contrato. O código é `backend/itree/deteccao/` e a validação está em
`contrato.py`.

## Visão geral

```text
projeto de detecção ──► API  POST /api/v1/deteccoes/lotes   (JSON ou multipart, token de integração)
                   └─► Pacote ZIP (tela Inventário › Detecções ou `manage.py importar_deteccoes`)
                                   │
                                   ▼
                     Lote de detecção (situação, contagens, erros, quem enviou)
                                   │  processamento (na requisição ou em Celery)
                                   ▼
        Observação de uma árvore  ·  ponto de plantio possível  ·  sinal de possível remoção
```

As duas entradas viram a mesma coisa por dentro: ambas chamam `servico.receber`, que valida o
contrato, guarda as fotos aceitas e registra o lote.

## Lote

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | texto (até 100) | Identificador do lote na origem. O par `projeto_origem` + `id` é único: reenviar o mesmo lote devolve **409**. |
| `projeto_origem` | texto (até 150) | Nome do projeto que detectou. |
| `versao_modelo` | texto (até 100) | Versão do modelo de detecção. |
| `sensor` | `satelite` \| `video_rua` | Define a origem das árvores criadas: `deteccao_satelite` ou `deteccao_video`. |
| `capturado_em` | data `AAAA-MM-DD` | Data da captura das imagens. |
| `area_coberta` | GeoJSON `Polygon`/`MultiPolygon` (4326), opcional | Área que o lote cobre. **Sem ela não há sinal de possível remoção**, porque o iTree não sabe o que o lote deveria ter visto. |

## Detecção

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | texto (até 100) | Único no lote. |
| `id_rastreamento` | texto, opcional | A mesma árvore em vários quadros. Detecções do mesmo rastreamento e tipo no lote viram **uma árvore** com várias observações. |
| `tipo` | `arvore` \| `berco_vazio` \| `toco` | Padrão `arvore`. Berço e toco não viram árvore. |
| `localizacao` | `{longitude, latitude}` (WGS 84) | Obrigatória. |
| `incerteza_m` | número, 0,01 a 100 | **Obrigatória.** Incerteza da posição, em metros. |
| `confianca` | número de 0 a 1 | **Obrigatória.** |
| `especies` | até 3 `{nome_cientifico, probabilidade}` | Candidatas, da mais provável à menos. |
| `medidas` | `altura`, `diametro_copa`, `dap`: `{valor, unidade, incerteza?}` | Altura e copa em `m` ou `cm`; DAP em `cm`, `mm` ou `m`. Valor fora do plausível (altura e copa acima de 100 m, DAP acima de 500 cm) recusa a detecção. |
| `copa` | GeoJSON `Polygon` válido, opcional | Polígono da copa. |
| `area_copa_m2` | número, opcional | |
| `contexto` | `calcada` \| `canteiro` \| `praca` \| `lote_privado` \| `outro` | |
| `interferencias` | lista de `fiacao`, `poste`, `fachada`, `calcada_danificada` | |
| `sinais` | lista de `inclinacao`, `galhos_secos`, `copa_rala`, `morta` | São sinais **aparentes na imagem**, não diagnóstico. |
| `qualidade_imagem` | número de 0 a 1, opcional | |
| `fotos` | lista (até 5, configurável) | Ver abaixo. |

### Fotos e privacidade (LGPD)

Cada foto traz **`arquivo`** (nome no envio multipart ou no pacote) **ou `url`** (HTTPS), a
**`capturada_em`** (data e hora ISO 8601) e **`anonimizada: true`**. Opcionalmente, `ilustrativa:
true` marca imagem sintética (usado pelo simulador).

> **Rostos e placas devem chegar borrados.** O contrato exige `anonimizada: true` em **cada** foto.
> Foto sem esse campo, ou com `false`, ou com qualquer valor que não seja o booleano `true`, é
> **recusada**: a detecção inteira é recusada, a foto não é baixada nem guardada e o motivo fica no
> lote. O iTree não borra imagens; ele confia na declaração da origem e a registra por foto
> (`Evidencia.anonimizada`).

Formatos aceitos: JPEG, PNG e WebP, até `DETECCAO_MAX_FOTO_MB` (10 MB). A imagem é aberta e
verificada; arquivo que não é imagem recusa a detecção.

Fotos por `url` são baixadas **no processamento**, com a mesma proteção de rede dos conectores:
só HTTPS, porta 443, sem credenciais, **host na lista `ITREE_DETECCAO_HOSTS_FOTOS`** (vazia por
padrão), IP público (verificado antes e depois de conectar), até 3 redirecionamentos revalidados,
tempo limite e limite de bytes. Foto por URL que falha vira aviso no lote e a detecção segue.

## Entrada 1: API

`POST /api/v1/deteccoes/lotes`

### Autenticação

Token de máquina por integração, no cabeçalho `Authorization: Token <valor>`. É próprio e **não
afeta o OIDC** (pessoas continuam entrando com `Authorization: Bearer`).

- O token é criado em **Administração › Integrações** (permissão `admin.configuracao`), com um nome
  e o **escopo territorial** (um ou mais territórios). O valor aparece **uma única vez**; depois só
  o prefixo. No banco fica apenas o hash SHA-256.
- Permissão do token: `deteccao.enviar`. Ele só envia lotes e consulta os que enviou.
- Detecções fora do escopo territorial do token são **recusadas** (uma a uma, com motivo).
- **Revogar** o token o invalida na hora: o próximo envio recebe 401.
- Tudo é auditado: o lote guarda a integração e o usuário de serviço que assina o que foi criado.
  Esse usuário é inativo e nunca entra por OIDC.

### Corpo JSON

```json
{
  "lote": {
    "id": "2026-11-20-rota-aldeota-03",
    "projeto_origem": "deteccao-arvores",
    "versao_modelo": "v2.3.1",
    "sensor": "video_rua",
    "capturado_em": "2026-11-20",
    "area_coberta": {
      "type": "Polygon",
      "coordinates": [[[-38.5200, -3.7400], [-38.5100, -3.7400], [-38.5100, -3.7300], [-38.5200, -3.7300], [-38.5200, -3.7400]]]
    }
  },
  "deteccoes": [
    {
      "id": "d-000123",
      "id_rastreamento": "t-0042",
      "tipo": "arvore",
      "localizacao": {"longitude": -38.5151, "latitude": -3.7352},
      "incerteza_m": 3.5,
      "confianca": 0.87,
      "especies": [
        {"nome_cientifico": "Licania tomentosa", "probabilidade": 0.71},
        {"nome_cientifico": "Ficus benjamina", "probabilidade": 0.18}
      ],
      "medidas": {
        "altura": {"valor": 8.5, "unidade": "m", "incerteza": 1.0},
        "diametro_copa": {"valor": 5.2, "unidade": "m"},
        "dap": {"valor": 24, "unidade": "cm", "incerteza": 4}
      },
      "copa": {"type": "Polygon", "coordinates": [[[-38.51512, -3.73518], [-38.51508, -3.73518], [-38.51508, -3.73522], [-38.51512, -3.73522], [-38.51512, -3.73518]]]},
      "area_copa_m2": 21.2,
      "contexto": "calcada",
      "interferencias": ["fiacao"],
      "sinais": ["galhos_secos"],
      "qualidade_imagem": 0.82,
      "fotos": [
        {"arquivo": "fotos/d-000123-1.jpg", "capturada_em": "2026-11-20T10:21:00-03:00", "anonimizada": true}
      ]
    },
    {
      "id": "d-000124",
      "tipo": "berco_vazio",
      "localizacao": {"longitude": -38.5148, "latitude": -3.7355},
      "incerteza_m": 2.0,
      "confianca": 0.64,
      "contexto": "calcada"
    }
  ]
}
```

### Multipart (com as fotos junto)

`Content-Type: multipart/form-data` com a parte **`dados`** (o JSON acima, de preferência como
**arquivo**, porque campos de texto têm limite de tamanho menor) e uma parte de arquivo por foto,
cujo **nome de arquivo** é o `arquivo` citado na detecção.

```bash
curl -X POST https://itree.exemplo/api/v1/deteccoes/lotes \
  -H "Authorization: Token $TOKEN" \
  -F "dados=@lote.json;type=application/json" \
  -F "fotos=@fotos/d-000123-1.jpg;filename=fotos/d-000123-1.jpg"
```

### Respostas

| Código | Quando |
| --- | --- |
| `201` | Lote com até `DETECCAO_LIMITE_SINCRONO` (200) detecções: processado na própria requisição. O corpo já traz as contagens. |
| `202` | Lote maior: processado em **segundo plano** (Celery). Acompanhe com `GET /api/v1/deteccoes/lotes/{id}`: `situacao` vai de `em_processamento` a `concluido` (ou `falhou`, com `erro`). |
| `401` | Token ausente, inválido ou revogado. |
| `403` | Token sem `deteccao.enviar`. |
| `409` | Lote já recebido (mesmo `projeto_origem` e `id`). |
| `413` | Corpo acima de `DETECCAO_MAX_CORPO_MB` (100 MB). |
| `422` | O lote não obedece ao contrato (metadados inválidos, lista vazia, mais de `DETECCAO_MAX_DETECCOES`, 20 mil). Corpo: `{"detail", "erros": [...]}`. Nada é gravado. |
| `503` | O lote tem fotos e o armazenamento de arquivos não está configurado. |

Detecção inválida **não derruba o lote**: é recusada e entra em `erros` (`{id, motivo, longitude?,
latitude?}`, até 500). `recusadas` conta detecções.

Contagens do lote: `arvores_criadas` e `arvores_juntadas` contam **árvores** (um rastreamento é uma
árvore), `recusadas` conta detecções, `pontos_criados` conta pontos de plantio novos e
`possiveis_remocoes` conta sinais abertos pelo lote.

## Entrada 2: pacote ZIP

Para quem prefere arquivos. O ZIP contém:

| Arquivo | Conteúdo |
| --- | --- |
| `lote.json` | O objeto `lote` acima. Obrigatório. |
| `deteccoes.geojson` **ou** `deteccoes.gpkg` | Um, e só um. Uma feição `Point` (4326) por detecção. |
| fotos (`.jpg`, `.jpeg`, `.png`, `.webp`) | Em qualquer pasta; a detecção cita `arquivo` (caminho completo ou só o nome, se único). |

As propriedades de cada feição são as do JSON, em formato plano. Campos com listas ou objetos
(`especies`, `medidas`, `copa`, `fotos`, `interferencias`, `sinais`) podem ser JSON nativo no GeoJSON
ou **texto JSON** no GeoPackage, que não tem listas; `interferencias` e `sinais` também aceitam
texto separado por vírgula. Atalhos planos: `id_deteccao`, `especie_sugerida` +
`especie_probabilidade`, `altura_m`, `altura_incerteza_m`, `diametro_copa_m`,
`diametro_copa_incerteza_m`, `dap_cm`, `dap_incerteza_cm`.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {"type": "Point", "coordinates": [-38.5151, -3.7352]},
      "properties": {
        "id_deteccao": "d-000123",
        "id_rastreamento": "t-0042",
        "tipo": "arvore",
        "incerteza_m": 3.5,
        "confianca": 0.87,
        "especies": [{"nome_cientifico": "Licania tomentosa", "probabilidade": 0.71}],
        "altura_m": 8.5,
        "dap_cm": 24,
        "contexto": "calcada",
        "interferencias": ["fiacao"],
        "sinais": ["galhos_secos"],
        "fotos": [{"arquivo": "fotos/d-000123-1.jpg", "capturada_em": "2026-11-20T10:21:00-03:00", "anonimizada": true}]
      }
    }
  ]
}
```

Envio: pela tela (**Inventário › Detecções › Enviar pacote**, permissão `deteccao.enviar`), pela
API (`POST /api/v1/deteccoes/lotes/pacote`, multipart com o campo `arquivo`) ou pelo comando
`manage.py importar_deteccoes pacote.zip --usuario pessoa@exemplo`. As proteções são as da
importação de inventário (`leitura_arquivos`): ZIP sem extração para caminho vindo do arquivo, só
extensões conhecidas, limite de membros (`DETECCAO_PACOTE_MAX_MEMBROS`, 5000) e de tamanho
descompactado, leitura GDAL em diretório temporário próprio.

## Do lote ao inventário (regra de junção)

1. **Agrupamento.** Detecções com o mesmo `id_rastreamento` (e o mesmo `tipo`) no lote formam um
   grupo. A posição do grupo é a média ponderada pelo inverso do quadrado da incerteza; a incerteza
   é a combinada; a confiança é a maior; as espécies, a probabilidade média; as medidas, a mediana.
2. **Escopo.** O grupo fora do escopo territorial do token (ou da pessoa que enviou) é recusado.
3. **Árvore.** Se há **árvore ativa a até `max(2 m, incerteza)`** do ponto (mínimo e teto em
   `DETECCAO_RAIO_JUNCAO_MINIMO_M` e `DETECCAO_RAIO_JUNCAO_MAXIMO_M`; distância em metros sobre a
   esfera), o grupo **se junta a ela**: grava as observações, atualiza `ultima_vez_vista_em`,
   acrescenta fotos e medidas **como estimadas** (origem "estimado", método "estimativa por
   imagem"). **Dado confirmado por pessoa nunca é sobrescrito:** a espécie só é preenchida se a
   árvore está "não identificada" (e como "sugerida"); uma medida estimada **não é aplicada** se já
   existe medida medida ou importada do mesmo tipo; a posição não é movida. Se não há árvore
   próxima, **cria** uma, com origem `deteccao_satelite` ou `deteccao_video`, localização "detectada",
   **não confirmada** e a confiança derivada.
4. **Berço vazio e toco** não viram árvore: viram **pontos de plantio possível** (camada no mapa e
   insumo do "Onde plantar"). Um ponto aberto do mesmo tipo no mesmo lugar só renova a "última vez
   visto".
5. **Mudanças entre passagens.** Se o lote traz `area_coberta`, toda árvore ativa conhecida (criada
   até a data da captura), dentro da área coberta e do escopo, que o lote **não viu**, vira um
   **sinal de possível remoção** para revisão. **Nada é removido automaticamente:** a pessoa com
   `deteccao.revisar` confirma a remoção (exclusão lógica, com justificativa, auditada) ou descarta
   o sinal. Um sinal pendente também é descartado sozinho se um lote posterior volta a ver a árvore.

## Selos e confirmação

Confiança em três faixas, com limiares em `DETECCAO_CONFIANCA_MEDIA` (0,5) e
`DETECCAO_CONFIANCA_ALTA` (0,8): **baixa** < 0,5 ≤ **média** < 0,8 ≤ **alta**. A árvore detectada
e não confirmada tem estilo próprio no mapa (anel). **Confirmar árvore** (`deteccao.revisar`) e a
**validação de uma inspeção** a tornam confirmada; as demais árvores (cadastro, importação,
aplicativo) já nascem confirmadas.

## Limites e configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `DETECCAO_LIMITE_SINCRONO` | 200 | Até aqui, na requisição; acima, Celery. |
| `DETECCAO_MAX_DETECCOES` | 20000 | Detecções por lote. |
| `DETECCAO_MAX_FOTOS_POR_DETECCAO` | 5 | |
| `DETECCAO_MAX_FOTO_MB` | 10 | Por foto. |
| `DETECCAO_MAX_CORPO_MB` | 100 | Corpo do envio e do pacote. |
| `DETECCAO_PACOTE_MAX_MEMBROS` | 5000 | Arquivos dentro do ZIP. |
| `DETECCAO_RAIO_JUNCAO_MINIMO_M` / `_MAXIMO_M` | 2 / 15 | Raio de junção. |
| `DETECCAO_CONFIANCA_MEDIA` / `_ALTA` | 0,5 / 0,8 | Faixas do selo. |
| `ITREE_DETECCAO_HOSTS_FOTOS` | vazio | Hosts de onde fotos por URL podem ser baixadas. |

## Dados de demonstração

`manage.py simular_deteccoes` gera um lote **sintético e declarado** (projeto
`simulador-itree`, fotos `ilustrativa`) perto das árvores semeadas e o envia pelo mesmo caminho da
API. Serve às capturas de tela; não representa nenhuma detecção real.

## Contagem nos indicadores

Onde há contagem de árvores, o iTree mostra **"N árvores (M confirmadas)"**. O parâmetro
`contagem=todas|confirmadas` (padrão `todas`) dos endpoints de indicadores escolhe qual contagem
alimenta os indicadores derivados; a tela guarda a escolha na URL (`?contagem=`). O helper
reutilizável está em `backend/itree/indicadores/contagem.py` (ver o cabeçalho do módulo).
