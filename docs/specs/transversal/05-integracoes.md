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

## 3. Fluxo para alertas ambientais

1. Ingerir evento ou polígono da fonte.
2. Armazenar fonte, ID externo, data de detecção e de ingestão.
3. Normalizar geometria e SRC.
4. Cruzar com bairros, áreas protegidas, zoneamento e camadas disponíveis.
5. Consultar licenças quando houver dados acessíveis e compatíveis.
6. Criar alerta para triagem humana (W-08).
7. Registrar análise, encaminhamento e eventual confirmação pela autoridade.
