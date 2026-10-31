# W-00 — Escopo, fases e não-objetivos do painel web

**Status:** Rascunho

## 1. Objetivo

Definir o que o painel web desktop entrega, em que ordem, e o que fica de fora
nas primeiras versões.

## 2. Usuários do web

Perfis provisórios até a decisão [DP-01](../../decisoes/pendentes.md#dp-01):

| Perfil                | Uso principal no web                                         |
| --------------------- | ------------------------------------------------------------ |
| Gestor municipal      | Indicadores, priorização, relatórios, visão territorial.     |
| Coordenador de equipe | Distribuição de tarefas, acompanhamento de pendências.       |
| Técnico revisor       | Revisão e validação de inspeções, confirmação de espécies.   |
| Analista ambiental    | Triagem de alertas ambientais, encaminhamento à fiscalização. |
| Técnico de campo      | Consulta no web (uso principal é no app móvel).              |
| Administrador         | Usuários, papéis, catálogos, integrações, auditoria.         |
| Consulta              | Leitura restrita, sem edição.                                |

## 3. Fases propostas

As fases organizam a entrega do web; não substituem a priorização de produto.

### F0 — Fundação

- Autenticação, sessão e perfis (W-10, T-03).
- Shell da aplicação: navegação, layout, componentes base, estados vazios e de
  erro (W-01).
- Administração mínima: usuários, equipes, papéis (W-10).
- Trilha de auditoria registrando desde o primeiro dia (T-01).
- Território: limites de Fortaleza e bairros carregados com fonte e data (T-05).

### F1 — Inventário territorial

- Mapa com ruas/satélite, camada de árvores, busca, agrupamento, painel
  contextual (W-02).
- Inventário: lista, filtros, detalhe de árvore com histórico e proveniência,
  cadastro/edição manual, importação em lote (W-03).
- Ocorrências básicas: registro, prioridade, estado, responsável (W-04).

### F2 — Gestão operacional

- Inspeções: consulta, revisão, devolução e validação (W-05).
- Visão geral com indicadores definidos e rastreáveis (W-06).
- Equipes e tarefas: atribuição, prazos, acompanhamento (W-07).

### F3 — Inteligência e integrações

- Alertas ambientais (INPE, MapBiomas) com triagem humana (W-08).
- Análises, relatórios e exportações (W-09).
- IA assistiva no web: confirmação de sugestões de espécie, qualidade de dados,
  pares de possíveis duplicidades (T-04).

## 4. Origem dos dados antes do app móvel

O web será entregue antes ou em paralelo ao app móvel. Para que F1 e F2 tenham
dados reais, propõe-se:

1. **Importação em lote** de inventários existentes (CSV/GeoJSON), marcando
   origem `Importado`, fonte e data (RF-INV-010).
2. **Cadastro manual no web** de árvores e ocorrências por usuários habilitados.
3. **Inspeções registradas no web** apenas como recurso de contingência
   (decisão [DP-16](../../decisoes/pendentes.md#dp-16)), marcadas com origem
   `web` e sem GPS de campo.

Até existirem dados reais, o ambiente de demonstração usa dados fictícios
**rotulados de forma visível** como demonstração (RN-PROV-008).

## 5. Não-objetivos (primeiras versões do web)

- Execução completa da inspeção em campo (é do app móvel).
- Operação offline no web.
- Integração com sensores (P2).
- Otimização de rotas (P2).
- Modelos preditivos e detecção de padrões em imagens históricas (P2).
- Copiloto de gestão em linguagem natural (P1/P2, fora de F0–F3).
- Classificação automática de legalidade de qualquer evento ambiental — **nunca**
  é objetivo.
- Fusão ou exclusão automática de registros — **nunca** é objetivo.

## 6. Telas a validar visualmente primeiro

Conforme §13 da especificação consolidada, antes de implementar:

1. Mapa desktop (W-02).
2. Detalhe de árvore (W-03).
3. Ocorrências e alertas ambientais (W-04, W-08).
4. Visão geral municipal (W-06).
