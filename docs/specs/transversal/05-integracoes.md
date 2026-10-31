# T-05 — Integrações e dados públicos

**Status:** Rascunho · Disponibilidade, cobertura, formato, licença e
frequência de cada fonte devem ser verificadas antes da integração produtiva
([DP-10](../../decisoes/pendentes.md#dp-10), [DP-11](../../decisoes/pendentes.md#dp-11)).

## 1. Fontes candidatas

| Fonte                    | Uso                                       | Acesso (a verificar)              | Fase web |
| ------------------------ | ----------------------------------------- | --------------------------------- | -------- |
| Fortaleza Dados Abertos  | Limites, bairros, praças, vias            | API CKAN                          | F0/F1    |
| Fortaleza em Mapas       | Camadas e cartografia municipal           | Portal geográfico / downloads     | F1       |
| Fortaleza em Bairros     | Contexto territorial por bairro           | Portal municipal                  | F2       |
| INPE — BDQueimadas       | Focos de calor                            | Dados abertos (CSV/KML)           | F3       |
| INPE — TerraBrasilis     | Supressão / alteração de vegetação        | OGC WFS/OWS e downloads           | F3       |
| MapBiomas Alerta         | Alertas de supressão e laudos             | API GraphQL com token             | F3       |
| MapBiomas Cobertura e Uso | Série histórica de cobertura             | Downloads / ferramentas GIS       | F3+      |
| SEUMA / Fortaleza Online | Licenciamento ambiental                   | Verificar campos espaciais        | F3       |

Endereços de referência: ver §7.2 da [especificação consolidada](../../referencia/especificacao-consolidada-v1.md).

## 2. Requisitos de ingestão

- **RF-INT-001** — Cada integração registra: fonte, URL/endpoint, licença,
  frequência, última execução, último sucesso, erro, registros ingeridos.
- **RF-INT-002** — Ingestão idempotente por (fonte, identificador externo).
- **RF-INT-003** — Normalização de geometria e SRC, mantendo o original.
- **RF-INT-004** — Datas da fonte (detecção/publicação) e data de ingestão
  armazenadas separadamente.
- **RF-INT-005** — Fonte indisponível ou desatualizada é sinalizada nas telas
  que a utilizam (RF-SHELL-006, RF-MAPA-006).
- **RF-INT-006** — Credenciais gerenciadas em W-10, nunca em código.

## 3. Fluxo para alertas ambientais

1. Ingerir evento ou polígono da fonte.
2. Armazenar fonte, ID externo, data de detecção e de ingestão.
3. Normalizar geometria e SRC.
4. Cruzar com bairros, áreas protegidas, zoneamento e camadas disponíveis.
5. Consultar licenças quando houver dados acessíveis e compatíveis.
6. Criar alerta para triagem humana (W-08).
7. Registrar análise, encaminhamento e eventual confirmação pela autoridade.
