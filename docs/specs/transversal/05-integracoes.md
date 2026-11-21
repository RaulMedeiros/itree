# T-05 — Integrações e dados públicos

**Status:** Rascunho · Fontes verificadas em 2026-11-11, resumo e modo de uso em
[fontes públicas](../../integracoes/fontes-publicas.md). Licença e responsável de
cada fonte seguem pendentes antes da integração produtiva
([DP-10](../../decisoes/pendentes.md#dp-10), [DP-11](../../decisoes/pendentes.md#dp-11)).

## 1. Fontes candidatas

Situação em 2026-11-11 (**V** verificada, **I** indisponível da rede da verificação;
detalhes em [fontes públicas](../../integracoes/fontes-publicas.md)):

| Fonte                    | Uso                                       | Acesso                            | Fase web | Verificação |
| ------------------------ | ----------------------------------------- | --------------------------------- | -------- | ----------- |
| Fortaleza Dados Abertos  | Limites, bairros, praças, vias            | API CKAN (639 conjuntos)          | F0/F1    | V |
| Fortaleza em Mapas       | Camadas e cartografia municipal           | API REST de GeoJSON, sem token; GeoServer não exposto | F1 | V; regionais e bairros **implementados** (`importar_limites_fortaleza`) |
| Fortaleza em Bairros     | Contexto territorial por bairro           | Portal municipal                  | F2       | Não verificada |
| INPE — BDQueimadas       | Focos de calor                            | CSV diário, mensal e de 10 min    | F3       | V; focos diários **implementados** (`{data}` em `ALERTAS_FONTES`); licença não declarada |
| INPE — TerraBrasilis     | Supressão / alteração de vegetação        | OGC WFS/OWS; PRODES Caatinga anual; sem DETER para Fortaleza | F3 | V |
| MapBiomas Alerta         | Alertas de supressão e laudos             | API GraphQL com token             | F3       | I (host fora da lista da sessão) |
| MapBiomas Cobertura e Uso | Série histórica de cobertura             | Downloads / ferramentas GIS       | F3+      | Não verificada |
| SEUMA / Fortaleza Online | Licenciamento ambiental                   | Verificar campos espaciais        | F3       | Não verificada |
| IBGE — Censo 2022        | Arborização do entorno por bairro         | FTP (CSV); API `servicodados` fora do ar | F2 | V |
| MMA — CNUC               | Unidades de conservação                   | CSV e Shapefile (`cc-by`)         | F2       | V |
| GBIF                     | Nomes e ocorrências de espécies           | API JSON                          | F2       | V |
| INMET, Flora e Funga     | Clima; nomenclatura botânica              | n/a                               | F3+      | I (host bloqueado; anti-robô) |

Endereços de referência: ver §7.2 da [especificação consolidada](../../referencia/especificacao-consolidada-v1.md).

## 2. Requisitos de ingestão

- **RF-INT-001** — Cada integração registra: fonte, URL/endpoint, licença,
  frequência, última execução, último sucesso, erro, registros ingeridos.
- **RF-INT-002** — Ingestão idempotente por (fonte, identificador externo).
  Implementado para alertas (UUID do foco) e para limites territoriais (código da fonte).
- **RF-INT-003** — Normalização de geometria e SRC, mantendo o original.
- **RF-INT-004** — Datas da fonte (detecção/publicação) e data de ingestão
  armazenadas separadamente. Cada ingestão de alertas guarda também o órgão, a
  licença (ou "não declarada") e a data de referência.
- **RF-INT-005** — Fonte indisponível ou desatualizada é sinalizada nas telas
  que a utilizam (RF-SHELL-006, RF-MAPA-006).
- **RF-INT-006** — Credenciais gerenciadas em W-10, nunca em código.
- **RF-INT-007** — URLs de fontes com data no nome aceitam `{data}` (dia anterior,
  AAAAMMDD) e `{data_hoje}`, no fuso de Fortaleza.
- **RF-INT-008** — Conectores de fontes externas, configuráveis em Administração >
  Integrações: GeoJSON por endereço, WFS (GetFeature com saída GeoJSON), ArcGIS REST
  (`query` com `f=geojson`, paginado por `resultOffset`) e CKAN (`package_show` e o recurso
  GeoJSON, CSV ou XLSX; no CSV e no XLSX os pontos saem das colunas de latitude e longitude
  configuráveis, e o XLSX passa pelos limites de tamanho e de membros da importação de inventário). Cada conector guarda destino, periodicidade (manual, diária, semanal ou
  mensal), órgão, licença e página da fonte (atribuição obrigatória) e é auditado. Só quem tem
  `admin.configuracao` cria, edita, testa ou sincroniza.
- **RF-INT-009** — A busca de um conector é tratada como SSRF em potencial: só HTTPS, só hosts
  da lista do servidor (`ITREE_CONECTORES_HOSTS_PERMITIDOS`, padrão
  `mapas.fortaleza.ce.gov.br,dados.fortaleza.ce.gov.br`), sem credencial no endereço, só a
  porta 443, IP privado, loopback, link-local ou reservado recusado depois de resolver o DNS (e
  de novo no IP conectado), redirecionamento revalidado a cada salto (no máximo 3), tempo
  limite, limite de bytes lidos por streaming, de feições e de páginas. O conteúdo baixado é
  dado não confiável: só é interpretado (GeoJSON, CSV) e nunca executado; propriedades viram
  texto, nunca HTML. Com proxy de saída configurado, quem resolve o nome é o proxy: a lista de
  hosts e o HTTPS continuam valendo.
- **RF-INT-010** — Cada sincronização gera um registro de execução (início, fim, sucesso,
  recebidos, novos, atualizados, removidos, inválidos e erro), mostrado no histórico do
  conector. Não há duas execuções simultâneas do mesmo conector. Um agendador de hora em hora
  dispara os conectores ativos vencidos pela periodicidade; "Sincronizar agora" dispara na hora.
- **RF-INT-011** — Destino camada de referência: as feições (id externo, geometria em 4326,
  propriedades) são substituídas numa única transação, então uma falha mantém a camada
  anterior. O id externo vem da propriedade indicada em `campo_id`, do `id` da feição ou, na
  falta, de um hash do conteúdo. É contexto: não é inventário e não cria árvores.
- **RF-INT-012** — Destino lote de importação: cria um lote **em prévia**, com o modelo de
  mapeamento e o modo do conector, e nunca o confirma. Quem importa inventário recebe uma
  notificação e a seção Conectores destaca a prévia aguardando. Enquanto houver uma prévia
  do conector sem confirmar nem descartar, nenhuma nova é criada.
- **RF-INT-013** — Conector ativo cuja última execução falhou, ou que passou de duas
  periodicidades sem rodar, entra no indicador de fontes do cabeçalho como as demais fontes.
- **RF-INT-014** — Planilhas em ficha da URBFOR (doação de mudas a pessoa física e jurídica, e
  plantio): comandos `importar_doacao_mudas` e `importar_plantio_urbfor`. A doação grava quantidade
  por espécie, categoria e tipo de beneficiário, **sem requerente nem endereço**, e não vai ao mapa
  (não tem local). O plantio grava data, endereço e local em texto, espécies e quantidades e o bairro
  lido **só do texto do endereço** (aliases do manejo da URBFOR; sem bairro, o motivo); **não
  geocodifica nem cria árvore** (DP-18). Fonte, licença e data de referência em cada linha (RF-INT-001);
  idempotente por tipo e ano. O número que sai de uma planilha é o informado pela URBFOR, sem
  conferência em campo.
- **RF-INT-015** — Adoção de praças e áreas verdes (Fortaleza em Mapas, mapa 622): comando
  `importar_adocao_pracas`, com reimportação mensal. **O nome do adotante e qualquer contato são
  descartados na leitura**, sem ser gravados, mostrados nem registrados em log; só ficam o
  identificador, o nome da praça, a regional, o ponto, o ano de referência e a categoria do adotante
  (empresa, associação ou condomínio, quando a razão social deixa claro). Cada ponto é ligado à praça
  mais próxima a até 50 m; sem praça nesse raio, fica sem vínculo, com o motivo. A fonte não informa a
  data do termo.

- **RF-INT-016** — Ilha de calor de superfície (UrbVerde, IAU-USP): comando
  `importar_ilha_calor_urbverde` calcula, por bairro, a média dos pixels de 30 m do raster ICUS 2025
  (WCS), com cobertura, fonte, ano, método e licença, e reimporta uma vez por ano. A licença da fonte
  não é aberta (uso público e acadêmico, sem fins comerciais): o valor só é gravado com
  `URBVERDE_GRAVAR_VALORES`; desligado, o comando só calcula e avisa. A camada WMS do mapa não depende
  disso (RF-MAPA-036).

## 3. Fluxo para alertas ambientais

1. Ingerir evento ou polígono da fonte.
2. Armazenar fonte, ID externo, data de detecção e de ingestão.
3. Normalizar geometria e SRC.
4. Cruzar com bairros, áreas protegidas, zoneamento e camadas disponíveis.
5. Consultar licenças quando houver dados acessíveis e compatíveis.
6. Criar alerta para triagem humana (W-08).
7. Registrar análise, encaminhamento e eventual confirmação pela autoridade.
- **RF-INT-017** — População, renda e IDH por bairro (`importar_populacao_censo`,
  `importar_renda_censo`, `importar_estimativa_populacao`, `importar_idh_bairros`). O arquivo
  atual do IBGE vem da listagem do diretório (o sufixo de data muda a cada revisão) e o ano do
  Censo vem do caminho do arquivo. A população oficial por bairro é a do Censo; a estimativa anual
  do IBGE é só municipal, e a por bairro é **estimativa iTree** (Censo × razão municipal), sempre
  rotulada com o método e a hipótese de crescimento uniforme. O IDH é de 2010 e nunca é estimado.
  A tarefa mensal `renovar_fontes_populacao` reimporta o que mudou e registra cada execução
  (`ExecucaoFonteExterna`), que alimenta "Fontes dos dados" e o aviso de fonte desatualizada.
- **RF-IND-POP-001** — "Árvores cadastradas por 1.000 habitantes" e "habitantes por árvore
  cadastrada" usam a população do Censo, levam o selo **provisório** (DP-14) e a ressalva de que
  um valor baixo pode indicar falta de cadastro, não falta de árvores. Aparecem na ficha do
  bairro, na camada do mapa (quintis), nas Análises (barras, ordenação e CSV; dispersão contra a
  renda, com correlação só descritiva) e na visão geral.
