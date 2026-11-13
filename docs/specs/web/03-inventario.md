# W-03 — Inventário e detalhe de árvore

**Status:** Implementado (F1) · **Fase:** F1 · **Prioridade:** P0

## 1. Objetivo

Manter o cadastro individual e o histórico de cada árvore, com proveniência
de cada dado.

## 2. Histórias

- Como **gestor**, quero listar e filtrar o inventário para saber quantas
  árvores temos por bairro e com que qualidade de dado.
- Como **técnico revisor**, quero ver o histórico completo de uma árvore
  (inspeções, ocorrências, alterações) em um só lugar.
- Como **administrador de dados**, quero importar um inventário existente sem
  perder a referência à fonte original.
- Como **técnico revisor**, quero revisar pares de possíveis duplicidades e
  decidir manualmente.

## 3. Telas

### 3.1 Lista do inventário

- **RF-INV-001** — Tabela com colunas configuráveis: ID, espécie (comum e
  científica, com estado de validação), bairro, endereço, última inspeção,
  condição aparente mais recente, ocorrências abertas, origem da localização,
  completude.
- **RF-INV-002** — Filtros equivalentes a RF-MAPA-030/031; ação "ver no mapa".
- **RF-INV-003** — Contadores no topo distinguem **total de registros** de
  **registros válidos** (RN-INV-001), com definição acessível.
- **RF-INV-004** — Paginação/rolagem para grandes volumes; ordenação por coluna.

### 3.2 Detalhe de árvore

Página com cabeçalho (ID, espécie, endereço, mini-mapa, selos) e abas:

| Aba            | Conteúdo                                                        |
| -------------- | --------------------------------------------------------------- |
| Resumo         | Dados atuais com selo de origem por campo; condição aparente mais recente com data e autor. |
| Localização    | Coordenadas, precisão, origem, histórico de localizações.       |
| Medidas        | Altura, DAP/diâmetro e outras, cada uma com método, unidade, data, responsável e origem. |
| Inspeções      | Linha do tempo das inspeções com estado de processo (W-05).     |
| Ocorrências    | Ocorrências e intervenções relacionadas.                        |
| Evidências     | Fotografias e documentos, vinculados à inspeção de origem.      |
| Sugestões de IA | Inferências pendentes/aceitas/rejeitadas (T-04).               |
| Histórico      | Auditoria de alterações (quem, quando, o quê, origem). A visão "Cadeias" mostra cada inspeção com a ocorrência que gerou e as tarefas dela, em linha do tempo, com links e estados. |

- **RF-INV-005** — Identificador único interno imutável; identificadores
  externos listados com sua fonte.
- **RF-INV-006** — Espécie exibe estado: `Confirmada`, `Sugerida (IA)`,
  `Informada (não validada)`, `Não identificada`.
- **RF-INV-007** — Ação "registrar ocorrência" a partir do detalhe (W-04).

### 3.3 Cadastro e edição

- **RF-INV-008** — Criar árvore no web informando localização (clique no mapa
  ou coordenada), espécie e dados disponíveis; origem da localização é
  registrada como `estimada (web)` salvo informação contrária.
- **RF-INV-009** — Edição gera evento de auditoria com valor anterior, novo
  valor, autor, data e motivo (opcional, obrigatório para campos validados).

### 3.4 Importação em lote

- **RF-INV-010** — Importar CSV, XLSX, GeoJSON, Shapefile (em ZIP), GeoPackage e
  KML/KMZ com mapeamento de colunas, prévia, validação e relatório de erros antes
  de confirmar (formatos geográficos: RF-INV-015).
- **RF-INV-011** — Cada registro importado guarda: fonte, arquivo, data de
  importação, usuário, identificador externo, e origem `Importado` em todos os
  campos.
- **RF-INV-012** — Importação é reversível como lote (desfazer o lote inteiro,
  auditado), enquanto os registros não tiverem sido editados.
