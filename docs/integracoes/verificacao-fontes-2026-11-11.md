# Fontes públicas para o iTree: verificação real

Data da verificação: 2026-11-11 (rede liberada para 13 hosts). Substitui `fontes-publicas.md`.
Amostras baixadas (dados não confiáveis, nada foi executado a partir delas): `(amostras locais, não versionadas)` (subpastas `ckan`, `mapas`, `inpe`, `tb`, `mma`, `ibge`, `gbif`).
Nenhum arquivo do repositório foi alterado.

Legenda de status: **V** = verificado (abri o endpoint e vi o dado); **A** = acessível, mas sem o dado procurado; **I** = indisponível daqui (com o motivo).

## Resumo do que mudou em relação ao relatório anterior

- O CKAN de Fortaleza funciona e tem 639 datasets. Há dados que o relatório anterior dava como inexistentes: praças (GeoJSON, 484 feições), parques e UCs municipais (KMZ), poda/supressão (CSV mensal de 2023), doação e plantio de mudas (XLSX de 2022), Defesa Civil (CSV agregado de 2025).
- O Fortaleza em Mapas tem API REST pública e sem token (546 mapas, GeoJSON). Incluem "Atendimentos Plano de Arborização" (577 pontos) e "Adoção de Praças e Áreas Verdes" (490 pontos). O GeoServer não é exposto: `/geoserver/...` retorna 404 e os WMS passam por um proxy próprio.
- INPE: os diretórios de focos de calor existem (diário, mensal, 10 min). O formato do CSV é compatível com `ler_focos_csv`.
- TerraBrasilis: não há DETER para a Caatinga. Há PRODES-Caatinga (anual, polígonos de cerca de 1 a 2 ha) que cobre Fortaleza.
- IBGE: o dado de arborização do entorno (Censo 2022) está no FTP, já agregado por bairro. Os 121 bairros de Fortaleza têm código IBGE (2304400001 e seguintes). A API `servicodados` está fora do ar daqui.
- INMET (API) e MapBiomas Alerta: o proxy bloqueou a API do INMET (`apitempo.inmet.gov.br` não está na lista liberada) e `portal.inmet.gov.br` não respondeu. MapBiomas Alerta (`plataforma.alerta.mapbiomas.org`) também não estava liberado. Não contornei nada disso.
- Flora e Funga do Brasil: o site tem um desafio anti-robô (Anubis), então não há acesso automatizado. Não contornei.

## 1. Tabela

