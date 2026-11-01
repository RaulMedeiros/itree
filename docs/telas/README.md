# Telas do painel web

Capturas do painel web nas fases F0–F3, em 1440 × 900, com **dados
sintéticos**: bairros, árvores, pessoas e alertas são inventados, e as fotos
são ilustrações geradas por código. Nada aqui representa a realidade de
Fortaleza.

- **Mapa base em branco.** O ambiente de captura não tem acesso aos tiles do
  OpenStreetMap, então aparecem só as camadas da própria plataforma: bairros,
  árvores, ocorrências, tarefas e alertas.
- **Autor "Sistema" na auditoria.** Os dados foram semeados por script, fora de
  uma requisição; em uso real, o autor é a pessoa logada.
- **Como refazer.** Para atualizar as imagens depois de mudar a interface, use
  [`scripts/telas/`](../../scripts/telas/README.md).

As especificações de cada tela estão em [`docs/specs/web/`](../specs/web/).

## Visão geral (W-06)

Indicadores com definição, fórmula e fonte acessíveis em cada cartão. Quando
não há base de cálculo, o cartão mostra "Sem dados" em vez de zero.

![Visão geral](01-visao-geral.png)

## Mapa (W-02)

Vector tiles filtrados pelo escopo do usuário, com legenda de origem da
localização, links para as listas equivalentes e filtros na URL.

![Mapa](02-mapa.png)

Painel contextual de uma árvore selecionada:

![Mapa com árvore selecionada](03-mapa-selecao.png)

Camadas de tarefas em aberto (contorno azul) e de alertas ambientais
(polígono tracejado e focos):

![Mapa com tarefas e alertas](04-mapa-alertas-tarefas.png)

## Inventário (W-03)

Lista de árvores com proveniência da espécie e da localização:

![Lista de árvores](05-arvores.png)

Ficha da árvore: resumo, medidas com origem e método, e histórico auditado:

![Ficha — resumo](06-arvore-resumo.png)
![Ficha — medidas](07-arvore-medidas.png)
![Ficha — histórico](08-arvore-historico.png)

Evidências (enviadas direto ao armazenamento por URL pré-assinada) e
sugestões de IA, que só alteram o cadastro com decisão de um revisor:

![Ficha — evidências](09-arvore-evidencias.png)
![Ficha — sugestões de IA](10-arvore-sugestao-ia.png)

Importação em lote, com pré-visualização antes de criar qualquer registro e
desfazer por lote:

![Importações](11-importacoes.png)
![Nova importação](12-importacao-nova.png)

Possíveis duplicidades (nada é fundido automaticamente) e qualidade de dados
por regras explícitas:

![Possíveis duplicidades](13-duplicidades.png)
![Qualidade de dados](14-qualidade.png)

## Ocorrências (W-04)

![Ocorrências](15-ocorrencias.png)

Detalhe com fluxo de estados, prioridade operacional separada do risco
confirmado e histórico de encaminhamentos:

![Detalhe da ocorrência](16-ocorrencia-detalhe.png)

## Inspeções (W-05)

Fila de revisão das inspeções recebidas do aplicativo de campo:

![Inspeções](17-inspecoes.png)

Revisão: comparação com o cadastro e com a inspeção anterior, sinais
apresentados como possibilidades e validação seletiva:

![Revisão de inspeção](18-inspecao-revisao.png)

## Equipes e tarefas (W-07)

![Equipes e tarefas](19-equipes-tarefas.png)

## Alertas ambientais (W-08)

Sinais externos (INPE/MapBiomas), com vocabulário que nunca afirma infração e
triagem humana:

![Alertas](20-alertas.png)
![Detalhe do alerta](21-alerta-detalhe.png)

## Análises e relatórios (W-09)

Análises com período, definição e fonte, e exportações com metadados:

![Análises e relatórios](22-analises.png)

## Administração (W-10)

![Usuários](23-admin-usuarios.png)
![Detalhe do usuário — papéis e escopo territorial](24-admin-usuario-detalhe.png)
![Equipes](25-admin-equipes.png)
![Territórios](26-admin-territorios.png)
![Catálogo de espécies](27-admin-especies.png)
![Tipos de ocorrência](28-admin-tipos-ocorrencia.png)
![Integrações — ingestões de alertas](29-admin-integracoes.png)
![Auditoria](30-admin-auditoria.png)