- **RF-INV-012a** — A confirmação nunca fica meio aplicada nem roda duas vezes.
  Até `IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA` linhas válidas (padrão 500), cria
  na hora; acima disso, o lote fica "em processamento" (resposta 202) e a
  confirmação roda em segundo plano, em blocos de 200 linhas. A lista de
  importações mostra o andamento e o resultado, e a tela pode ser fechada sem
  interromper nada. Linha que falha é desfeita e listada; as demais seguem. Se
  a execução for interrompida, o lote fica "interrompido" e "Retomar" continua
  do ponto em que parou.

- **RF-INV-015** — Formatos de planilha e geográficos. XLSX lê a primeira aba,
  com os nomes das colunas na primeira linha (latitude e longitude são mapeadas
  como no CSV). Shapefile (ZIP), GeoPackage e KML/KMZ são lidos pela GDAL/OGR a
  partir de um diretório temporário próprio, apagado em seguida: nenhum caminho
  vem do usuário, o ZIP só extrai membros de extensões conhecidas, sem
  diretórios, com limite de tamanho do envio (`IMPORTACAO_TAMANHO_MAXIMO_MB`, 50),
  de membros (`IMPORTACAO_MAX_MEMBROS_ZIP`, 50) e de tamanho descompactado
  (`IMPORTACAO_MAX_DESCOMPACTADO_MB`, 200). A geometria é reprojetada para
  WGS 84 a partir do SRC do próprio arquivo; o SRC informado na tela só vale para
  arquivo sem SRC (Shapefile sem `.prj`). Só feições de ponto são importadas:
  polígonos e linhas são recusados com o motivo na linha, a menos que a opção
  "Aceitar polígonos pelo ponto interior" esteja marcada. Arquivo com mais de uma
  camada com feições é recusado, pedindo uma só.
- **RF-INV-016** — Modo atualização. Na confirmação, a pessoa escolhe entre
  "criar só as novas" (padrão) e "criar as novas e atualizar as existentes", pelo
  identificador externo da mesma fonte (`IdentificadorExterno`). A prévia traz o
  relatório de diferenças: quantas serão criadas, quantas atualizadas e, para
  cada uma, os campos que mudam com o valor antigo e o novo. Só muda o que a
  prévia mostrou: endereço, espécie (enquanto não estiver confirmada nem
  sugerida por IA), localização (só se a origem atual for "importada") e altura e
  DAP, que entram como **novas medidas** da fonte quando diferem da última que
  ela gravou. Se a árvore mudar entre a prévia e a confirmação, a linha falha com
  motivo e nada é gravado nela. Árvore fora do escopo da pessoa não aparece nem
  é atualizada. A auditoria registra o lote e o modo no contexto de cada
  alteração. Lote que atualizou árvores existentes não pode ser desfeito
  (RF-INV-012). Segue o processamento em segundo plano da RF-INV-012a,
  contando as linhas a criar e atualizar.
- **RF-INV-017** — Espécie por nome popular. Se a coluna de espécie não casa com
  o nome científico, a importação tenta os nomes comuns do catálogo, sem acento e
  sem diferenciar maiúsculas. Uma espécie só: entra como "informada" (nunca
  confirmada), com o texto original guardado, e a prévia avisa. Mais de uma: a
  árvore fica sem espécie e a prévia lista a linha como ambígua.
- **RF-INV-018** — Duplicatas por proximidade. A prévia aponta as linhas novas a
  menos de `IMPORTACAO_RAIO_DUPLICATAS_M` (padrão 2 m) de uma árvore ativa do
  escopo da pessoa, com o código da árvore e a distância. Não é erro: sem a opção
  "Ignorar duplicatas" na confirmação, a linha é criada mesmo assim. Reaproveita
  a consulta espacial de `duplicidades.py`.