| # | Fonte | Órgão | URL exata | Formato | Licença declarada | Atualização | Volume | SRC | Status | Uso no iTree |
|---|-------|-------|-----------|---------|-------------------|-------------|--------|-----|--------|--------------|
| 1 | Bairros (CKAN `bairros`) | SEUMA | https://dados.fortaleza.ce.gov.br/dataset/a90409b9-4c2c-4ad0-bcc0-3e24a381c531/resource/08c58502-965e-4f28-bb6e-b08dab04b788/download/bairros_2025.kmz | KMZ (KML), 518 KB | `other-open` (Other (Open)) | metadata_modified 2025-05-22 | 121 polígonos + 121 pontos (centroides); campos id, bairro, regional, area ha, novas_regionais, territorios | KML (WGS 84) | V | `importar_territorios --tipo bairro` |
| 2 | Bairros (Fortaleza em Mapas, id 21) | Ipplan/IPLANFOR | https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=21 (também `/api/download/{geojson,shape,kml,csv}/21`) | GeoJSON, 830 KB | termos de uso da API: uso livre com citação obrigatória da fonte (texto em /dados-abertos/api) | ano_ref 2019, campo `data` 2022-11-13 | 121 MultiPolygon; traz `Código do  IBGE` (2304400077 etc.), regional antiga e atual, território | declara EPSG:4326; original SIRGAS 2000 UTM 24S (31984) | V | `importar_territorios --tipo bairro`, com chave IBGE |
| 3 | Regionais atuais (CKAN `regionais-atuais`) | SEUMA | https://dados.fortaleza.ce.gov.br/dataset/3ceeb6b0-6b4b-43ea-9893-24037448805a/resource/e44c7b96-5ec3-41be-8c6b-085207c89c68/download/regionais-desde-27-12-2019.kmz | KMZ, 167 KB | `other-open` | 2023-05-25 | 12 polígonos + 12 pontos | KML (WGS 84) | V | `importar_territorios --tipo regional` |
| 4 | Regionais (Fortaleza em Mapas, id 17) | Ipplan | https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=17 | GeoJSON, 290 KB | termos da API (citação) | ano_ref 2020 | 12 MultiPolygon (campo `regiao_adm`) | EPSG:4326 | V | alternativa ao #3 |
| 5 | Limite municipal (CKAN `limite-municipal-fortaleza`) | SEFIN | https://dados.fortaleza.ce.gov.br/dataset/a48de214-a033-4d0d-8f39-4ec7dbf9b8f6/resource/a1889ea8-30d9-41e3-8b5c-d1fc66d71d0d/download/limite-municipal-de-fortaleza.csv | CSV, 344 KB (não baixei) | `cc-by` | 2023-10-09 | 1 limite (Lei 16.821/2019) | não verificado | A (metadados vistos, arquivo não aberto) | `importar_territorios --tipo municipio` (ou união dos bairros) |
| 6 | Praças de Fortaleza (CKAN `pracas-e-areas-verdes-pracas-de-fortaleza`) | URBFOR | https://dados.fortaleza.ce.gov.br/dataset/5a746793-0bf7-4f57-980f-394ad76d574b/resource/d9c8adbe-8040-4513-ab0c-1473f88e6376/download/pracas-e-areas-verdes-pracas-de-fortaleza.geojson | GeoJSON, 347 KB | vazia (sem licença no CKAN) | 2024-02-21 (anoref 2019) | 484 MultiPolygon (nome, nome_pop, bairro, cod_bairro, area m2); inclui areninhas | declara EPSG:4326 (original 31984) | V | camada de praças, vínculo com bairro, cadastro de áreas verdes |
| 7 | Parques e Unidades de Conservação (CKAN `parques-uc`) | SEUMA | https://dados.fortaleza.ce.gov.br/dataset/64f379d1-bdba-4169-993c-e9ca407eb02a/resource/a897a8e9-66b2-4730-850c-b590c44bcf0a/download/parques-e-unidades-de-conservacao.kmz | KMZ, 232 KB | `other-open` | 2026-01-14 | 12 nomes (APAs e parques, p.ex. Parque Estadual do Cocó, APA do Rio Maranguapinho, Parque Zoobotânico do Passaré); campos tipo, esfera, legislação, área | KML | V | camada de UCs/parques, cruzamento com alertas |
| 8 | UCs e Parques urbanos (Fortaleza em Mapas, ids 737 e 86) | SEUMA, CEUC/SEMA | https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=737 e `?id=86` | GeoJSON, 218 KB e 151 KB | termos da API (citação) | ano_ref 2023 | 18 UCs (inclui APAs e ARIE) e 25 parques urbanos municipais | EPSG:4326 | V | idem #7, com decreto e área |
| 9 | Podas, recolhimento e supressão (CKAN `podas_recolhimento_supressao`) | URBFOR | p.ex. https://dados.fortaleza.ce.gov.br/dataset/88083447-76b6-4167-877c-ca92ddac69a1/resource/166c0c71-a95e-42ec-b609-35527cf65eee/download/jan2023.csv | CSV por mês (ISO-8859-1, `;`), 19 a 42 KB cada | vazia | 2024-01-19 | 11 meses de 2023 (falta setembro); jan/2023 tem 174 linhas | sem coordenadas | V (parcial) | histórico de manejo por regional/bairro/logradouro; não vira geometria sem geocodificar |
| 10 | Doação de mudas, plantio, podas 2022 (CKAN `doacao-mudas-pf`) | URBFOR | https://dados.fortaleza.ce.gov.br/dataset/f0f8f2e4-1880-47bb-86d1-3e469e627498/resource/7c894d24-cbe7-4683-b7a0-494d40bc642d/download/matriz-doacao-pf2022.xlsx (e 3 outros XLSX no mesmo dataset) | XLSX, 14 a 110 KB | `cc-by-sa` | 2022-12-21 | 4 planilhas (doação PF, PJ, plantio, produtividade de podas) | sem coordenadas | V (abri a PF; só nomes populares, muitos ornamentais) | semente do catálogo de espécies (nomes populares) |
| 11 | Atendimentos Plano de Arborização (Mapas id 534) | SEUMA | https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=534 | GeoJSON, 326 KB | termos da API (citação) | ano 2021 | 577 pontos (endereço, mês, texto "N mudas de Ipê-amarelo...") | EPSG:4326 | V | plantios/doações georreferenciados; espécies por nome popular em texto livre |
| 12 | Adoção de Praças e Áreas Verdes (Mapas id 622) | SEUMA | https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=622 | GeoJSON, 242 KB | termos da API (citação) | ano 2023 | 490 pontos (nome, adotante, regional). Contém nome de adotante (CPF/CNPJ não vistos): tratar como dado pessoal | EPSG:4326 | V | cadastro de áreas adotadas; cuidado com o campo Adotante |
| 13 | Ocorrências COPDC (CKAN `ocorrencias-copdc`) | SESEC/Defesa Civil | https://dados.fortaleza.ce.gov.br/dataset/de0b5257-3163-4176-acf8-27bde37b934c/resource/7543af75-a5c7-40c4-a5a4-35098ea05601/download/ocorrencias_defesa_civil_2025_dados_abertos.csv | CSV, 698 B | `cc-by` | 2026-06-10 | 11 tipologias x 12 meses (total 1.972 em 2025); sem tipo "queda de árvore" | sem coordenadas | A (existe, mas sem o dado útil) | só contexto |
| 14 | Fortaleza em Mapas: API e catálogo | Ipplan | https://mapas.fortaleza.ce.gov.br/api/v1/maps (também /categories, /subcategories, /geojson?id=) | JSON | uso livre com citação ("Fonte: Prefeitura Municipal de Fortaleza - Fortaleza em Mapas (Ipplan Fortaleza). Acesso via API de Dados Abertos.") | contínua (rodapé 2026) | 546 mapas: 293 MultiPolygon, 72 Point, 46 WMS, 29 MAPPFOR, entre outros | EPSG:4326 | V | catálogo único e estável para as camadas acima |
| 15 | GeoServer/WMS/WFS de Fortaleza | Ipplan | `https://mapas.fortaleza.ce.gov.br/geoserver/ows?...` retorna 404. WMS só via proxy `https://mapas.fortaleza.ce.gov.br/api/v1/getImageMap/{workspace:camada}` (imagem) | n/a | n/a | n/a | 46 mapas do tipo WMS (p.ex. Rede de Drenagem, Alagados) | n/a | A (sem WFS/GetCapabilities público) | não usar; preferir GeoJSON da API |
| 16 | BDQueimadas, focos diários | INPE | https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/ (arquivo `focos_diario_br_AAAAMMDD.csv`) | CSV, 1 a 4 MB/dia | não declarada na página nem na listagem (PDFs de governança em `.../focos/documentos/` não lidos) | diário; o do dia aparece ~21h do dia anterior (BRT), o fechado ~09h | 2026-11-09: 12.338 focos no Brasil, 108 no Ceará, 0 em Fortaleza | lat/lon decimais; datum não declarado no arquivo (WGS 84 presumido) | V | `FonteAlerta.INPE_FOCOS` |
| 17 | BDQueimadas, mensal e 10 min | INPE | https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/ e `.../focos/csv/10min/` | CSV (.zip até 2023, .csv de 2024 em diante, 23 a 137 MB/mês); 10 min: 2 a 8 KB | idem | mensal atualizado com defasagem curta (mês corrente 2026-11-10) | jan/2023: 40.978 focos no Brasil, 3.480 no CE, 4 em Fortaleza | idem | V | backfill histórico (arquivos grandes: filtrar por Ceará logo na leitura) |
| 18 | TerraBrasilis WFS/OWS | INPE | https://terrabrasilis.dpi.inpe.br/geoserver/wfs (GetCapabilities: `.../geoserver/ows?service=WFS&request=GetCapabilities`) | WFS 2.0.0 (GML e GeoJSON) | WMS GetCapabilities declara `Fees: none` e `AccessConstraints: none` | varia por camada | 93 feature types | 4674 (SIRGAS 2000) na camada Caatinga | V | alertas/histórico de supressão |
| 19 | PRODES Caatinga (`prodes-caatinga-nb:yearly_deforestation`) | INPE | mesmo WFS; typeNames `prodes-caatinga-nb:yearly_deforestation` | WFS/GeoJSON | idem | anual; último image_date visto 2025-12-19 | 3.239 feições no retângulo ao redor de Fortaleza (inclui municípios vizinhos), 117 de 2024 em diante; cada polígono ~0,01 a 0,02 km² | EPSG:4674 | V (cobre Fortaleza); não é alerta contínuo | histórico anual de supressão, em escala regional |
| 20 | DETER Amazônia/Cerrado | INPE | `deter-amz:deter_amz`, `deter-cerrado-nb:deter_cerrado` | WFS | idem | diário | bbox do Cerrado vai até lon -41,36, Fortaleza está em -38,5 | n/a | A (não cobre Fortaleza; sem DETER-Caatinga na lista) | descartar |
| 21 | CNUC, tabela | MMA | https://dados.mma.gov.br/dataset/44b6dc8a-dc82-4a84-8d95-1b0da7c85dac/resource/72dd3d2d-3cca-4b97-b382-a1c90531e379/download/cnuc_2026_07.csv | CSV (ISO-8859-1, `;`) | `cc-by` (Creative Commons Atribuição, no dataset) | 2026-08-21 | 3.576 UCs; 114 no CE; 11 que abrangem Fortaleza | n/a | V | cruzar UCs por nome/código |
| 22 | CNUC, polígonos | MMA | https://dados.mma.gov.br/dataset/44b6dc8a-dc82-4a84-8d95-1b0da7c85dac/resource/6ba9a557-87e8-4882-acb7-b3e0f0ea192d/download/shp_cnuc_2025_08.zip | Shapefile em ZIP (tamanho não medido) | `cc-by` | arquivo de 2025-09-03; os de 2026_03 e 2026_07 estão no SharePoint do MMA (`mmabr-my.sharepoint.com`, host fora da lista, não testado) | polígonos de todas as UCs do Brasil | não verificado (dicionário em PDF no mesmo dataset) | V (HTTP 200; ZIP não baixado) | camada de UCs; versão mais recente só via SharePoint |
| 23 | IBGE Censo 2022, entorno: faces por bairro | IBGE | https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/Agregados_por_Bairro_csv/Agregados_por_bairros_entorno_faces_BR.zip | ZIP com CSV (ISO-8859-1, `;`), 934 KB. Há também `..._domic%c3%adlios_BR.zip` (1,0 MB) e `..._moradores_BR.zip` | não declarada na listagem do FTP | publicado 2025-04-17 | 16.008 linhas (Brasil); 121 bairros de Fortaleza (CD_BAIRRO 2304400001...). Arborização: V05430 a V05434 | n/a (tabela) | V | indicador de arborização do entorno por bairro |
| 24 | IBGE malha de bairros do Censo 2022, CE | IBGE | https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/bairros/shp/UF/CE/CE_bairros_CD2022.zip | Shapefile em ZIP, 1,0 MB (listagem; não baixei) | não declarada | 2024-11-13 | bairros do CE (não abri) | não verificado | A (arquivo listado, conteúdo não aberto) | alternativa de limites com chave IBGE |
| 25 | IBGE API de malhas e agregados (SIDRA) | IBGE | https://servicodados.ibge.gov.br/api/v3/malhas/municipios/2304400 e `/api/v3/agregados` | n/a | n/a | n/a | n/a | n/a | I: o túnel fecha após 10 s, 517 B enviados e 39 B recebidos (o handshake TLS não completa), em todas as tentativas, com ou sem `--http1.1`. É falha upstream, não política | usar o FTP no lugar |
| 26 | GBIF API | GBIF | https://api.gbif.org/v1/occurrence/search e https://api.gbif.org/v1/species/match | JSON, sem chave para leitura | por registro (CC0, CC BY 4.0, CC BY-NC 4.0) | contínua | retângulo ao redor de Fortaleza, Plantae: 6.452 registros (CC BY-NC 3.198; CC BY 2.934; CC0 320; 3.569 observações humanas, 2.852 espécimes). Só observações humanas CC0 ou CC BY: 466 | WGS 84; incerteza da coordenada quase sempre nula | V | normalização de nomes (`species/match`); ocorrências só como apoio |
| 27 | INMET | INMET | https://apitempo.inmet.gov.br/estacoes/T e https://portal.inmet.gov.br/ | n/a | n/a | n/a | n/a | n/a | I: `apitempo.inmet.gov.br` recebeu 403 do proxy (política: host não liberado); `portal.inmet.gov.br` retornou "Empty reply" (HTTP/1.1 e padrão) | adiar |
| 28 | Flora e Funga do Brasil | JBRJ | https://floradobrasil.jbrj.gov.br/reflora/ | n/a | n/a | n/a | n/a | n/a | I: responde 200 com página "Making sure you're not a bot" (Anubis, prova de trabalho); as consultas redirecionam 302. Não contornei | adiar; ver nota na seção 4 |
| 29 | MapBiomas Alerta | MapBiomas | https://plataforma.alerta.mapbiomas.org/api/v2/graphql | n/a | n/a | n/a | n/a | n/a | I: host não estava na lista liberada, não testado | adiar |

