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
| Histórico      | Auditoria de alterações (quem, quando, o quê, origem).          |

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

- **RF-INV-010** — Importar CSV e GeoJSON com mapeamento de colunas, prévia,
  validação e relatório de erros antes de confirmar.
- **RF-INV-011** — Cada registro importado guarda: fonte, arquivo, data de
  importação, usuário, identificador externo, e origem `Importado` em todos os
  campos.
- **RF-INV-012** — Importação é reversível como lote (desfazer o lote inteiro,
  auditado), enquanto os registros não tiverem sido editados.

### 3.5 Possíveis duplicidades

- **RF-INV-013** — Fila de pares suspeitos (proximidade + atributos), com
  critério que gerou a sugestão.
- **RF-INV-014** — Ações por par: "não são duplicadas", "fundir" (escolhendo o
  valor de cada campo), "adiar". Fusão exige justificativa.

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
  silenciosas: o sistema detecta IDs externos repetidos e pede decisão.
- **CA-INV-007** — Fundir dois registros preserva o histórico de ambos e
  redireciona o ID descontinuado para o ID resultante.

## 6. Dependências e decisões

- [DP-02](../../decisoes/pendentes.md#dp-02) catálogo de espécies.
- [DP-08](../../decisoes/pendentes.md#dp-08) armazenamento de imagens.
- [DP-09](../../decisoes/pendentes.md#dp-09) privacidade de fotos e localização.
