# W-02 — Mapa geoespacial

**Status:** Implementado (F1) · **Fase:** F1 · **Prioridade:** P0 (básico) / P1 (filtros avançados)

## 1. Objetivo

Explorar árvores, ocorrências, inspeções, tarefas e o contexto territorial de
Fortaleza, com indicação explícita de origem e precisão de cada geometria.

## 2. Histórias

- Como **gestor**, quero ver a distribuição de árvores e ocorrências por bairro
  para entender onde concentrar esforço.
- Como **coordenador**, quero filtrar árvores sem inspeção recente em uma área
  para planejar tarefas.
- Como **técnico revisor**, quero abrir uma árvore no mapa e ver sua localização
  coletada versus importada.

## 3. Requisitos funcionais

### Mapa base e camadas

- **RF-MAPA-001** — Alternar mapa de ruas e imagem de satélite.
- **RF-MAPA-002** — Exibir data da imagem de satélite quando o provedor
  informar; caso contrário, "data da imagem não informada pelo provedor".
- **RF-MAPA-003** — Camadas operacionais: árvores, ocorrências, inspeções,
  tarefas (cada uma liga/desliga; tarefas em F2).
- **RF-MAPA-004** — Camadas territoriais: limite municipal, bairros e demais
  camadas municipais disponíveis (T-05), cada uma com fonte e data.
- **RF-MAPA-005** — Camadas ambientais (alertas, F3) em grupo separado,
  visualmente distintas das ocorrências.
- **RF-MAPA-006** — Camada indisponível ou desatualizada aparece marcada no
  painel de camadas, com motivo e data da última atualização.
- **RF-MAPA-007** — Legenda dinâmica das camadas ativas.
- **RF-MAPA-008** — Camadas de contexto de fontes externas em grupo próprio
  ("Contexto (fontes externas)"), desligadas por padrão, com fonte, data e
  definição na legenda. A primeira é "Arborização do entorno (Censo 2022)":
  bairros pintados pelo percentual de faces de quadra com árvore, em cinco
  classes de um só matiz com quebras fixas (40, 50, 60 e 70%, escolhidas pela distribuição real de Fortaleza); bairro sem dado
  fica hachurado e aparece como "Sem dado" na legenda, nunca como zero.

### Navegação e busca

- **RF-MAPA-010** — Busca por identificador, endereço, bairro ou coordenada
  (integra com RF-SHELL-003).
- **RF-MAPA-011** — Ao buscar bairro, enquadrar o polígono e destacá-lo. Escolher
  o bairro no seletor de território do cabeçalho tem o mesmo efeito; voltar a
  "todo o escopo" limpa o destaque e enquadra o escopo.
- **RF-MAPA-012** — Exibir coordenada sob o cursor e escala.

### Densidade e seleção

- **RF-MAPA-020** — Agrupar pontos em alta densidade, com contagem; expandir ao
  aproximar. As árvores, abaixo do zoom 12, aparecem em um grupo por bairro (no ponto interior
  do polígono, com a contagem de todo o bairro no escopo e o anel da pior condição); a partir
  do zoom 12, em células.
- **RF-MAPA-021** — Selecionar árvore/ocorrência abre painel contextual com
  resumo, selo de origem da localização, precisão, última inspeção, ocorrências
  abertas e link para o detalhe.
- **RF-MAPA-022** — Seleção por área (retângulo/polígono) para ver lista dos
  itens e enviar para "criar tarefa" (F2) ou exportação (F3). A área vai para
  a URL (parâmetro `area`) e é restaurada ao voltar ao mapa; o retângulo
  funciona com mouse, toque e caneta; com a área ativa, clicar numa árvore abre
  o painel dela sem perder a área.

### Filtros

- **RF-MAPA-030** — Filtros: espécie, condição aparente, período, estado,
  equipe, bairro, origem da localização.
- **RF-MAPA-031** — Filtro "sem inspeção há mais de N dias" e "sem inspeção".
- **RF-MAPA-033** — Camadas de referência dos conectores ativos (RF-INT-011) aparecem como
  camadas opcionais em "Camadas conectadas", desligadas por padrão, abaixo das árvores e das
  ocorrências. Cada uma mostra legenda, órgão, licença, página da fonte e data da última
  sincronização. O popup mostra as propriedades com os rótulos cadastrados no conector (com
  rótulos, só as listadas) e sempre como texto. A feição só é buscada ao ligar a camada.
- **RF-MAPA-032** — Filtros e camadas são compartilhados com o Inventário
  (abrir a mesma seleção em lista).

## 4. Regras de confiabilidade

- **RN-MAPA-001** — Representação visual não sugere precisão maior que a do
  dado: pontos com precisão conhecida pior que o limiar (a definir, DP-06)
  exibem círculo de incerteza ao aproximar.
- **RN-MAPA-002** — Localização coletada em campo (GPS), importada e estimada
  têm símbolos distintos e constam na legenda.
- **RN-MAPA-003** — Pontos sem localização não são plotados em posição
  fictícia (ex.: centroide do bairro) sem marcação explícita de "estimada".
- **RN-MAPA-004** — Polígonos e marcadores de demonstração só existem em
  ambiente de demonstração.

## 5. Critérios de aceite

- **CA-MAPA-001** — Alternância ruas/satélite mantém camadas, zoom e seleção.
- **CA-MAPA-002** — Toda camada ativa mostra fonte e data no painel de camadas.
- **CA-MAPA-003** — Com 100 mil árvores, o mapa permanece navegável (ver
  RNF-PERF-002).
- **CA-MAPA-004** — Árvore com localização importada exibe símbolo e selo
  "Importada" no painel contextual, com a fonte.
- **CA-MAPA-005** — Desligar uma fonte territorial resulta em aviso na camada,
  não em erro genérico da tela.

## 6. Dependências e decisões

- [DP-06](../../decisoes/pendentes.md#dp-06) sistema de referência e padrões de
  geometria.
- [DP-07](../../decisoes/pendentes.md#dp-07) provedor de mapas (ruas/satélite).
- T-05 para camadas municipais.