## 2. Detalhes e comandos usados

Convenção: `C(){ curl -sS -m 40 -L "$@"; }`. Em IBGE (`servicodados`) e TerraBrasilis houve resets de conexão intermitentes, então usei `--retry 3 --retry-all-errors`.

### 2.1 CKAN de Fortaleza (https://dados.fortaleza.ce.gov.br)

```
curl -sS "https://dados.fortaleza.ce.gov.br/api/3/action/package_list"                         # 639 datasets
curl -sS "https://dados.fortaleza.ce.gov.br/api/3/action/package_search?q=poda&rows=50&fl=name,title,license_id,metadata_modified"
curl -sS "https://dados.fortaleza.ce.gov.br/api/3/action/package_show?id=bairros"
```

Resultados de `package_search` (`count`): arbor 0, arvore 0, poda 3, praca 7, parque 9, verde 3, bairro 28, regional 14, uc 1, conservacao 2, logradouro 2, zoneamento 0. A busca não pega radicais e perde acentos. Para achar tudo, cruzei com `package_list` por substring.

Datasets relevantes encontrados (nome, licença, `metadata_modified`):

Arborização e manejo
- `podas_recolhimento_supressao`, vazia, 2024-01-19. 11 CSV de 2023.
- `doacao-mudas-pf`, cc-by-sa, 2022-12-21. 4 XLSX de 2022 (doação PF, doação PJ, plantio, podas/supressão/recolhimento).