- **RF-INV-019** — Modelos de importação. O mapeamento de colunas (e o SRC)
  pode ser salvo com nome e fonte. Na próxima importação da mesma fonte, o
  passo de colunas sugere os modelos salvos; usar um preenche só as colunas que
  existem no arquivo e avisa das que faltam. Quem pode importar vê, atualiza e
  apaga os modelos (guardam nomes de colunas, nunca dados); alterações ficam na
  auditoria. API em `/modelos-importacao`.

### 3.5 Possíveis duplicidades

- **RF-INV-013** — Fila de pares suspeitos (proximidade + atributos), com
  critério que gerou a sugestão.
- **RF-INV-014** — Ações por par: "não são duplicadas", "fundir" (escolhendo o
  valor de cada campo), "adiar". Fusão exige justificativa.

### 3.6 Catálogo de espécies (M-01)

- **RF-INV-020** — Grade de espécies com imagem, nome científico, nomes
  comuns, origem (nativa do Brasil, exótica ou não informada) e quantidade de
  árvores no escopo do usuário. Mais frequentes primeiro, com busca.
- **RF-INV-021** — Detalhe da espécie: resumo da Wikipedia e imagem do
  Wikimedia Commons, ambos com autoria, licença e data da consulta. Links para
  Wikipedia, Wikidata e GBIF. Atalho para a lista das árvores da espécie.
- **RF-INV-022** — Ficha da árvore mostra o cartão da espécie, com link para o
  catálogo.
- **RN-INV-020** — Referências externas só são aceitas quando o item do
  Wikidata tem nome do táxon (P225) idêntico ao nome científico do catálogo.
  Sem correspondência exata, a espécie fica como "não encontrada". Nada é
  completado por aproximação.
- **RN-INV-021** — Imagem sem licença declarada não é usada. A imagem
  exibida é uma cópia reduzida (até 960 px) guardada no armazenamento da
  plataforma, com autor e licença da origem; sem cópia, exibe-se a miniatura
  da Wikimedia. Referências
  externas não alteram família, nomes comuns nem origem, que são mantidos pela
  administração (DP-02).

## 4. Regras

- **RN-INV-001** — "Registro válido" = possui ID, localização com origem
  conhecida e não está marcado como excluído/fundido. Definição revisável em
  [DP-14](../../decisoes/pendentes.md#dp-14).
- **RN-INV-002** — Medidas indicam método, unidade, data e responsável;
  estimativas são marcadas como `Estimado`.
- **RN-INV-003** — Sugestão de espécie por IA não sobrescreve espécie
  confirmada sem ação explícita de usuário habilitado.
- **RN-INV-004** — Não há fusão nem exclusão automática. Exclusão é lógica,
  auditada e exige justificativa.
- **RN-INV-005** — Condição aparente não é inferida sem inspeção ou evidência;
  sem inspeção, exibir "sem avaliação registrada".

## 5. Critérios de aceite

- **CA-INV-001** — Cada árvore possui identificador único.
- **CA-INV-002** — A localização registra origem e precisão quando disponíveis.
- **CA-INV-003** — O histórico de inspeções é consultável a partir do detalhe.
- **CA-INV-004** — Valores estimados são visualmente diferenciados de medidas.
- **CA-INV-005** — Aceitar uma sugestão de IA gera auditoria com o resultado
  original da IA preservado.
- **CA-INV-006** — Importar o mesmo arquivo duas vezes não cria duplicatas
  silenciosas: o sistema detecta IDs externos repetidos e pede decisão (ignorar
  ou, no modo atualização, atualizar o que a prévia mostrou).
- **CA-INV-007** — Fundir dois registros preserva o histórico de ambos e
  redireciona o ID descontinuado para o ID resultante.

## 6. Dependências e decisões

- [DP-02](../../decisoes/pendentes.md#dp-02) catálogo de espécies.
- [DP-08](../../decisoes/pendentes.md#dp-08) armazenamento de imagens.
- [DP-09](../../decisoes/pendentes.md#dp-09) privacidade de fotos e localização.
