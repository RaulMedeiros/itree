# W-09 — Análises, relatórios e exportações

**Status:** Implementado (F3; mapa coroplético e relatórios assistidos por IA pendentes) · **Fase:** F3 · **Prioridade:** P1

## 1. Objetivo

Transformar dados validados em indicadores e documentos para gestão, com
exportação rastreável.

## 2. Análises propostas

- Árvores cadastradas por bairro.
- Inspeções por período e equipe.
- Percentual de registros com localização válida.
- Distribuição das condições aparentes registradas.
- Ocorrências por tipo, estado e prioridade.
- Tempo entre abertura e atendimento de ocorrência.
- Evolução do inventário e da cobertura de inspeções.
- Alertas ambientais por fonte, período e território.

Todas seguem o contrato de indicador de [W-06 §2](06-visao-geral.md#2-contrato-de-indicador).

## 3. Requisitos funcionais

- **RF-REL-001** — Tela de análise com seleção de indicador, filtros, quebra
  (bairro, equipe, período) e visualização em tabela, gráfico e mapa coroplético
  por bairro.
- **RF-REL-002** — Exportações: CSV, XLSX, PDF e GeoJSON, conforme tipo de dado
  e permissão.
- **RF-REL-003** — Todo arquivo exportado inclui metadados: data de geração,
  usuário, filtros, definição dos indicadores, fontes e datas de atualização.
  Em GeoJSON, também o sistema de referência.
- **RF-REL-004** — Exportações ficam registradas na auditoria.
- **RF-REL-005** — Relatórios salvos (filtros + indicadores) reutilizáveis.
- **RF-REL-007** — Análises de doação de mudas da URBFOR (2022): "Mudas doadas por espécie" (as 15
  mais doadas, uma a uma, e o restante em "Outras") e "Mudas doadas por categoria" (ornamental,
  nativa ou frutífera, palmeira, medicinal e "Categoria não informada"), com fonte, licença e ano.
  É dado do município inteiro e sem local: exige escopo municipal, não vai ao mapa, não traz nome
  nem endereço de quem recebeu e não depende do período escolhido (RF-INT-014).
- **RF-REL-008** — "Plantios por bairro (URBFOR, 2022)": mudas plantadas por bairro do escopo, com o
  bairro lido do texto do endereço; a parcela "Sem bairro identificado" (e o motivo) é declarada e só
  aparece com escopo municipal. Bairro sem plantio identificado não é zero. Não cria árvore nem
  localiza o plantio (RF-INT-014).
- **RF-REL-009** — "Onde plantar" (`/planejamento`, permissão de leitura de relatórios): cenário de
  priorização de bairros para plantio, **não é índice oficial** (DP-14). Seis critérios, cada um
  como percentil entre os bairros de Fortaleza na direção que pede plantio: pouca arborização do
  entorno (Censo 2022), alta densidade, baixo rendimento do responsável, poucas árvores cadastradas
  por 1.000 habitantes (provisório, com a ressalva do inventário), pouca área verde por habitante
  e ilha de calor (só com valores gravados; sem eles o critério aparece desabilitado). O IDH 2010
  não entra. A API devolve valores brutos e percentis com fonte e ano; os pesos (0 a 5, três
  cenários prontos) ponderam no navegador, ficam na URL e podem ser copiados e exportados em CSV.
  Bairro sem dado num critério tem esse critério ignorado na média e marcado.
- **RF-REL-006** — Rascunho de relatório assistido por IA (P1, posterior): texto
  marcado como gerado por IA, com referências aos dados usados, editável antes
  de exportar (T-04).

## 4. Regras

- **RN-REL-001** — Exportações de dados pessoais ou localização sensível
  respeitam DP-09.
- **RN-REL-002** — Mapas coropléticos normalizam por área ou população apenas
  quando a fonte do denominador estiver identificada.
- **RN-REL-003** — Não converter correlação em causalidade em textos gerados.

## 5. Critérios de aceite

- **CA-REL-001** — O total exportado em CSV coincide com o total mostrado na
  tela para os mesmos filtros.
- **CA-REL-002** — PDF exportado contém definição, período e fontes de cada
  indicador.
- **CA-REL-003** — Usuário sem permissão de exportação não vê as ações de
  exportar.
