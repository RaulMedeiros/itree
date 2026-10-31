# W-01 — Shell, navegação e padrões de UI

**Status:** Em implementação (F0) · **Fase:** F0 · **Prioridade:** P0

## 1. Objetivo

Definir a estrutura comum do painel web: navegação, layout, padrões de
componentes e representação de estados, seguindo a direção **C — Field
Operations**.

## 2. Navegação principal

| Ordem | Item                   | Spec  | Fase |
| ----- | ---------------------- | ----- | ---- |
| 1     | Visão geral            | W-06  | F2   |
| 2     | Mapa                   | W-02  | F1   |
| 3     | Inventário             | W-03  | F1   |
| 4     | Inspeções              | W-05  | F2   |
| 5     | Ocorrências            | W-04  | F1   |
| 6     | Equipes e tarefas      | W-07  | F2   |
| 7     | Análises e relatórios  | W-09  | F3   |
| 8     | Administração          | W-10  | F0   |

Alertas ambientais (W-08) ficam como seção própria dentro de **Ocorrências**
(aba "Alertas ambientais"), visualmente separada das ocorrências confirmadas.
Qualidade de dados, intervenções e integrações são acessadas dentro dos módulos
relacionados (ver especificação consolidada §3.1).

## 3. Requisitos funcionais

- **RF-SHELL-001** — Barra lateral com os itens de §2; itens sem permissão não
  são exibidos; itens de fases não entregues não aparecem em produção.
- **RF-SHELL-002** — Cabeçalho com: território ativo (inicialmente Fortaleza),
  busca global, notificações e menu do usuário (perfil, sair).
- **RF-SHELL-003** — Busca global por identificador de árvore, identificador
  externo, endereço, bairro e coordenada (lat,lon), com resultados agrupados por
  tipo e navegação para o detalhe ou para o mapa.
- **RF-SHELL-004** — URLs estáveis e compartilháveis para cada tela, incluindo
  filtros e posição do mapa como parâmetros de URL.
- **RF-SHELL-005** — Ambiente de demonstração exibe faixa permanente
  "Dados de demonstração — não representam a realidade".
- **RF-SHELL-006** — Indicador global de estado das fontes externas quando
  alguma estiver indisponível ou desatualizada (link para detalhes).

## 4. Padrões de UI

### 4.1 Layouts

- **Mapa + painel:** mapa ocupa a área principal; painel contextual lateral
  direito (≈ 400 px) para detalhe do item selecionado; painel de camadas e
  filtros à esquerda, recolhível.
- **Lista + detalhe:** tabela densa com filtros no topo; detalhe em página
  própria (não modal) com abas.
- **Dashboard:** grade de cartões de indicador compactos + mapa.

### 4.2 Componentes obrigatórios

| Componente           | Uso                                                             |
| -------------------- | --------------------------------------------------------------- |
| Selo de origem       | `Medido`, `Estimado`, `Inferido (IA)`, `Importado` em todo valor relevante (T-01). |
| Selo de fonte        | Fonte + data de atualização em dados externos e indicadores.    |
| Selo de estado       | Estados de processo (cores + texto, nunca só cor).              |
| Selo de sincronização | Estado de sync, separado do estado de processo (W-05).         |
| Cartão de indicador  | Valor, definição (tooltip), período, filtros aplicados, fonte.  |
| Linha do tempo       | Histórico de inspeções, ocorrências, alterações e auditoria.    |
| Diálogo de confirmação com justificativa | Ações irreversíveis ou auditáveis (descartar alerta, fusão, exclusão). |

### 4.3 Estados de tela

Toda tela deve especificar e implementar:

- **Carregando** — esqueleto, sem números provisórios.
- **Vazio** — explica por que está vazio e qual ação tomar.
- **Sem permissão** — mensagem clara, sem revelar dados.
- **Erro** — mensagem acionável e opção de tentar novamente.
- **Fonte indisponível/desatualizada** — dado exibido com aviso, ou ocultado
  com motivo; nunca substituído por zero (RN-PROV-005).

### 4.4 Diretrizes visuais (Field Operations)

- Interface clara, funcional e densa o suficiente para análise.
- Paleta associada a natureza/gestão ambiental, com contraste WCAG 2.2 AA.
- Estados operacionais legíveis: cor sempre acompanhada de texto ou ícone.
- Tipografia e espaçamentos definidos em tokens, compartilhados com o app móvel.
- Design system a consolidar após validação das telas centrais (W-00 §6).

## 5. Critérios de aceite

- **CA-SHELL-001** — Usuário sem permissão para um módulo não vê o item na
  navegação e recebe "sem permissão" ao acessar a URL diretamente.
- **CA-SHELL-002** — Copiar a URL de uma tela filtrada e abri-la em outra sessão
  reproduz os mesmos filtros e posição de mapa.
- **CA-SHELL-003** — Nenhuma tela exibe "0" para dado ausente sem regra explícita.
- **CA-SHELL-004** — Em ambiente de demonstração, a faixa de aviso aparece em
  todas as telas e em exportações.
