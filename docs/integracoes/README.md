# Integrações: índice

Uma linha por fonte ou integração. Esta página responde "o que entra, como e
quando". Os endereços, os volumes verificados e o modo de uso de cada fonte estão
em [fontes públicas](fontes-publicas.md). O contrato do projeto de detecção está
em [detecção automática](deteccao-automatica.md).

Regras que valem para todas (ver [ciclo de melhoria](../melhoria/README.md)):

- nenhum número ambiental sem fonte e método;
- toda fonte guarda órgão, licença ou termos, data de referência e data de ingestão;
- licença não declarada é registrada como tal, nunca presumida
  ([DP-11](../decisoes/pendentes.md#dp-11));
- dado pessoal é descartado na leitura.

**Como ler a coluna Periodicidade.** "Agendada" quer dizer que o Celery beat roda
a tarefa (a agenda está em [Arquitetura](../arquitetura/README.md#tarefas-celery-e-agenda)).
"Manual" quer dizer que só roda quando alguém executa o comando. Os comandos rodam
a partir de `backend/` com `uv run python manage.py <comando>`, ou na imagem da
API com `manage <comando>`. Quase todos aceitam `--arquivo` (ou `--url`) para
trabalhar sem rede.

**Estado.** "Implementada" tem comando ou ingestão no código. "Parcial" está
implementada com limite declarado. "Não implementada" e "Adiada" estão só
documentadas.

## Território e áreas verdes

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Regionais e bairros (Fortaleza em Mapas, ids 17 e 21) | Ipplan | Implementada | `importar_limites_fortaleza` | Manual | Uso livre com citação (termos da API) |
| Bairros e regionais (CKAN) | SEUMA | Implementada, como alternativa | `importar_territorios` | Manual | `other-open` |
| Praças, parques urbanos e unidades de conservação (Mapas) | URBFOR, SEUMA, CEUC/SEMA | Implementada | `importar_areas_verdes` | Agendada, dia 2 | Termos da API |
| Adoção de praças (Mapas, id 622) | SEUMA | Implementada | `importar_adocao_pracas` | Agendada, dia 2 | Termos da API |
| CNUC (conferência das unidades de conservação) | MMA | Implementada | `conferir_ucs_cnuc` | Manual | `cc-by` |
| Limite municipal (CKAN) e malha de bairros do Censo | SEFIN, IBGE | Não implementada | n/a | n/a | `cc-by` (SEFIN); não declarada (IBGE) |

## Alertas ambientais

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Focos de calor diários (BDQueimadas) | INPE | Implementada | `ingerir_alertas` | Agendada, a cada `ALERTAS_INTERVALO_HORAS` (padrão 6), só com `ALERTAS_FONTES` | Não declarada; citar "INPE, Programa Queimadas" |
| Focos de calor mensais | INPE | Implementada | `ingerir_focos_historico` | Manual | idem |
| DETER por WFS (TerraBrasilis) | INPE | Parcial: lê a URL configurada em `ALERTAS_FONTES`; DETER Amazônia e Cerrado não cobrem Fortaleza | `ingerir_alertas --fonte` | Conforme `ALERTAS_FONTES` | Licença formal não declarada |
| PRODES Caatinga (supressão anual) | INPE | Implementada, como camada de referência, sem alerta | `ingerir_prodes_caatinga` | Manual | idem |
| MapBiomas Alerta | MapBiomas | Adiada (exige token) | n/a | n/a | n/a |

## Vegetação, clima e população

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Arborização do entorno, Censo 2022 | IBGE | Implementada | `importar_censo_arborizacao` | Manual | Não declarada |
| População por bairro, Censo 2022 | IBGE | Implementada | `importar_populacao_censo` | Agendada, dia 6 (só reimporta se a versão mudou) | Não declarada |
| Rendimento do responsável, Censo 2022 | IBGE | Implementada | `importar_renda_censo` | Agendada, dia 6 | Não declarada |
| Estimativas anuais da população (município) | IBGE | Implementada | `importar_estimativa_populacao` | Agendada, dia 6 | Não declarada |
| IDH por bairro, 2010 | SDE, Prefeitura de Fortaleza | Implementada | `importar_idh_bairros` | Agendada, dia 6 | Termos da API; `cc-by-sa` no CKAN |
| Ilha de calor de superfície | UrbVerde (IAU-USP) | Parcial: camada WMS no mapa; o valor por bairro só é gravado com `URBVERDE_GRAVAR_VALORES` | `importar_ilha_calor_urbverde` | Agendada, 5 de fevereiro | Termos da UrbVerde: uso acadêmico e público, sem fins comerciais, com citação. Não é licença aberta |
| NDVI de 10 m | UrbVerde (IAU-USP) | Parcial: só com GeoTIFF local, porque o servidor não cobre Fortaleza | `importar_cobertura_vegetal --arquivo` | Manual | Mesmos termos da UrbVerde |

## Imóveis, uso do solo e infraestrutura

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Edificações, Open Buildings v3 | Google Research | Implementada | `importar_edificacoes` | Manual | CC BY 4.0 |
| Uso predominante por lote, 2022 (WMS) | SEFIN | Implementada | `importar_uso_lotes_sefin` | Manual | Termos da API |
| Macrozoneamento Urbano (Mapas, id 604) | SEUMA | Implementada | `importar_macrozoneamento` | Agendada, dia 4 | Termos da API |
| IPTU e áreas edificadas por bairro | SEFIN | Implementada | `importar_indicadores_sefin` | Agendada, dia 4 | Termos da API |
| Pontos de iluminação pública | SEINF | Implementada | `importar_iluminacao_publica` | Agendada, dia 3 | `cc-by-sa` |

A regra 3-30-300 (`calcular_3_30_300`) é cálculo do iTree sobre essas fontes, não
uma fonte. Roda no dia 7 e também depois da reimportação dos dados imobiliários.
O método está em [3-30-300](../indicadores/3-30-300.md).

## URBFOR: manejo, doação de mudas e plantio

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Podas, recolhimento e supressão, 2023 | URBFOR | Parcial: só o agregado por bairro e mês, porque a fonte não traz coordenadas | `importar_manejo_urbfor` | Manual | Vazia no CKAN |
| Doação de mudas, 2022 | URBFOR | Parcial: só em Análises, sem requerente nem endereço | `importar_doacao_mudas` | Manual | `cc-by-sa` |
| Plantio de mudas, 2022 | URBFOR | Parcial: só em Análises, sem geocodificar nem criar árvore | `importar_plantio_urbfor` | Manual | `cc-by-sa` |

## Espécies

| Fonte | Órgão | Estado | Comando | Periodicidade | Licença ou termos |
| --- | --- | --- | --- | --- | --- |
| Referências e imagens das espécies (Wikidata, Wikipedia, Commons, GBIF) | Wikimedia, GBIF | Implementada | `atualizar_referencias_especies` | Agendada, dia 1, com nova tentativa diária dos erros | Por registro (CC0, CC BY, CC BY-SA), com autoria e licença gravadas |
| Flora e Funga do Brasil | JBRJ | Adiada (desafio anti-robô) | n/a | n/a | n/a |

## Integrações de entrada

| Integração | Estado | Como entra | Periodicidade | Observação |
| --- | --- | --- | --- | --- |
| Projeto de detecção automática (satélite e vídeo de rua) | Implementada | API `POST /api/v1/deteccoes/lotes` com token de integração, ou pacote ZIP (`importar_deteccoes <pacote>` e tela Inventário › Detecções) | Sob demanda | Contrato em [detecção automática](deteccao-automatica.md). `simular_deteccoes` gera um lote sintético e declarado para demonstração |
| Conectores genéricos (GeoJSON, WFS, ArcGIS REST, CKAN) | Implementada | Cadastro na administração; só hosts de `ITREE_CONECTORES_HOSTS_PERMITIDOS`, por HTTPS | Agendada, de hora em hora confere quais venceram | `criar_conectores_exemplo` cadastra exemplos inativos, como os atendimentos do Plano de Arborização (Mapas, id 534) |
| Bases legadas de inventário (XLSX, Shapefile em ZIP, GeoPackage, KML e KMZ) | Implementada | Assistente de importação no painel, com modelos de mapeamento e prévia | Sob demanda | Não há inventário oficial a importar ([decisão de 21/11/2026](../decisoes/2026-11-21-rumo-do-produto.md)) |

## Sem fonte aberta ou sem acesso

Estas fontes foram consideradas e não entraram:

- **INMET** (vento e chuva): adiada por escolha e porque o host não estava liberado;
- **Central 156**: não há dado aberto; depende de pedido à prefeitura;
- **GeoServer do Fortaleza em Mapas**: não é exposto; usa-se o GeoJSON da API;
- **API de malhas do IBGE (`servicodados`)**: o TLS não completou; usa-se o FTP.

## Documentos históricos

- [Verificação das fontes, 11/11/2026](verificacao-fontes-2026-11-11.md): relatório
  da primeira verificação, com os comandos e as amostras.
- [Plano de integração, 15/11/2026](plano-2026-11-15.md): plano já executado.