Áreas verdes, parques e UCs
- `pracas-e-areas-verdes-pracas-de-fortaleza`, vazia, 2024-02-21, GeoJSON.
- `pracas-largos`, other-open, 2024-07-05, KML (647 KB, não abri).
- `pracas-vivas`, vazia, 2024-07-12, GeoJSON (13 KB, não abri).
- `parques_pracas_urbanizadas_fortaleza`, cc-by-sa, 2023-05-24 (modificado 2022-11-16 no recurso), KMZ.
- `parques-uc`, other-open, 2026-01-14, KMZ.
- `parque-coco`, other-open, 2023-05-22, KMZ (parque e zona de amortecimento).
- Propostas de áreas verdes e praças em ZEIS (PIRF), vazia: `pirf-zeis-poco-da-draga-prop-areas-verdes-zeis-poco-da-draga`, `pirf-zeis-poco-da-draga-prop-parcel-areas-verdes-zeis-poco-da-draga`, `pirf-zeis-bom-jardim-prop-parques-zeis-bom-jardim`, `pirf-zeis-lagamar-pracas-zeis-lagamar`, `pirf-zeis-moura-brasil-urbanizacao-de-praca-zeis-moura-brasil`. Escopo restrito a cada ZEIS.

Territórios e cadastro urbano
- `bairros`, other-open, 2025-05-22, KMZ.
- `regionais-atuais`, other-open, 2023-05-25, KMZ.
- `limite-municipal-fortaleza`, cc-by, 2023-10-09, CSV.
- `logradouros-fortaleza` (trechos), cc-by, 2026-06-17 (recurso de 2023-10-09), CSV de 15,6 MB.
- `logradouros`, other-open, 2024-04-05.
- `macrozoneamento`, other-open, 2025-06-27, KMZ (Plano Diretor 2009).
- `loteamentos`, other-open, 2024-04-05, KML de 4 MB.
- `uso-por-lote` e `tipologia-por-lote-fortaleza`, cc-by, 2023-10-09. O CSV de uso é de 148 MB, não baixei.
- `quadras-fiscais-fortaleza`, `fracao-do-lote`, `ouc`, `nucleo_insalubridade`, `recursos-hidricos` (cc-by, 2026-10-21): não abri.

Ocorrências e infraestrutura
- `ocorrencias-copdc`, cc-by, 2026-06-10, CSV agregado.
- `ocorrencias2021afev2024` (Guarda Municipal), GFDL, CSV de 3 KB.
- `pontos_iluminacao_publica`, cc-by-sa, 2022-11-16, XLSX de 16 MB. Pode servir para conflito de poste/copa em outra fase.

