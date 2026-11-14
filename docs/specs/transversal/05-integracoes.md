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
  GeoJSON ou CSV). Cada conector guarda destino, periodicidade (manual, diária, semanal ou
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

## 3. Fluxo para alertas ambientais

1. Ingerir evento ou polígono da fonte.
2. Armazenar fonte, ID externo, data de detecção e de ingestão.
3. Normalizar geometria e SRC.
4. Cruzar com bairros, áreas protegidas, zoneamento e camadas disponíveis.
5. Consultar licenças quando houver dados acessíveis e compatíveis.
6. Criar alerta para triagem humana (W-08).
7. Registrar análise, encaminhamento e eventual confirmação pela autoridade.
