# Fontes públicas verificadas

Verificação real feita em 2026-11-11, abrindo cada endpoint e olhando o dado. Ela
substitui as fontes "a verificar" da [T-05](../specs/transversal/05-integracoes.md).
O relatório completo (comandos, volumes e achados por fonte) está em
[verificacao-fontes-2026-11-11.md](verificacao-fontes-2026-11-11.md). Esta página guarda
o resumo e o modo de usar o que já está implementado.

Regras que valem para todas as fontes (ver [ciclo de melhoria](../melhoria/README.md)):
nenhum número ambiental sem fonte e método; toda fonte mostra órgão, licença ou
termos, data de referência e data de ingestão. Licença não declarada é registrada
como tal, nunca presumida ([DP-11](../decisoes/pendentes.md#dp-11)).

Legenda de status: **V** verificado (dado visto); **A** acessível, sem o dado
procurado ou não aberto; **I** indisponível da rede da verificação.

## Tabela

"Mapas" é o Fortaleza em Mapas (`https://mapas.fortaleza.ce.gov.br`), com API sem
token e sem limite de taxa. Na coluna Integração, "Implementada" quer dizer que há
comando ou ingestão no código.

| Fonte | Órgão | URL | Formato | Licença ou termos | Atualização | Status | Integração |
| ----- | ----- | --- | ------- | ----------------- | ----------- | ------ | ---------- |
| Regionais (Mapas, id 17) | Ipplan | `/api/v1/geojson?id=17` | GeoJSON, 12 MultiPolygon | Uso livre com citação da fonte (termos da API) | ano_ref 2020 | V | Implementada: `importar_limites_fortaleza` |
| Bairros (Mapas, id 21) | Ipplan | `/api/v1/geojson?id=21` | GeoJSON, 121 MultiPolygon, com "Código do  IBGE" | idem | campo `data` 2022-11-13 | V | Implementada: `importar_limites_fortaleza` |
| Bairros e regionais (CKAN) | SEUMA | `dados.fortaleza.ce.gov.br`, datasets `bairros` e `regionais-atuais` | KMZ | `other-open` | 2025-05 e 2023-05 | V | `importar_territorios` (alternativa) |
| Limite municipal (CKAN) | SEFIN | dataset `limite-municipal-fortaleza` | CSV | `cc-by` | 2023-10 | A | Não implementada |
| Praças (CKAN) | URBFOR | dataset `pracas-e-areas-verdes-pracas-de-fortaleza` | GeoJSON, 484 feições | vazia no CKAN | 2024-02 | V | Backlog |
| Parques e UCs (CKAN; Mapas ids 737 e 86) | SEUMA, CEUC/SEMA | CKAN `parques-uc`; Mapas `?id=737`, `?id=86` | KMZ; GeoJSON | `other-open`; termos da API | 2026-01; ano_ref 2023 | V | Backlog (falta tipo "área verde") |
| Podas, recolhimento e supressão (CKAN) | URBFOR | dataset `podas_recolhimento_supressao` | CSV mensal, sem coordenadas | vazia | 2023 (falta setembro) | V | Implementada (parte segura): `importar_manejo_urbfor`, agregado por bairro e mês |
| Pontos de iluminação pública (CKAN) | SEINF | dataset `pontos_iluminacao_publica`, recurso `relatoriodoparquedeiluminacaopublica.xlsx` (16 MB) | XLSX, aba `CREXPORT`, 182.514 linhas (uma por lâmpada) em 149.603 pontos de serviço, 149.511 com coordenada | `cc-by-sa` | 2022-11-16 | V (verificado em 2026-11-15) | Implementada: `importar_iluminacao_publica` (mensal, MVT, conflito com árvores) |
| Doação de mudas (CKAN) | URBFOR | dataset `doacao-mudas-pf`, recursos `matriz-doacao-pf2022.xlsx` e `matriz-doacao-pj2022.xlsx` | XLSX em fichas, sem local | `cc-by-sa` | 2022-12 | V | Implementada: `importar_doacao_mudas` (1.334 linhas de espécie, 22.687 mudas); só em Análises, sem requerente nem endereço |
| Plantio de mudas (CKAN) | URBFOR | dataset `doacao-mudas-pf`, recurso `matriz-plantio2022.xlsx` | XLSX em fichas, sem coordenadas | `cc-by-sa` | 2022-12 | V | Implementada: `importar_plantio_urbfor` (42 plantios, 19.675 mudas, 3 com bairro); só em Análises, sem geocodificar nem criar árvore |
| Atendimentos Plano de Arborização (Mapas, id 534) | SEUMA | `/api/v1/geojson?id=534` | GeoJSON, 577 pontos | termos da API | 2021 | V | Implementada como conector, inativo até o administrador ativar: `criar_conectores_exemplo` (camada de referência) |
| Adoção de Praças e Áreas Verdes (Mapas, id 622) | SEUMA | `/api/v1/geojson?id=622` | GeoJSON, 490 pontos; traz nome do adotante (dado pessoal), descartado na leitura | termos da API | 2023 | V | Implementada: `importar_adocao_pracas` (490 adoções, 194 ligadas a praça, 154 praças adotadas); mensal |
| Ilhas de calor urbano de superfície (UrbVerde) | IAU-USP | `https://urbverde.iau.usp.br/geoserver/urbverde/wms` e `/ows` (WCS 2.0.1), camada `raster_temperatura_icus_nacional_2025` | Raster Float32 de 30 m (WMS PNG e WCS GeoTIFF), °C; sem medição = -9999 | Termos de Uso da UrbVerde: uso acadêmico, educacional, público e de pesquisa, **vedado o uso comercial sem autorização**, "todos os direitos reservados", citar a fonte. GeoServer: Fees e AccessConstraints "none". **Sem licença aberta** | Anual (2025; tendência 2014 a 2025) | V | Camada WMS no mapa (`ilha_calor=1`). Valor por bairro: `importar_ilha_calor_urbverde`, que só grava com `URBVERDE_GRAVAR_VALORES` |
| Ocorrências COPDC (CKAN) | SESEC | dataset `ocorrencias-copdc` | CSV agregado | `cc-by` | 2026-06 | A | Não usar (sem queda de árvore) |
| GeoServer, WMS e WFS de Fortaleza | Ipplan | `/geoserver/...` | n/a | n/a | n/a | A (404) | Não usar; preferir GeoJSON da API |
| BDQueimadas, focos diários | INPE, Programa Queimadas | `https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_AAAAMMDD.csv` | CSV, 1 a 4 MB por dia | Não declarada (DP-11); citar "INPE, Programa Queimadas" | Diária; o do dia fica pronto ~21h (BRT), o fechado ~09h | V | Implementada: `FonteAlerta.INPE_FOCOS` |
| BDQueimadas, mensal e 10 min | INPE | `.../focos/csv/mensal/Brasil/` e `.../focos/csv/10min/` | CSV (.zip até 2023), 23 a 137 MB por mês | idem | Mês corrente atualizado | V | Implementada: `ingerir_focos_historico` (filtra o Ceará na leitura) |
| TerraBrasilis WFS | INPE | `https://terrabrasilis.dpi.inpe.br/geoserver/wfs` | WFS 2.0.0, GeoJSON | WMS informa Fees e AccessConstraints "none"; licença formal não declarada | Varia por camada | V | `FonteAlerta.INPE_DETER` (URL de WFS) |
| PRODES Caatinga | INPE | camada `prodes-caatinga-nb:yearly_deforestation` | WFS, GeoJSON (saída em EPSG:4326 pedida por `srsName`) | idem | Anual | V | Implementada: `ingerir_prodes_caatinga` (camada de referência, não alerta) |
| DETER Amazônia e Cerrado | INPE | `deter-amz`, `deter-cerrado-nb` | WFS | idem | Diária | A (não cobre Fortaleza) | Descartada |
| CNUC, tabela e polígonos | MMA | `dados.mma.gov.br`, dataset do CNUC | CSV e Shapefile | `cc-by` | 2026-08 (tabela) | V | Backlog (conferir UCs) |
| Censo 2022, entorno por bairro | IBGE | `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/` | ZIP com CSV, 121 bairros de Fortaleza | Não declarada na listagem | 2025-04 | V | Implementada: importação, indicador na visão geral e camada coroplética no mapa |
| Malha de bairros do Censo 2022, CE | IBGE | `ftp.ibge.gov.br/.../malha_com_atributos/bairros/shp/UF/CE/` | Shapefile em ZIP | Não declarada | 2024-11 | A | Não implementada |
| IBGE API de malhas (servicodados) | IBGE | `servicodados.ibge.gov.br/api/v3/` | JSON | n/a | n/a | I (TLS não completa) | Usar o FTP |
| GBIF | GBIF | `api.gbif.org/v1/` | JSON | Por registro (CC0, CC BY, CC BY-NC) | Contínua | V | Implementada como fonte alternativa de imagem das espécies (`atualizar_referencias_especies`); nomes de espécies, backlog |
| INMET | INMET | `apitempo.inmet.gov.br` | n/a | n/a | n/a | I (host fora da lista da sessão) | Adiada |
| Flora e Funga do Brasil | JBRJ | `floradobrasil.jbrj.gov.br` | n/a | n/a | n/a | I (desafio anti-robô) | Adiada |
| MapBiomas Alerta | MapBiomas | `plataforma.alerta.mapbiomas.org` | GraphQL com token | n/a | n/a | I (host fora da lista da sessão) | Adiada |

Fontes com órgão e licença próprios entram sempre com a citação pedida pela fonte.
Os códigos de regional divergem entre CKAN e Mapas (por exemplo, "SER VI" contra
"Secretaria Executiva Regional 8"); por isso a importação oficial usa só o Mapas,
que traz bairro e regional na mesma fonte. A [tabela de equivalência](#equivalência-das-regionais-ckan--fortaleza-em-mapas)
abaixo traduz uma fonte na outra.

## Como usar o que está implementado

### Limites oficiais: regionais e bairros de Fortaleza

```bash
cd backend
uv run python manage.py importar_limites_fortaleza
```

- Lê as 12 regionais (id 17) e os 121 bairros (id 21) da API do Mapas e grava
  `Territorio` (tipo `regional` e `bairro`), com a hierarquia município > regional > bairro.
  O município é criado pela união das regionais se ainda não existir
  (`--municipio`, padrão "Fortaleza").
- Código da regional: `id` da fonte. Código do bairro: campo "Código do  IBGE" (o nome
  real tem dois espaços). A regional de cada bairro vem de "Regional Atual".
- Fonte gravada: "Prefeitura Municipal de Fortaleza - Fortaleza em Mapas (Ipplan
  Fortaleza). Acesso via API de Dados Abertos.", com a URL da página do mapa, a licença
  "Uso livre com citação da fonte (termos da API)" e a data de referência da fonte
  (bairros: campo `data`; regionais: só há `ano_ref`, então 1º de janeiro do ano, com
  `metadados.data_referencia_precisao = "ano"`). A data de ingestão é gravada à parte.
- Idempotente: reexecutar atualiza geometria e proveniência pelo código, sem duplicar.
- Sem rede: `--arquivo-regionais` e `--arquivo-bairros` aceitam os GeoJSON baixados.
  A contagem esperada (12 e 121) é conferida; `--permitir-contagem-diferente` a ignora.
- Se já existirem bairros importados por `importar_territorios` com outro código
  (por exemplo, do CKAN), a importação oficial cria registros novos pelo código do IBGE.
  Limpe os antigos antes, ou use só uma das fontes.

### Ilha de calor (UrbVerde, IAU-USP)

Verificada em 2026-11-20 (GetCapabilities, GetFeatureInfo, WCS, GetLegendGraphic e o código do site).

- **O que mede.** `raster_temperatura_icus_nacional_2025` ("ICUS", ilha de calor urbano **de superfície**,
  a camada `heat_island_national` do site) é, em cada pixel de 30 m, a **diferença em °C entre a
  temperatura de superfície do pixel e a mediana do município**, no ano (composição anual Landsat 8 e 9,
  Coleção 2 Nível 2), sobre a mancha urbana (setores censitários de 2022 de alta e baixa densidade de
  edificações, mais 200 m). Legenda de -5 °C a +5 °C. Não é temperatura do ar nem absoluta: só se
  compara dentro do mesmo município. Sem medição: -9999 (o título do estilo cita também "dado ausente
  100"). `raster_temperatura_icu_nacional_2025` ("ICU") é a mesma grandeza em outra versão;
  `raster_temperatura_tendencia_icus_nacional_2014_2025` é a tendência (°C por ano, de -0,3 a +0,3).
  O site usa a ICUS, e foi essa a escolhida.
- **WMS no MapLibre.** Serve: `GetMap` em EPSG:3857 com `{bbox-epsg-3857}`, PNG transparente, CORS
  `Access-Control-Allow-Origin: *` (o mesmo pedido que o site faz). A legenda vem do `GetLegendGraphic`.
- **Valor por bairro.** O WCS 2.0.1 entrega o GeoTIFF recortado (Fortaleza: 900 × 792 pixels, ~4 MB). O
  valor do bairro é a média dos pixels medidos cujo centro cai no polígono; a cobertura (pixels medidos
  ÷ pixels do bairro) é guardada. Conferido contra o `GetFeatureInfo` do próprio GeoServer em 12 pontos
  de Aldeota: os 12 pixels coincidem. A API de cartões (`api.urbverde.com.br/v1/cards/pp/*?city=`)
  respondeu "no years found" para Fortaleza e não é usada.
- **Licença.** Termos em `https://urbverde.iau.usp.br/termos`. Não é licença aberta: "todos os direitos
  reservados", uso público e acadêmico, sem fins comerciais, citação obrigatória ("Plataforma UrbVerde –
  USP"), alterações com registro de autoria e metodologia. Por isso a camada do mapa (só visualização,
  com atribuição) está liberada e o **valor por bairro só é gravado com `URBVERDE_GRAVAR_VALORES`**, depois
  que a prefeitura confirmar o uso com a USP. Sem isso, o cartão da ficha diz "Veja a camada no mapa".
- **Uso.** `manage.py importar_ilha_calor_urbverde [--bairros Aldeota Centro] [--arquivo x.tif]`. Reimportação
  anual pelo beat (`reimportar-ilha-calor`, fevereiro).

### Iluminação pública (SEINF)

```bash
cd backend
uv run python manage.py importar_iluminacao_publica                    # baixa o XLSX oficial
uv run python manage.py importar_iluminacao_publica --arquivo rel.xlsx # arquivo local
```

- Fonte: dataset `pontos_iluminacao_publica` do CKAN de Fortaleza (SEINF), licença `cc-by-sa`,
  conjunto atualizado em 2022-11-16 (a data de referência gravada; `--data-referencia` a troca).
  Citação: "Prefeitura de Fortaleza, SEINF, dados abertos (CC BY-SA)".
- Colunas lidas (aba `CREXPORT`): `CÓDIGO_DE_PONTO_DE_SERVIÇO`, `PONTO_DE_SERVIÇO_X`,
  `PONTE_DE_SERVIÇO_Y` (assim, com "PONTE"), `REGIÃO`, `DESIGNAÇÃO_LOGRADOURO`,
  `DESIGNAÇÃO_BAIRRO`, `POSTE`, `LÂMPADA`, `POTÊNCIA_NOMINAL`, `POTÊNCIA_CONSUMIDA` e
  `FAMILIA_LÂMPADA`. Os textos vêm com espaços à direita; são aparados.
- **SRC:** as coordenadas estão em SIRGAS 2000 / UTM 24S (EPSG:31984) e são convertidas para
  4326. Conferido: o ponto 904705 (554469,75; 9586805) cai na Av. Heráclito Graça, Aldeota.
- Uma linha por lâmpada: as linhas do mesmo código viram **um ponto**, com as lâmpadas em
  `lampadas` (tipo, potências e família). O texto do poste ("CONCRETO DUPLO T DE 5 A 10 M") dá o
  tipo e a faixa de altura (5 e 10); "ATÉ 5 M" dá só o máximo; sem faixa (ex.: "SEM POSTE"), as
  alturas ficam vazias.
- **Descartes**, contados e relatados na saída e no lote: ponto sem coordenada (célula em
  branco), com coordenada ilegível ou fora da faixa do SRC e fora do município (limite oficial
  com 50 m de folga, porque 964 dos 1.711 pontos fora do polígono estão a até 50 m dele; sem
  limite importado, vale uma caixa folgada de Fortaleza). O arquivo é tratado como dado não
  confiável: tipos e faixas são validados, o download só aceita HTTPS do portal de dados abertos
  e tem limite de 64 MB.
- A importação **substitui** todos os pontos numa só transação, em lotes (`bulk_create`); se algo
  falhar, os pontos anteriores ficam. Cada execução grava um `LoteIluminacao` (fonte, URL,
  licença, data de referência, ingestão, hash do arquivo e contagens), que aparece em
  `mapa/camadas` e em "Fontes dos dados" como as áreas verdes. A tarefa mensal
  (`reimportar_iluminacao_publica`, dia 3) roda o mesmo comando.
- Resultado com o arquivo oficial (2026-11-15, limites oficiais de Fortaleza no banco): 182.514
  linhas; **148.760 pontos importados**; descartados 92 sem coordenada, 4 com coordenada ilegível e
  747 fora do município; cerca de 70 s no total.
- Uso: camada "Iluminação pública" do mapa (MVT, zoom 15 em diante) e a lista "Árvores próximas à
  iluminação", com o raio **provisório** de 3 m (`ILUMINACAO_RAIO_CONFLITO_M`; decisão da URBFOR e
  da SEINF, [DP-22](../decisoes/pendentes.md#dp-22)). Os pontos são de contexto: não alteram nem
  substituem o inventário de árvores.

### Equivalência das regionais (CKAN e Fortaleza em Mapas)

Verificada com o dado real em 2026-11-12 (12 polígonos e 121 bairros do CKAN contra os mapas
17 e 21) e codificada em `backend/itree/territorio/regionais.py`. O **número** é o "SER n" do
Mapas, o que o iTree grava como código da regional. O **nome do polígono** no CKAN é o mesmo
número em romano. O **código** (campo `Regional` do KMZ do CKAN, `novas_regionais` dos bairros
do CKAN e "Código da  Região" dos bairros do Mapas) é outra numeração e não coincide com o
número.

| Número (Mapas "SER n") | Nome do polígono no CKAN | Código (CKAN `Regional` e `novas_regionais`; Mapas "Código da  Região") |
| --- | --- | --- |
| SER 1 | I | II |
| SER 2 | II | III |
| SER 3 | III | IV |
| SER 4 | IV | V |
| SER 5 | V | XII |
| SER 6 | VI | VIII |
| SER 7 | VII | VII |
| SER 8 | VIII | VI |
| SER 9 | IX | IX |
| SER 10 | X | X |
| SER 11 | XI | XI |
| SER 12 | XII | I |

- Provas: a área dos polígonos (SER 8 tem 35,55 km² no Mapas e 35,53 km² no polígono `VIII`
  do CKAN) e os 119 bairros que casam pelo nome nas duas fontes, todos com o código esperado.
- O campo `regional` dos bairros do CKAN ("SER I" a "SER VI" e "SERCE") e "Regional Antiga"
  do Mapas são a divisão anterior a 2019 e não têm correspondência 1 a 1 com as 12 atuais; não
  servem para agregar.
- A coluna "Regional" dos CSVs de poda da URBFOR usa o número ("SER 01", "SER 8").
- `importar_limites_fortaleza` usa a tabela: grava o nome e o código do CKAN em
  `metadados` de cada regional (`ckan_nome`, `ckan_codigo`), grava `codigo_regiao_ckan` em cada
  bairro e confere esse código contra a regional atual. Se a regional atual faltar, a regional
  sai do código da região; se os dois divergirem, vale a regional atual e o relatório avisa.
  Com o dado real não há divergência.

### Manejo de árvores da URBFOR (podas, recolhimento e supressão de 2023)

```bash
cd backend
uv run python manage.py importar_manejo_urbfor                       # baixa os CSVs pelo CKAN
uv run python manage.py importar_manejo_urbfor --arquivo jan2023.csv --arquivo fev2023.csv
```

- Fonte: dataset `podas_recolhimento_supressao` do CKAN de Fortaleza (URBFOR), 11 planilhas
  mensais de 2023 (falta setembro; não há 2024 em diante). Licença vazia no CKAN: gravada como
  "não declarada (DP-10)" e mostrada ao usuário como "não declarada (em definição pela prefeitura)".
- Exige o município e os bairros cadastrados (`importar_limites_fortaleza`).
- **Não geocodifica e não cria árvore, ocorrência nem tarefa.** Os plantios (doação de mudas) não
  são importados.
- Leitura (ISO-8859-1, `;`): linha de serviço é a que começa com data, nos formatos reais
  ("04/01/2023", "19/05/23", "0412/2023", "27/1//2023"); as linhas TOTAL e as colunas soltas são
  ignoradas. O mês é o do título do arquivo ("JANEIRO (2023)"), não o da data da linha (quatro
  linhas de junho trazem data de julho). As quantidades são as colunas Poda, Supressão e
  Recolhimento; a soma de cada planilha bate com a linha TOTAL dela (conferido nas 10 que a têm).
- Bairro: lido do fim de cada trecho da descrição ("... - Bairro", "..., Bairro." ou "3161- Bairro")
  e comparado com os bairros cadastrados, sem acento nem caixa, com a
  [tabela de aliases](#aliases-de-bairro-do-manejo-da-urbfor) abaixo. Os trechos se separam por
  quebra de linha **seguida de uma ação** (Poda, Supressão, Recolhimento) ou por três espaços ou mais;
  uma quebra de linha no meio do nome ("Luciano \nCavalcante") é só a largura da célula e não separa.
  "MUTIRÃO" no lugar do bairro ("Parangaba - MUTIRÃO") vale o que vem antes. O serviço só vai a um
  bairro se todos os trechos apontam para ele. "Praia do Futuro" e "Conjunto Ceará" servem a dois
  bairros (I e II, **na mesma regional**, então a coluna Regional não desempata) e ficam
  **ambíguos**; o que não se reconhece fica **sem bairro identificado**. Esses dois totais ficam no
  município, para a soma nunca perder árvore.
- Gravação: `IndicadorTerritorialExterno`, um por bairro, mês e ação
  (`manejo_urbfor_poda_202301`, `..._supressao_...`, `..._recolhimento_...`; `manejo_urbfor_sem_bairro_...`
  no município), em árvores, com fonte, URL, licença, data de referência (último dia do mês) e
  data de ingestão. Só há linha onde houve registro: bairro que não aparece não tem manejo
  identificado, o que não é o mesmo que zero. Reimportar um mês troca as linhas do mês.
- Aparece em Análises e relatórios, na análise "Manejo registrado pela URBFOR (2023)": total por
  bairro com poda, supressão e recolhimento, "Sem bairro identificado" (só no escopo municipal),
  fonte e ressalvas. Não depende do período escolhido e não entra nos indicadores da visão geral.
- Validação com o dado real (2026-11-12, 11 arquivos): 20.305 árvores (poda 18.056, supressão
  1.636 e recolhimento 613). Com a primeira leitura: bairro identificado 87,3%; ambíguo 6,2%; sem
  bairro 6,5%. **Depois dos aliases e da leitura das quebras de linha (F-06, 2026-11-13): bairro
  identificado 91,4% (18.568 árvores); ambíguo 6,2% (1.260); sem bairro 2,3% (477).** Nenhum
  serviço que já tinha bairro mudou de bairro. 182 árvores vêm de serviços cuja "SER n" difere da
  regional do bairro cadastrado (mantido o bairro). A coluna "Regional" usa a numeração "SER n" do
  Fortaleza em Mapas (ver a equivalência das regionais).
- O que sobra sem bairro (2,3%) é, em ordem de peso: serviços sem bairro no texto (306), "Sítio São
  João" (49, localidade que não é um dos 121 bairros), só número de imóvel ("n° 330", "n° 65"),
  esquinas e praças sem bairro. Não entram na tabela: seria chute.
- Análise e gráficos: a análise "Manejo registrado pela URBFOR (2023)" traz a evolução mensal em
  dois gráficos (podas; supressão e recolhimento), porque as ordens de grandeza diferem e a paleta
  validada tem duas cores. **Setembro**, que a fonte não publicou, aparece como "sem dado na fonte"
  (faixa hachurada, linha interrompida, nunca zero) e vem em `serie_mensal.sem_dado` na API.

#### Aliases de bairro do manejo da URBFOR

Tabela `APELIDOS` em `backend/itree/indicadores/manejo_urbfor.py`. A chave é o texto sem acento,
caixa nem pontuação. O valor é o nome oficial do bairro no Fortaleza em Mapas (mapa 21) e o teste
confere que existe entre os 121. Critério: só entra equivalência clara (abreviação, nome parcial ou
erro de digitação que não casa com outro bairro). Ambiguidade e o que não é bairro ficam de fora.

| Grafia da URBFOR | Bairro oficial | Tipo |
| --- | --- | --- |
| Jose Walter, Pref. Jose Walter | Prefeito José Walter | nome parcial |
| Luciano Cavalcante | Engenheiro Luciano Cavalcante | nome parcial |
| São João do Tauape, Sã João do Tauape | Tauape | nome parcial |
| Manoel Dias Branco | Manuel Dias Branco | grafia |
| Vicente Pizon | Vicente Pinzón | grafia |
| Manuel Sátiro, Vila Manuel/Manoel Sátiro | Manoel Sátiro | grafia |
| Jóquei Club, Jóquei | Jóquei Clube | nome parcial |
| Lourdes | De Lourdes | nome parcial |
| Bom Sucesso | Bonsucesso | grafia |
| Palmeiras | Conjunto Palmeiras | nome parcial |
| Airton Sena | Planalto Ayrton Senna | grafia |
| Parque Irmãos, Parque Dois Irmão | Parque Dois Irmãos | nome parcial |
| Monstese | Montese | digitação |
| Fáima | Fátima | digitação |
| Aldetoa, Aldeora | Aldeota | digitação |
| Mondumbi, Mondunbim, Mundubim | Mondubim | digitação |
| Canidezinho, Canindenzinho | Canindezinho | digitação |
| Árvaro Weyne | Álvaro Weyne | digitação |
| Vla Peri | Vila Peri | digitação |
| Papupina | Paupina | digitação |
| Panamericando | Panamericano | digitação |
| Sabiaguababa | Sabiaguaba | digitação |
| Edsom Queiroz | Edson Queiroz | digitação |
| Lagoa Redona | Lagoa Redonda | digitação |
| Padre Adrade | Padre Andrade | digitação |
| Hennrique Jorge | Henrique Jorge | digitação |
| Cristo Redentos | Cristo Redentor | digitação |
| Dionísio T orres, Cid. dos funcionários | Dionísio Torres, Cidade dos Funcionários | quebra de linha ou abreviação |
| Lagoa Sapiranga | Sapiranga / Coité | nome parcial |

Para acrescentar um alias: confirme no dado real que o texto aparece e só pode ser aquele bairro,
inclua a linha em `APELIDOS` e um caso no teste (`tests/test_manejo_urbfor.py`, com a linha real em
`tests/dados/urbfor_aliases_trecho.csv`). O comando lista os textos não reconhecidos que mais pesam.
O download dos CSVs repete até 4 vezes quando o portal responde 502 ou 504, o que aconteceu na
validação.

### Doação de mudas e plantio da URBFOR (planilhas de 2022)

```bash
cd backend
uv run python manage.py importar_doacao_mudas      # baixa as planilhas PF e PJ do CKAN
uv run python manage.py importar_doacao_mudas --arquivo-pf pf.xlsx --arquivo-pj pj.xlsx
uv run python manage.py importar_plantio_urbfor    # baixa a planilha de plantio (exige os bairros)
uv run python manage.py importar_plantio_urbfor --arquivo plantio.xlsx
```

- Fonte: dataset `doacao-mudas-pf` do CKAN de Fortaleza (URBFOR), licença `cc-by-sa`, recursos
  modificados em 2022-12-21 (a data de referência gravada). As três planilhas XLSX são pilhas de
  **fichas** de atendimento (a leitura está em `itree/indicadores/fichas_urbfor.py`): título do mês
  ("JANEIRO - 2022", "Junho- 2022", "JUlHO- 2022"), uma ficha por atendimento
  (`REQUERENTE:`, `DATA:`, `ENDEREÇO:`, e `LOCAL:` no plantio), a linha de cabeçalho repetida, a espécie
  na coluna E e a quantidade na F, a categoria nas colunas A a D, a linha `TOTAL` e, ao lado,
  tabelas soltas de resumo (colunas H a M, com `#REF!`), que são ignoradas. Em algumas fichas o
  total vem sem o rótulo ou repetido.
- **Doação** (`DoacaoMudas`, uma linha por espécie de cada ficha): ano, mês, data (vazia se a ficha
  não tem), tipo de beneficiário (PF ou PJ), categoria (ornamental, nativa ou frutífera, palmeira,
  medicinal), espécie como escrita na planilha, espécie do catálogo quando o nome casa, sem
  ambiguidade, pelo nome científico ou popular (o mesmo resolvedor da importação de inventário),
  quantidade, e a proveniência. A categoria vem da coluna da linha; sem ela, da lista auxiliar da
  própria planilha (abas "Ornamentais", "Nativas e Frutíferas", "Palmeiras" e "Medicinal"); sem
  nenhuma das duas fica vazia ("Categoria não informada"). Ficha com total e sem espécie vira a
  linha "Espécie não informada". **Requerente e endereço nunca são gravados**: na doação a pessoa
  física escreve o próprio nome, e o teste confere que nenhum deles chega ao banco. Idempotente por
  tipo e ano.
- **Plantio** (`RegistroPlantio`): data (ou o período, quando a ficha tem "02/02/2022 - 28/02/2022"), endereço
  e local em texto, bairro, motivo de não ter bairro, espécies e quantidades em JSON, total de mudas
  e total declarado. O bairro sai **só do texto do endereço**, pela regra do manejo da URBFOR (o
  bairro é o fim do trecho, "Rua X - Bairro Y"; [aliases](#aliases-de-bairro-do-manejo-da-urbfor);
  nome que serve a dois bairros fica ambíguo) e, sem separador, vale um endereço que seja inteiro o
  nome de um bairro. Sem bairro, o motivo fica gravado: sem endereço (só o local), endereço sem
  bairro no texto (inclui só número de imóvel), ambíguo ou não reconhecido. **Não geocodifica e não
  cria árvore** (DP-18); a planilha não tem coordenadas e as mudas são, em grande parte, ornamentais
  pequenas ("mini lacre", "lutiela").
- Onde aparece: só em Análises, com fonte e ano: "Mudas doadas por espécie (URBFOR, 2022)" (as 15
  mais doadas e o restante em "Outras"; grafias iguais sem acento, caixa ou espaço são somadas),
  "Mudas doadas por categoria (URBFOR, 2022)" e "Plantios por bairro (URBFOR, 2022)", com a parcela
  "Sem bairro identificado" declarada e visível só com escopo municipal. As duas de doação são do
  município inteiro e exigem escopo municipal (a doação não tem local). Não entram no mapa nem
  dependem do período escolhido. Não há ficha do bairro no web, então o total de mudas plantadas
  por bairro fica só na análise.
- Validação com o dado real (2026-11-15), contra os 121 bairros reais:
  - **Doação PF:** 73 fichas com espécie (2 sem espécie, ignoradas), 207 linhas, **1.588 mudas**;
    a soma bate com o total informado em cada ficha. **Doação PJ:** 196 fichas, 1.127 linhas,
    **21.099 mudas**, também com a soma igual ao total de cada ficha. Total: 22.687 mudas;
    12.886 ornamentais, 2.068 nativas ou frutíferas, 1.869 medicinais, 376 palmeiras e 5.488 sem
    categoria. O catálogo de espécies do banco de teste estava vazio, então nenhuma linha casou
    com ele nessa rodada.
  - **Plantio:** 42 fichas com espécie (1 vazia, de setembro, ignorada), **19.675 mudas** (o total
    informado soma 17.357, porque uma ficha de 2.318 mudas não traz total). **3 plantios com bairro
    (7,1%, 1.705 mudas):** Floresta, Granja Portugal e Guararapes; 24 sem endereço (só o local, por
    exemplo "Parque Guararapes") e 15 com endereço sem bairro no texto.
  - Reimportar não duplica (a segunda execução troca as mesmas linhas).

### Adoção de praças (mapa 622)

```bash
cd backend
uv run python manage.py importar_adocao_pracas                       # pela API
uv run python manage.py importar_adocao_pracas --arquivo adocao.geojson
```

- Fonte: Fortaleza em Mapas, mapa 622 "Adoção de Praças e Áreas Verdes" (SEUMA), 490 pontos,
  `ano_ref` 2023, termos da API. Campos reais: `id`, `fid`, `Nome` (da praça), `Adotante`,
  `Regional`, `x` e `y` (UTM), `Fonte`, `ano_ref` e `epsg_codif`. **Não há** situação, data do termo
  nem contato: toda linha é uma adoção, e o ano é o de referência do mapa, não o do termo.
- **O nome do adotante é descartado na leitura** (`itree/areas_verdes/adocao.py`): cada registro é
  montado só com os campos permitidos (identificador, nome da praça, regional, ponto, ano de
  referência) e a categoria do adotante, e o texto do adotante é usado apenas para decidir a
  categoria, sem ser guardado, devolvido, mostrado pelo comando nem registrado em log. A categoria é
  "empresa" (LTDA, S.A., ME, EPP, EIRELI, construtora, incorporadora...), "associação ou condomínio" ou
  "não classificado" (pessoa física, nome de fantasia e tudo sem marca clara: nunca se afirma que o
  adotante é uma pessoa). Os testes conferem, com adotantes sintéticos e um termo-sentinela, que
  nada chega ao banco, à API, à saída do comando nem ao log, e que o modelo não tem campo para isso.
- Cada ponto é ligado à **praça** (`AreaVerde` do tipo praça) mais próxima a até **50 m**, pela
  distância geodésica até o contorno (`ST_Distance` sobre `geography`); sem praça nesse raio, o ponto
  fica sem vínculo, com o motivo. Parque e unidade de conservação não recebem vínculo. A distância fica
  gravada, e o raio é uma escolha desta implementação, não da fonte: ponto a 49 m de uma praça com
  outro nome ainda é ligado a ela.
- Aparece na API de áreas verdes (`adotada`, `adocoes`, `adocao_tipos`, `adocao_ano_referencia`, e o
  filtro `?adotada=1`), na ficha da área verde no mapa ("Adotada", com a quantidade, a categoria e o ano
  de referência) e como filtro "Só praças adotadas" na camada de áreas verdes. Os pontos sem vínculo
  ficam registrados, mas não aparecem no mapa.
- Reimportação mensal (tarefa `reimportar_adocao_pracas`, dia 2 às 04:30, meia hora depois das áreas
  verdes). Idempotente pelo `id` da fonte; o que saiu da fonte é removido; fonte vazia ou falha da API
  não altera nada.
- Validação com o dado real (2026-11-15), com as 484 praças reais (mapa 99): 490 na fonte, 490 criadas,
  0 ignoradas; **194 ligadas a uma praça a até 50 m (154 praças adotadas) e 296 sem vínculo**. Dos 296,
  a praça mais próxima está a 50 a 100 m em 37, a 100 a 200 m em 74, a 200 a 500 m em 119, a 500 m a 2 km em
  65 e a mais de 2 km em 1; boa
  parte são canteiros centrais e calçadas ("Canteiro central na Av. ...") que a camada de praças não
  tem. Categoria do adotante: 67 empresas, 21 associações ou condomínios e 402 não classificados. A
  segunda execução deu 0 criadas e 490 atualizadas.

### Focos de calor diários do INPE

Configure a coleta automática em `ALERTAS_FONTES` (variável de ambiente, JSON):

```json
{"inpe_focos": "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_{data}.csv"}
```

- `{data}` vira AAAAMMDD do dia anterior no fuso de Fortaleza (o arquivo fechado de
  ontem); `{data_hoje}` vira o dia corrente, cujo arquivo parcial aparece ~21h. Sem
  marcador, a URL é usada como está.
- O `beat` roda a cada `ALERTAS_INTERVALO_HORAS` (padrão 6). O arquivo é idempotente
  pelo UUID do foco, então reexecuções não duplicam.
- Só ficam os focos que intersectam o município cadastrado (o arquivo cobre o Brasil
  inteiro). Zero focos em Fortaleza é o resultado normal na maioria dos dias; foco
  urbano costuma ser queima de lixo ou falso positivo, e a triagem humana continua
  obrigatória (W-08).
- Cada ingestão grava o órgão ("INPE, Programa Queimadas"), a licença ("Não declarada
  pela fonte (DP-11). Citar: INPE, Programa Queimadas.") e a data de referência (a
  detecção mais recente do arquivo). A tela de integrações mostra os três.
- Citação: "INPE, Programa Queimadas".
- Envio manual: a tela de integrações aceita o CSV baixado.

### Backfill mensal dos focos do INPE

```bash
cd backend
uv run python manage.py ingerir_focos_historico --desde 2023-01 --ate 2023-03
```

- Baixa `focos_mensal_br_AAAAMM` (`.zip` até 2023, `.csv` a partir de 2024; se a extensão
  esperada der 404, tenta a outra), lê em fluxo e guarda só o estado de `--estado`
  (padrão Ceará, sem distinguir acento nem caixa) **antes** de montar os registros. O
  `.zip` vai para um arquivo temporário em disco; nada do Brasil inteiro fica na memória.
- Passa pelo mesmo `ingerir` do dia a dia: idempotente pelo id do foco, com os mesmos
  filtros (município ou junto de área verde) e a mesma proveniência. Não envia notificações.
- Um mês que falha (404, rede) não interrompe os demais; o comando termina com erro listando
  os meses, e cada mês fica registrado em Integrações.
- Os focos entram como "Alerta detectado" e aparecem nas pendências de triagem (ver AV-06).

### Focos junto de áreas verdes

- Ao ingerir um foco, o sistema grava o parque ou a unidade de conservação (`areas_verdes`;
  praça não conta) a até o raio do tipo da área, mesmo fora do município, e o alerta mostra
  "a 0,6 km do Parque Estadual do Cocó".
- A distância é geodésica **até o contorno** da área (`ST_Distance` sobre `geography`), não até
  o centro: um foco a 200 m da borda de um parque grande está a 200 m, e dentro da área está a 0.
- Raio por tipo: `ALERTAS_FOCOS_RAIO_PARQUE_KM` e `ALERTAS_FOCOS_RAIO_UC_KM`. Sem eles, vale
  `ALERTAS_FOCOS_RAIO_AREA_VERDE_KM` (padrão 1 km). O buffer do município e do escopo usa o maior
  dos raios.
- Na lista de alertas, o filtro "Junto de área verde" (`?junto_area_verde=1`, ou `parque` e
  `unidade_conservacao` na API) mostra só os focos com a marca.
- Fora do município só entra o foco que cai no buffer do município e está junto de área
  verde. O escopo dos focos (lista, mapa, painel, relatórios e notificações) ganha o mesmo
  buffer; os outros tipos de alerta seguem o escopo exato.
- Depende de `importar_areas_verdes` ter rodado; sem áreas, nenhum foco ganha a marca.

### PRODES Caatinga: supressão anual como camada de referência

```bash
cd backend
uv run python manage.py ingerir_prodes_caatinga                 # baixa do TerraBrasilis
uv run python manage.py ingerir_prodes_caatinga --buffer-km 5   # outro buffer
uv run python manage.py ingerir_prodes_caatinga --arquivo prodes.geojson
```

- Fonte: WFS do TerraBrasilis, camada `prodes-caatinga-nb:yearly_deforestation` (INPE). Não há
  DETER para a Caatinga; o PRODES cobre Fortaleza em **escala regional** (polígonos de cerca de
  1 ha ou mais, o menor do dado real tem 1,0 ha) e **leitura anual**.
- O comando pede só o retângulo do município cadastrado ampliado por um buffer (padrão
  `PRODES_CAATINGA_BUFFER_KM`, 2 km; `--buffer-km` troca) e guarda os polígonos que intersectam o
  município ampliado em `SupressaoAnual`. O servidor do INPE responde 503 quando está sobrecarregado:
  o download repete até 4 vezes. Exige `importar_limites_fortaleza`.
- Lê a data da chave `image_date` (data da imagem do mapeamento; ver `CHAVES_GEOJSON` em
  `itree/alertas/fontes.py`) e o ano de `year`. A área vem de `area_km` (convertida para ha).
- **Não cria alerta, pendência de triagem nem notificação.** É contexto histórico. A licença é
  gravada como "não declarada" (DP-11), com a citação "INPE, TerraBrasilis, PRODES Caatinga".
- Idempotente pelo `uuid` da fonte. A API `GET /api/v1/mapa/supressao-anual` devolve o GeoJSON no
  escopo do usuário (com o mesmo buffer) e a proveniência: fonte, licença, escala e intervalo de anos.
- No mapa: camada "Supressão anual (PRODES Caatinga)" no grupo "Ambientais — sinais externos",
  **desligada por padrão**. A cor segue o ano (claro, mais antigo; escuro, mais recente), e a legenda
  traz o intervalo de anos e "≥ ~1 ha, anual, escala regional".
- Validação com o dado real (2026-11-13, limites reais de Fortaleza, buffer de 2 km): 1.990
  polígonos no retângulo, 1.304 dentro do recorte (2004 a 2025, 16 anos mapeados; 2004 tem 230
  polígonos e 1.546 ha, 2025 tem 21 e 151 ha), 0 inválidos; a segunda execução deu 0 novos e 1.304
  atualizados, sem nenhum alerta criado. O teste usa 8 feições literais da resposta real
  (`backend/tests/dados/prodes_caatinga_yearly_deforestation_trecho.geojson`).

### Praças: subtipo (areninha, calçadão, rotatória)

A camada de praças (mapa 99) mistura equipamentos e não tem campo próprio para
distingui-los. `importar_areas_verdes` grava `AreaVerde.subtipo` (só nas praças) pela
**primeira palavra do nome oficial**, sem distinguir caixa nem acento
(`itree/areas_verdes/subtipos.py`):

| Nome começa com | Subtipo |
| --- | --- |
| "Areninha" (ou o erro de digitação "Arenina") | areninha |
| "Calçadão" | calçadão |
| "Rotatória" | rotatória |
| "Sem Denominação Oficial" | sem denominação oficial |
| qualquer outro | praça (inclui "Largo", "Área Verde", "Jardim", "Canteiro", "Polo" e "Triângulo") |

- O apelido (`nome_pop`) não entra na regra.
- Conferido nas 484 feições reais: 432 praças, 19 areninhas (18 "Areninha" e a
  "Arenina Thauzer Parente"; a verificação contou 18), 5 calçadões, 1 rotatória e
  27 sem denominação. O teste usa os nomes reais (`tests/dados/fortaleza_em_mapas_99_praca_nomes.json`).
- A API de áreas verdes traz `subtipo` e `subtipo_rotulo` e aceita `?subtipo=`; o mapa
  de camadas informa a quantidade de cada subtipo. No mapa, o seletor "Subtipo das praças"
  esconde as praças dos outros subtipos (parques e unidades de conservação seguem à vista), e o
  painel da área mostra o subtipo.
- A migração preenche o subtipo das praças já importadas.

### Unidades de conservação: conferência com o CNUC

```bash
cd backend
uv run python manage.py conferir_ucs_cnuc                     # baixa o CSV do CNUC (MMA)
uv run python manage.py conferir_ucs_cnuc --arquivo cnuc.csv  # CSV local (ISO-8859-1, ";")
uv run python manage.py conferir_ucs_cnuc --simular           # só o relatório
```

- Fonte: MMA, Cadastro Nacional de Unidades de Conservação (`cnuc_2026_07.csv`), licença
  CC BY. Só as unidades da UF pedida entram (`--uf`, padrão CE), porque há nomes parecidos
  em outros estados (a APA da Fortaleza de Santa Cruz é do Rio de Janeiro).
- Casa pelo **nome normalizado**: sem acento nem caixa, sem pontuação nem artigos, com APA
  e ARIE por extenso e sem o sufixo de zona ("- ZA", "- ZP", "- ZC"). Nome que casa com
  mais de uma unidade do CNUC não é gravado e aparece como ambíguo.
- Quem casa recebe `codigo_cnuc` (coluna "Código UC"), `esfera_cnuc` e `cnuc_conferido_em`.
  A esfera da prefeitura (`esfera`) não é trocada: a divergência vai para o relatório. A
  reimportação mensal das áreas verdes preserva esses campos; reexecutar o comando refaz o
  cruzamento (quem deixa de casar perde o código).
- O relatório lista as unidades casadas (com a quantidade de feições), as unidades do mapa
  **sem correspondente no CNUC**, as ambíguas, as divergências de esfera e as unidades do
  CNUC no município que o mapa não traz.
- Na exibição, a API de áreas verdes traz `feicoes_da_unidade` e `area_total_da_unidade_m2`
  nas unidades de conservação: as feições da mesma unidade (mesmo código do CNUC ou, sem ele,
  mesmo nome normalizado) são contadas juntas, dentro do escopo do usuário. O painel da área
  mostra o código do CNUC e "Esta unidade aparece em 4 feições no mapa; área somada: ...".
- Validação com o dado real (2026-11-12): 18 feições do mapa 737 e 114 unidades do CNUC no
  Ceará. Casaram 15 feições de 10 unidades (a APA do Estuário do Rio Ceará, com 4 feições, e o
  Parque Estadual Marinho da Pedra da Risca do Meio, com 3 zonas). Sem correspondente: APA da
  Sabiaguaba, ARIE Prof. Abreu Matos e ARIE da Matinha do Pici (unidades municipais que o
  CNUC não lista). Nenhuma divergência de esfera.

### Conectores de fontes externas

Capacidade genérica para buscar uma fonte por endereço, sem escolher o sistema municipal
([DP-12](../decisoes/pendentes.md#dp-12) segue aberta) e sem tratar nada como inventário
([DP-18](../decisoes/pendentes.md#dp-18) segue aberta). Requisitos: RF-INT-008 a RF-INT-013
([T-05](../specs/transversal/05-integracoes.md)); tela: RF-ADM-007; mapa: RF-MAPA-033.

- Tipos: `geojson_url`, `wfs`, `arcgis_rest` (paginação por `resultOffset`) e `ckan`.
- Destinos: camada de referência no mapa ou lote de importação **em prévia** (a confirmação é
  sempre humana).
- Segurança: só HTTPS e só hosts de `ITREE_CONECTORES_HOSTS_PERMITIDOS`
  (padrão `mapas.fortaleza.ce.gov.br,dados.fortaleza.ce.gov.br`). Limites por variável de
  ambiente: `ITREE_CONECTORES_TIMEOUT` (30 s), `ITREE_CONECTORES_MAX_BYTES` (50 MB),
  `ITREE_CONECTORES_MAX_FEICOES` (20.000) e `ITREE_CONECTORES_MAX_PAGINAS` (50). Para incluir
  uma fonte nova, acrescente o host à lista no servidor; a tela não consegue ampliá-la.
- O `id` de uma feição do Fortaleza em Mapas (`vw_...fid--<hash>`) muda a cada leitura: o
  conector usa a propriedade `id` (`campo_id`), que é estável.
- Exemplo: `manage.py criar_conectores_exemplo` cadastra, **inativo**, "Atendimentos do Plano de
  Arborização" (Mapas, id 534), camada de referência, mensal.
- O conector CKAN aceita também recurso XLSX (depois do GeoJSON e do CSV): os pontos saem das
  colunas de latitude e longitude (nomes comuns, ou `coluna_latitude` e `coluna_longitude` nos
  parâmetros), com a leitura segura da importação de inventário (limites de tamanho, de membros e
  de tamanho descompactado). O tipo "GeoJSON por endereço" segue só GeoJSON.
- Fontes ainda sem conector pronto: os demais itens da tabela seguem no backlog. A adoção de
  praças (camada 622) tem comando próprio, que descarta o nome do adotante
  ([abaixo](#adoção-de-praças-mapa-622)).

#### Validação do conector contra o dado real (2026-11-14)

Sincronização real do conector 534 (camada de referência): 577 feições recebidas, 577 novas,
0 inválidas. A segunda execução trouxe 577 recebidas, 0 novas, 0 atualizadas e 0 removidas, o
que confirma o id estável. As geometrias vêm com coordenada Z igual a 0, descartada na leitura.
O texto de `description` traz `<br>`, tratado como quebra de linha no popup.

### Validação contra o dado real (2026-11-11)

- `importar_limites_fortaleza` na API real: 12 regionais e 121 bairros criados; segunda
  execução, 0 criados e 133 atualizados; os 121 bairros ficam ligados a uma regional.
- Arquivo `focos_diario_br_20261110.csv` (1,28 MB): 8.276 focos no Brasil, 0 em
  Fortaleza. Dois focos reais de janeiro de 2023 (arquivo mensal), contra os limites
  reais, caíram em Centro e Passaré; o foco de "Fortaleza dos Nogueiras" (MA) ficou
  de fora, porque o filtro é geográfico e não pelo nome.
- Os testes (`backend/tests/test_fontes_publicas.py`) usam trechos reais pequenos em
  `backend/tests/dados/` e não acessam a rede.

### Validação do backfill (2026-11-11)

- `ingerir_focos_historico --desde 2023-01 --ate 2023-01` contra o INPE real (zip de 1,9 MB,
  40.979 focos no Brasil): 3.480 no Ceará, 4 em Fortaleza, 3.476 fora do município. A segunda
  execução deu 0 novos e 4 já existentes. Os 4 focos ficaram junto de parque ou unidade de
  conservação (de 7 m a 672 m).

## Pendências

- [DP-10](../decisoes/pendentes.md#dp-10): confirmar a Ipplan como responsável pelos limites oficiais.
- [DP-11](../decisoes/pendentes.md#dp-11): ler os PDFs de governança do INPE ou perguntar ao órgão a licença
  dos focos antes do uso produtivo.

### Imagens das espécies: Wikimedia Commons e GBIF

Verificadas em 2026-11-14 (o host alcança `api.gbif.org`; o Wikidata respondeu 429 em
parte das chamadas, o que motivou a nova tentativa com espera crescente).

- **Prioridade:** Commons (P18 do Wikidata, miniatura de 960 px pela API) e, sem P18, sem
  licença ou com o Wikidata indisponível, GBIF.
- **GBIF:** `species/match?name=…&kingdom=Plantae` (aceito só se `matchType=EXACT` e
  nome canônico igual; ou a chave P846 do Wikidata) e depois
  `occurrence/search?taxonKey=…&mediaType=StillImage&limit=300`. O `/species/{key}/media`
  veio vazio para a espécie testada e não é usado. A ocorrência traz `license` (URL),
  `rightsHolder`, `creator`, `references` e, em `media`, o `identifier` da imagem.
- **Licenças aceitas:** CC0, CC BY, CC BY-SA e CC BY-NC (esta só com a licença sempre
  exibida; ver RN-INV-022 da [spec do inventário](../specs/web/03-inventario.md)).
  CC BY-ND, CC BY-NC-SA, CC BY-NC-ND, "todos os direitos reservados" e licença ausente
  descartam a imagem, assim como a falta de autor quando a licença exige atribuição.
- **Atribuição gravada:** `imagem_autor`, `imagem_licenca`, `imagem_licenca_url`,
  `imagem_pagina_url` e `imagem_fonte` ("Wikimedia Commons" ou "GBIF — publicador").
- **Miniatura:** o GBIF só informa o original; para o iNaturalist usa-se o tamanho
  `medium` (125 KB contra 1,3 MB), e a cópia local, quando o armazenamento está
  configurado, reduz qualquer origem a 960 px.