Demografia por bairro (chaves de bairro): `demografia-fortaleza`, `idh-fortaleza`, `desenvolvimento_humano_bairro`, `rendimentos-e-domicilios-fortaleza` (cc-by e cc-by-sa, 2022).

Amostras salvas: `fontes/ckan/{bairros_2025.kmz,regionais.kmz,parques-uc.kmz,pracas.geojson,poda_jan2023.csv,copdc.csv,mudas_pf.xlsx}`.

Observações:
- O CKAN não tem inventário arbóreo individual. As podas são texto livre ("PODA de 49 árvores na Rua X - Bairro"), com data, regional (SER), porte e contagens, sem coordenadas.
- A licença `other-open` (Other (Open)) é genérica. Os datasets com licença vazia (praças, podas) precisam de confirmação com a SEUMA/URBFOR antes de redistribuir.
- Os KMZ trazem pontos de centroide e polígonos no mesmo arquivo (bairros: 121 + 121; regionais: 12 + 12). Ao importar, é preciso escolher a camada de polígonos (opção `--camada`).
- Os códigos de regional divergem entre fontes. Exemplo (Aerolândia): CKAN `regional=SER VI`, `novas_regionais=VIII`; no Mapas, "Regional Atual" é escrito como "Secretaria Executiva Regional 8" e "Código da Região" é "VI". Definir uma tabela de equivalência antes de agregar por regional.

### 2.2 Fortaleza em Mapas (https://mapas.fortaleza.ce.gov.br)

```
C https://mapas.fortaleza.ce.gov.br/dados-abertos/api            # documentação (sem token, sem rate limit)
C https://mapas.fortaleza.ce.gov.br/api/v1/maps -o maps.json     # 546 mapas, 192 KB
C "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=21"       # bairros; idem ids 17, 99, 737, 86, 534, 622
C "https://mapas.fortaleza.ce.gov.br/geoserver/ows?service=WFS&request=GetCapabilities"   # 404
```

- Camadas relevantes no catálogo: 21 Bairros (IPLANFOR 2023), 17 Regionais (IPLANFOR 2019), 15 Regionais antigas, 12 Limite administrativo (IPECE 2019), 99 Praças (URBFOR 2019), 86 Parques urbanos municipais (SEUMA 2023), 737 UCs (SEUMA e CEUC/SEMA 2023), 85 Parque Estadual do Cocó, 109 Zona de amortecimento do Cocó, 76 ZIA, 77 ZPA, 78 ZRA (SEUMA 2020), 604 Macrozoneamento urbano (SEUMA 2022), 534 Atendimentos Plano de Arborização (SEUMA 2021), 622 Adoção de Praças e Áreas Verdes (SEUMA 2023), 93 Lagoas, 124 Assentamentos em áreas de risco, 661 Rede de Drenagem (WMS), 669 Alagados (WMS).
- Não existe camada de árvores individuais, de cobertura vegetal ou de NDVI no catálogo.
- O campo de atributos nos GeoJSON tem nomes com espaços duplos (`"Código do  IBGE"`, `"Área  (ha)"`). `--campo-codigo` precisa reproduzir exatamente.
- Os GeoJSON declaram `crs: urn:ogc:def:crs:EPSG::4326` e o campo `epsg_codif` diz EPSG:31984 (a origem). As coordenadas que vi estão em graus (p.ex. -38.559, -3.828), então o declarado (4326) é o real.
- "Atendimentos Plano de Arborização": 577 pontos, todos de 2021. A descrição é texto, p.ex. "Doação e plantio de 02 mudas do projeto Árvore na Minha Calçada. Sendo: 02 mudas de Flamboyant". Extração por regex dá, entre as mais citadas: Ipê-amarelo, Ipê-rosa, Ipê-branco, Pata-de-vaca, Aroeira, Sibipiruna, Flamboyant, Jucá, Ipê-roxo (contagem aproximada: o texto é livre e a regex é simples).
- Termos de uso (copiado do rodapé da documentação): LAI (Lei 12.527/2011); uso, cópia e reprodução livres para soluções civis e pesquisa; citação da fonte obrigatória.

### 2.3 INPE: focos de calor

```
C https://dataserver-coids.inpe.br/queimadas/queimadas/                       # listagem: focos/, area_queimada/, riscofogo_meteorologia/, ...
C https://dataserver-coids.inpe.br/queimadas/queimadas/focos/                 # csv/ documentos/ kml/
C https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/
C -O https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_20261109.csv
C -O https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/focos_mensal_br_202301.zip
```

- `https://queimadas.dgi.inpe.br/queimadas/dados-abertos/` retornou 404. O portal atual é https://data.inpe.br/queimadas/ (abre, mas só tem links para sistemas; não achei declaração de licença no texto).
- Cabeçalho do CSV: `id,lat,lon,data_hora_gmt,satelite,municipio,estado,pais,municipio_id,estado_id,pais_id,numero_dias_sem_chuva,precipitacao,risco_fogo,bioma,frp`. Valores têm espaços à esquerda (`"  -1.036700"`); `float()` aceita. O `id` é um UUID estável por foco. Casa com `ler_focos_csv` (colunas `lat`, `lon`, `data_hora_gmt`, `id`).
- Municípios vêm em maiúsculas e sem consistência de acento (estado `CEARÁ`). Para filtrar Fortaleza, usar `municipio_id == 2304400` e, de reserva, o `Territorio` do município (como a ingestão já faz).
- Os arquivos diários e mensais misturam satélites (p.ex. GOES-19, outros). Não há deduplicação entre satélites aqui: um mesmo fogo pode aparecer mais de uma vez.
- Em jan/2023 houve 4 focos em Fortaleza (bioma Caatinga) contra 3.480 no CE. Esperar poucos alertas por mês. Foco urbano costuma ser queima de lixo ou falso positivo, e a triagem humana prevista continua necessária.
- Os arquivos de 2024 em diante são `.csv` de 23 a 137 MB (Brasil inteiro). Para backfill, baixar em stream e filtrar `estado_id`/`municipio_id` na leitura.
- Nenhum README de licença na listagem. `focos/documentos/` tem dois PDFs de governança de dados (Curadoria-Governanca-Dados-FocosFogoAtivo.pdf e Processo-gera-operacional-dados-FocosFogoAtivo.pdf, 8 páginas cada). Baixei e não li o conteúdo. Pendência: ler esses PDFs ou perguntar ao INPE sobre a licença antes de uso produtivo (DP-11).

