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
| Podas, recolhimento e supressão (CKAN) | URBFOR | dataset `podas_recolhimento_supressao` | CSV mensal, sem coordenadas | vazia | 2023 (falta setembro) | V parcial | Backlog |
| Doação de mudas e plantio (CKAN) | URBFOR | dataset `doacao-mudas-pf` | XLSX | `cc-by-sa` | 2022-12 | V | Backlog |
| Atendimentos Plano de Arborização (Mapas, id 534) | SEUMA | `/api/v1/geojson?id=534` | GeoJSON, 577 pontos | termos da API | 2021 | V | Backlog |
| Adoção de Praças e Áreas Verdes (Mapas, id 622) | SEUMA | `/api/v1/geojson?id=622` | GeoJSON, 490 pontos; traz nome do adotante (dado pessoal) | termos da API | 2023 | V | Backlog |
| Ocorrências COPDC (CKAN) | SESEC | dataset `ocorrencias-copdc` | CSV agregado | `cc-by` | 2026-06 | A | Não usar (sem queda de árvore) |
| GeoServer, WMS e WFS de Fortaleza | Ipplan | `/geoserver/...` | n/a | n/a | n/a | A (404) | Não usar; preferir GeoJSON da API |
| BDQueimadas, focos diários | INPE, Programa Queimadas | `https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_AAAAMMDD.csv` | CSV, 1 a 4 MB por dia | Não declarada (DP-11); citar "INPE, Programa Queimadas" | Diária; o do dia fica pronto ~21h (BRT), o fechado ~09h | V | Implementada: `FonteAlerta.INPE_FOCOS` |
| BDQueimadas, mensal e 10 min | INPE | `.../focos/csv/mensal/Brasil/` e `.../focos/csv/10min/` | CSV (.zip até 2023), 23 a 137 MB por mês | idem | Mês corrente atualizado | V | Implementada: `ingerir_focos_historico` (filtra o Ceará na leitura) |
| TerraBrasilis WFS | INPE | `https://terrabrasilis.dpi.inpe.br/geoserver/wfs` | WFS 2.0.0, GeoJSON | WMS informa Fees e AccessConstraints "none"; licença formal não declarada | Varia por camada | V | `FonteAlerta.INPE_DETER` (URL de WFS) |
| PRODES Caatinga | INPE | camada `prodes-caatinga-nb:yearly_deforestation` | WFS, EPSG:4674 | idem | Anual | V | Backlog (exige a chave `image_date` em `CHAVES_GEOJSON`) |
| DETER Amazônia e Cerrado | INPE | `deter-amz`, `deter-cerrado-nb` | WFS | idem | Diária | A (não cobre Fortaleza) | Descartada |
| CNUC, tabela e polígonos | MMA | `dados.mma.gov.br`, dataset do CNUC | CSV e Shapefile | `cc-by` | 2026-08 (tabela) | V | Backlog (conferir UCs) |
| Censo 2022, entorno por bairro | IBGE | `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/` | ZIP com CSV, 121 bairros de Fortaleza | Não declarada na listagem | 2025-04 | V | Implementada: importação, indicador na visão geral e camada coroplética no mapa |
| Malha de bairros do Censo 2022, CE | IBGE | `ftp.ibge.gov.br/.../malha_com_atributos/bairros/shp/UF/CE/` | Shapefile em ZIP | Não declarada | 2024-11 | A | Não implementada |
| IBGE API de malhas (servicodados) | IBGE | `servicodados.ibge.gov.br/api/v3/` | JSON | n/a | n/a | I (TLS não completa) | Usar o FTP |
| GBIF | GBIF | `api.gbif.org/v1/` | JSON | Por registro (CC0, CC BY, CC BY-NC) | Contínua | V | Backlog (nomes de espécies) |
| INMET | INMET | `apitempo.inmet.gov.br` | n/a | n/a | n/a | I (host fora da lista da sessão) | Adiada |
| Flora e Funga do Brasil | JBRJ | `floradobrasil.jbrj.gov.br` | n/a | n/a | n/a | I (desafio anti-robô) | Adiada |
| MapBiomas Alerta | MapBiomas | `plataforma.alerta.mapbiomas.org` | GraphQL com token | n/a | n/a | I (host fora da lista da sessão) | Adiada |

Fontes com órgão e licença próprios entram sempre com a citação pedida pela fonte.
Os códigos de regional divergem entre CKAN e Mapas (por exemplo, "SER VI" contra
"Secretaria Executiva Regional 8"); por isso a importação oficial usa só o Mapas,
que traz bairro e regional na mesma fonte.

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
  praça não conta) a até `ALERTAS_FOCOS_RAIO_AREA_VERDE_KM` (padrão 1 km), mesmo fora do
  município, e o alerta mostra "a 0,6 km do Parque Estadual do Cocó".
- Fora do município só entra o foco que cai no buffer do município e está junto de área
  verde. O escopo dos focos (lista, mapa, painel, relatórios e notificações) ganha o mesmo
  buffer; os outros tipos de alerta seguem o escopo exato.
- Depende de `importar_areas_verdes` ter rodado; sem áreas, nenhum foco ganha a marca.

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