### 2.4 TerraBrasilis

```
C "https://terrabrasilis.dpi.inpe.br/geoserver/ows?service=WFS&request=GetCapabilities" -o caps.xml    # 171 KB, 93 FeatureType
C -G https://terrabrasilis.dpi.inpe.br/geoserver/wfs --data-urlencode service=WFS --data-urlencode version=2.0.0 \
  --data-urlencode request=GetFeature --data-urlencode typeNames=prodes-caatinga-nb:yearly_deforestation \
  --data-urlencode resultType=hits --data-urlencode "bbox=-3.95,-38.7,-3.68,-38.40,urn:ogc:def:crs:EPSG::4326"
C -G ... --data-urlencode count=2 --data-urlencode outputFormat=application/json ...
C -G ... --data-urlencode typeNames=prodes-caatinga-nb:municipalities_caatinga_biome ...   # Fortaleza = id 4946, geocodigo 2304400
```

- Ordem de eixos: no WFS 2.0 com EPSG:4326 o bbox é lat,lon (usei `-3.95,-38.7,-3.68,-38.40`).
- Atributos de `yearly_deforestation`: state, path_row, main_class, class_name (d2016...), image_date, year, area_km, satellite (Landsat 8), source "FA-BIOMAS CAATINGA", uuid, publish_year. Anos vistos até 2025.
- A contagem de 3.239 feições é para um retângulo que inclui Caucaia, Maracanaú e outros vizinhos, não só Fortaleza. A contagem exata por município exige interseção espacial com o limite de Fortaleza (CQL `INTERSECTS`/filtro por geometria), que não fiz.
- Conclusão para o iTree: o PRODES-Caatinga é anual e de escala de bioma (Landsat), então vale como histórico e para contexto, não como alerta de supressão de árvore urbana. Não existe DETER para a Caatinga.
- `CHAVES_GEOJSON[INPE_DETER]` em `alertas/fontes.py` só reconhece `view_date`/`date`/`data` como data. PRODES usa `image_date`, então exigiria adicionar essa chave (só uma observação; nada foi alterado).

### 2.5 MMA, CNUC

```
curl -sS "https://dados.mma.gov.br/api/3/action/package_show?id=unidadesdeconservacao"
curl -sSIL "https://dados.mma.gov.br/dataset/44b6dc8a-.../resource/6ba9a557-.../download/shp_cnuc_2025_08.zip"   # 200, Last-Modified 2025-09-03
curl -sS -O ".../resource/72dd3d2d-3cca-4b97-b382-a1c90531e379/download/cnuc_2026_07.csv"
```

- Licença no dataset: `cc-by`. Última modificação: 2026-08-21.
- UCs que abrangem Fortaleza na tabela de 2026-07 (11): Parque Estadual Marinho da Pedra da Risca do Meio; ARIE do Sítio Curió; ARIE do Cambeba; APA da Lagoa da Precabura; APA da Lagoa da Maraponga (municipal); APA do Rio Maranguapinho; APA do Estuário do Rio Ceará; APA do Rio Pacoti; Parque Estadual do Cocó; Parque Natural Municipal das Dunas da Sabiaguaba (municipal). Há ainda um falso positivo por nome (APA da Fortaleza de Santa Cruz, em Niterói-RJ). Portanto, ao contrário do que o relatório anterior supunha, o CNUC inclui UCs municipais de Fortaleza (APA da Maraponga e Sabiaguaba), embora não tenha como garantir que todas estejam lá.
- Os shapefiles mais novos (2026_03 e 2026_07) estão publicados via SharePoint do MMA, fora da lista de hosts liberados. O shapefile mais novo hospedado em `dados.mma.gov.br` é o de 2025_08.
- As camadas municipais (#7 e #8) são mais completas para Fortaleza (parques urbanos, ARIEs) e mais recentes que o shapefile do CNUC acessível.

### 2.6 IBGE

```
# API (não funciona daqui)
curl -sS -m 30 "https://servicodados.ibge.gov.br/api/v3/malhas/municipios/2304400?formato=application/vnd.geo+json&qualidade=minima"   # curl: (35) Recv failure: Connection reset by peer (todas as tentativas)
# FTP (funciona)
C https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/
C -O ".../Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/Agregados_por_Bairro_csv/Agregados_por_bairros_entorno_faces_BR.zip"
C -O ".../Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/dicionarios_de_dados_entorno.zip"
```

- No FTP, o entorno de domicílios está disponível por setor, bairro, distrito, subdistrito e município, em `csv/` e `xlsx/`. Há também a versão "Dados_percentuais..." (`br_setores_entorno_cd2022.gpkg`, 346 MB, e CSV, 69 MB; não baixei).
- Arborização na tabela "faces", conforme o dicionário: V05430 sem árvores; V05431 1 a 2; V05432 3 a 4; V05433 5 ou mais; V05434 saltado. V05400 é o total de faces do setor.
- Somando os 121 bairros de Fortaleza (faces de quadra recenseadas): total 90.153; sem árvores 44.190 (49,0%); 1 a 2 árvores 18.254; 3 a 4 árvores 8.974; 5 ou mais 18.200; saltado 535. A soma fecha com o total. Este número é por faces de quadra, não é a mesma métrica dos "40% dos domicílios sem árvores no entorno" citada na imprensa.
- Os nomes dos bairros do IBGE batem com a lista dos 121 bairros (ex.: Aldeota 2304400002; o GeoJSON do Mapas traz `Código do  IBGE` no mesmo padrão), então a junção por código é viável. Não comparei os 121 nomes um a um.
- Não abri a malha de bairros do CE (CE_bairros_CD2022.zip, 1,0 MB). A listagem mostra a pasta `setores/shp/UF/` mas não conferi o arquivo do CE nela.
- Licença: o FTP não declara. Verificar a política de dados abertos do IBGE antes de redistribuir.

### 2.7 GBIF

```
curl -sS "https://api.gbif.org/v1/species/match?name=Handroanthus%20serratifolius&kingdom=Plantae"
curl -sS -G "https://api.gbif.org/v1/occurrence/search" \
  --data-urlencode "geometry=POLYGON((-38.65 -3.90,-38.40 -3.90,-38.40 -3.69,-38.65 -3.69,-38.65 -3.90))" \
  --data-urlencode kingdomKey=6 --data-urlencode limit=0 --data-urlencode facet=license --data-urlencode facet=basisOfRecord
```

- `species/match` retornou `ACCEPTED`, confiança 100, família Bignoniaceae para Handroanthus serratifolius; Caesalpinia pulcherrima também casou (EXACT, confiança 98).
- O retângulo inclui parte do mar e de municípios vizinhos; não é o limite de Fortaleza. Os registros são de qualquer planta (ervas, arbustos), sem filtro de porte arbóreo. Amostra: observações do iNaturalist (licença CC BY-NC).
- Licença por registro: usar `license=CC0_1_0&license=CC_BY_4_0` evita o CC BY-NC (restrição de uso comercial).
- `geocode/gadm` retornou 404 (endpoint não existe nesta API), então o recorte por município precisa ser por polígono do próprio `Territorio`.

### 2.8 INMET e Flora e Funga do Brasil (bloqueios)

```
curl -sS https://apitempo.inmet.gov.br/estacoes/T      # curl: (56) CONNECT tunnel failed, response 403
curl -sS https://portal.inmet.gov.br/                  # curl: (52) Empty reply from server
curl -sS https://floradobrasil.jbrj.gov.br/reflora/    # 200, mas o HTML é o desafio Anubis ("Making sure you're not a bot!")
```

- O status do proxy (`$HTTPS_PROXY/__agentproxy/status`) registrou `connect_rejected ... 403` para `apitempo.inmet.gov.br:443`. Se o iTree precisa da API, pedir a liberação desse host (e confirmar se exige token; não deu para saber).
- Flora e Funga: o desafio anti-robô é uma decisão do site. Para uso programático, o caminho é o pacote de dados (Darwin Core) publicado pelo JBRJ, ou pedir acesso; não localizei a URL do IPT.

## 3. Lacunas que continuam

- Não existe inventário arbóreo geográfico aberto de Fortaleza em nenhuma fonte aberta que vi. O mais perto são os pontos de plantio/doação de 2021 (577) e os CSV de poda sem coordenadas.
- Solicitações 156 de poda/remoção e quedas de árvore da Defesa Civil: não achei. O COPDC só tem totais por tipologia.
- Sem acesso: API INMET, API IBGE `servicodados` (SIDRA, malhas), MapBiomas Alerta, Flora e Funga.
- Não abri: logradouros (15,6 MB), uso por lote (148 MB), malha IBGE do CE, shapefile CNUC, PDFs do INPE.
- Licença de INPE (focos e TerraBrasilis na parte WFS além do campo "none" do WMS) e IBGE (FTP) não está declarada nas páginas que vi.

## 4. Recomendação priorizada (até 6 integrações)

### 1. Bairros e regionais oficiais (Fortaleza em Mapas id 21 e 17; fallback CKAN KMZ)
- Valor: o mapa e todas as agregações (inventário, alertas, relatórios por regional) passam a usar limites oficiais, com chave IBGE para cruzar com o Censo.
- Encaixe: `importar_territorios` aceita o GeoJSON diretamente. Exemplo: `manage.py importar_territorios "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=21" --tipo bairro --campo-nome Nome --campo-codigo "Código do  IBGE" --fonte "Fortaleza em Mapas (Ipplan)" --fonte-url https://mapas.fortaleza.ce.gov.br/mapa/21/bairros-de-fortaleza --licenca "Uso livre com citação" --data-referencia 2022-11-13 --municipio Fortaleza`. O argumento `arquivo` aceita `/vsicurl/...`, então convém baixar antes ou usar esse prefixo.
- Esforço: baixo (meio dia, incluindo a tabela de equivalência de regionais).
- Riscos: (a) códigos de regional divergentes entre CKAN e Mapas (seção 2.1); (b) a fonte diz ano_ref 2019/2020 em campos distintos; escolher uma `data-referencia` consciente; (c) citação da fonte obrigatória.

### 2. Focos de calor INPE (diário), com backfill mensal opcional
- Valor: alerta de fogo próximo a UCs e parques (Cocó, Sabiaguaba, Maraponga), feito automático.
- Encaixe: `FonteAlerta.INPE_FOCOS` e `ler_focos_csv` já casam com o formato real (colunas, UUID, espaços). Fonte: `.../focos/csv/diario/Brasil/focos_diario_br_AAAAMMDD.csv`, via `baixar()` e `ingerir()` (já filtra pelo município). Rodar o arquivo do dia anterior fechado às ~09h e o do dia corrente às ~21h.
- Esforço: baixo. O backfill de 2024 em diante exige leitura em stream de arquivos de até 137 MB.
- Riscos: licença não declarada (DP-11: registrar a citação "INPE/Programa Queimadas" e consultar o INPE); poucos focos em Fortaleza e muitos falsos positivos urbanos; a mesma queima pode aparecer em vários satélites. Considerar um buffer (p.ex. 1 km) em torno de UCs e parques, não só o limite do município.

### 3. Praças, parques e UCs municipais (camada de áreas verdes)
- Valor: o usuário passa a ver onde estão as 484 praças, os parques urbanos e as UCs, e o sistema pode cruzar árvore com área verde, alertas com UC e priorizar manutenção.
- Encaixe: hoje `TipoTerritorio` só tem município, regional e bairro; é preciso um modelo/tipo de "área verde" (praça, parque, UC) com a mesma lógica de fonte e data que `importar_territorios` usa. As fontes: Mapas ids 99 (praças), 86 (parques), 737 (UCs), ou os KMZ/GeoJSON do CKAN (`parques-uc` atualizado em 2026-01-14 é o mais recente). CNUC (CSV cc-by) serve para conferir código e esfera.
- Esforço: médio (modelo novo, importador, conciliação de nomes entre SEUMA e CNUC).
- Riscos: o dataset de praças não tem licença no CKAN; as praças misturam areninhas e outros equipamentos; o campo `Adotante` do mapa 622 é dado pessoal. O shapefile do CNUC acessível é de 2025_08.

### 4. Indicador de arborização do entorno (IBGE Censo 2022, por bairro)
- Valor: uma visão geral para decidir onde plantar primeiro: 49,0% das faces de quadra de Fortaleza estão sem árvores, por bairro.
- Encaixe: nova fonte para o módulo `indicadores` (`registrar_indicadores`), indexada pelo código IBGE do bairro (casa com a integração 1). Baixar o ZIP de bairro (934 KB) uma vez; dado estático.
- Esforço: baixo a médio (ler CSV ISO-8859-1, mapear V05430 a V05434, documentar a definição do indicador).
- Riscos: dado único de 2022, não é inventário; unidade é "face de quadra" (não domicílio); é um levantamento por observação; licença não declarada no FTP; a API `servicodados` está inacessível daqui, então depender do FTP.

### 5. Catálogo de espécies: nomes do Plano de Arborização e normalização via GBIF
- Valor: um catálogo inicial com as espécies realmente plantadas em Fortaleza (Ipê-amarelo, Ipê-rosa, Pata-de-vaca, Aroeira, Sibipiruna, Flamboyant, Jucá...) e nomes científicos validados.
- Encaixe: `Especie` usa `nome_cientifico` único. Semente: nomes populares do mapa 534 e das planilhas de doação 2022 (CKAN `doacao-mudas-pf`, cc-by-sa), convertidos para nome científico com revisão humana, depois validados por `https://api.gbif.org/v1/species/match` (sem chave) e complementados pelo `atualizar_referencias_especies` que já existe.
- Esforço: médio (a conversão nome popular para científico é manual; a API é simples).
- Riscos: licença cc-by-sa das planilhas (compartilhamento pela mesma licença); os nomes populares são ambíguos (Ipê-amarelo cobre mais de uma espécie); o status nativa/exótica não vem do GBIF e o Flora e Funga do Brasil está bloqueado por anti-robô, então `nativa_brasil` continua manual. Não importar ocorrências do GBIF para o inventário (não são árvores urbanas inventariadas, e metade é CC BY-NC).

### 6. Histórico de manejo (podas, supressões e recolhimentos da URBFOR, 2023) e mudas plantadas (2021 e 2022)
- Valor: série de referência para o painel de visão geral (volume de poda por regional/mês) e base para estimar demanda; os 577 plantios de 2021 dão pontos reais para testar o fluxo de importação.
- Encaixe: o lote de importação do inventário (`inventario/importacao.py`, `LoteImportacao`) pode receber os pontos de 2021 (mapa 534) como `OrigemRegistro` de fonte externa. Os CSV de poda não têm coordenadas, só logradouro e bairro em texto, então entram como indicador por bairro/regional, não como ocorrência geográfica.
- Esforço: médio (parsing de texto livre, ISO-8859-1, linhas multi-serviço; sem geocodificação).
- Riscos: licença vazia nas podas; dados de 2023 apenas (sem 2024 e 2025 no CKAN; setembro/2023 ausente); texto livre propenso a erro. Para ocorrências reais e recentes, continua sendo preciso um pedido formal (LAI) à URBFOR e à Central 156.

### Adiados
- INMET (vento e chuva): depende da liberação de `apitempo.inmet.gov.br`; confirmar token e qual estação cobre Fortaleza.
- TerraBrasilis/PRODES-Caatinga: só histórico anual, escala de bioma. Não há DETER para Caatinga; MapBiomas Alerta não foi testado.
