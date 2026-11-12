# Crítica das telas do iTree, rodada 2 (etapa "Criticar")

Base: 38 capturas reais 1440x900 (`scratchpad/telas/`), refeitas depois das correções da rodada 1 (41 achados, C-01 a C-41). Lidas junto com a crítica da rodada 1, a direção visual, o backlog e as decisões pendentes. Nenhuma sugestão antecipa decisão pendente: onde aparece DP, a proposta é só mudar a forma de mostrá-la.

Limite de método: as capturas só têm dados populados e um único tamanho de tela. Estados vazios, telas abaixo de 1440 px, modais de confirmação (Concluir, Fundir, Validar) e históricos recolhidos não foram vistos. Onde isso pesa, está dito.

Convenções: esforço P/M/G = pequeno/médio/grande; prioridade P1 (próxima iteração) / P2 / P3.

---

## (a) Status da rodada 1

Resumo: de 41 achados, 24 resolvidos, 14 parciais, 3 não resolvidos, 1 não verificável (C-02). Nada piorou em si, mas quatro correções trouxeram efeito colateral (ver R2-01, R2-05, R2-06 e R2-10).

### Não resolvidos

| id | O que a captura mostra |
| --- | --- |
| C-04 | Continua sem a faixa de "dados de demonstração" (RF-SHELL-005) e sem o indicador de fonte externa atrasada (RF-SHELL-006), em todas as 38 telas. Só o sino foi entregue (RF-SHELL-002). |
| C-07b | Em 01b, o último ponto do gráfico mensal (nov/26: 6 inspeções, 1 ocorrência) segue sem marca de "mês em andamento", e os rótulos "6" e "1" ainda encostam na borda direita. A queda de 19 para 1 lê-se como melhora. |
| C-22 | Em 15, o filtro de situação segue em "Todas" e a ordem é por código. As linhas visíveis são só Cancelada e Concluída, todas "Não atribuída". Cinco linhas repetem "Poda solicitada / Copa encostando na fiação de baixa tensão". Quem entra para trabalhar não vê as abertas. |

### Parciais (resolvido em parte, ou com sobra)

| id | Feito | Falta |
| --- | --- | --- |
| C-01 | 08 usa rótulos humanos e dd/mm/aaaa ("Fita diamétrica", "Aplicada ao cadastro: Não"). | Valores crus continuam: "Tipo: dap", "Tipo: altura", "Origem: medido", "Valor 38" com a unidade em linha separada. O histórico de 16, 18 e 30 estava recolhido e não foi verificado. |
| C-06 | Texto de comparação padronizado e acompanhado de "melhorou/piorou". | A data-base muda entre cartões (30/09/26 e 11/09/26) sem explicação, e o texto ficou longo (ver R2-02). |
| C-08 | Em 02b, os rótulos de bairro somem no zoom afastado. | Os agrupamentos ainda se sobrepõem (números 2, 3, 4, 5 encavalados). Em 02, o rótulo "BAIRRO DE TESTE C" tem um ponto amarelo no meio do texto. |
| C-09 | A legenda vem recolhida e há dica "Role para ver mais". | A dica se sobrepõe ao título da seção ("OCORRÊNCIA⌄ Role para ver mais", visto em 02, 03, 04, 33, 34, 35). Ver R2-06. |
| C-13 | Rótulos de filtro curtos, setas de ordenação, coluna "Condição aparente", caixa de seleção. | Os filtros ainda quebram em duas linhas. O código quebra ("ARV-" / "000243"). "Endereço" quebra em até três linhas e "Atualizado em" sobra largura (ver R2-15). |
| C-15 | "Excluir" separado, mini-mapa e área de foto na ficha. | Coordenadas agora com vírgula nos dois lados ("-3,746602, -38,540452"), o que ficou ambíguo. 18 ainda usa ponto. Ver R2-05. |
| C-20 | Vírgula decimal ("1,1 m"), diferenças em azul. | Os dois botões têm o mesmo peso. Só se comparam campos de cadastro, sem medidas, fotos ou ocorrências. O que sobrevive à fusão fica para o modal (não visto). |
| C-23 | Prazo restante ("faltam 20 dias") e selo "Sem responsável". | "Cancelar" ficou vermelho sólido, tão forte quanto "Concluir". A ocorrência está "Em atendimento" sem responsável. Ver R2-10. |
| C-27 | Filtro encurtado e colunas de árvores a 100 m e ocorrências. | O código quebra ("ALR-" / "000002", "SINT-" / "DETER-1"). Os três alertas têm o mesmo selo e o mesmo "nenhuma aberta a até 100 m". |
| C-33 | Coluna "Árvores" por território, aviso sobre DP-10. | "Data do dado" segue "Não informada pela fonte" nas quatro linhas. |
| C-35 | Texto sem nome de variável de ambiente. | Falta "Última coleta" e "Próxima". "(DP-11)." cai sozinho na linha seguinte. |
| C-36 | Coluna "Registro", busca por código, agrupamento ("48 criados"). | Em 30, as duas linhas de Usuário não dizem qual usuário ("Registro: —", autor "Primeiro acesso"). O rodapé diz "1–50 de 2022" com 3 linhas visíveis. Ver R2-18. |
| C-40 | Migalhas e dica de atalho "/". | Gerou navegação redundante (R2-01). |
| C-07 | Período preenchido, atalhos 30 dias / 12 meses / Ano, rótulos "ignora o período". | Excesso de texto nos cartões (R2-02). Contado como resolvido no mérito; fica o custo de forma. |

### Resolvidos de verdade (confirmados na captura)

C-03 (dd/mm/aaaa e "Escolher arquivo"), C-05 (Alertas e pendências na primeira dobra, ao lado dos cartões), C-10 (selo "Ilustração" e placeholder), C-11 (atalhos Registrar ocorrência/Pedir inspeção no painel; "52 árvores"), C-12 (aviso "oculta no mapa", tarefas preenchidas, alerta hachurado visível), C-14 (âmbar só para "Estimada (web)", coluna de condição), C-16 (coluna "Fonte / responsável", aviso de medida pendente), C-17 (legenda completa, sem lixeira solta), C-18 (seletor vazio e botão desabilitado), C-19 (motivo do "Desfazer" bloqueado, indicador de passos, mensagem "Preencha a fonte"), C-21 (zerados recolhidos em "Sem problemas (4)"), C-24 ("3 sinais", ponto de cor, "chegou hoje"), C-25 (barra fixa com aviso "Sem evidências anexadas"), C-26 (uma ação principal e "⋯", código sem quebra), C-28 (losango roxo e árvores a 100 m), C-29 ("Exportar dados" em menu, linha de total), C-30 (um só estado), C-31 ("Sem alterações", bairros recuados), C-32 (selo "Incompleta" com orientação), C-34 ("1 dia"), C-37 (placeholder baixo, "Referências não consultadas"), C-38 (texto orientador, botão "Consultar" com rótulo), C-39 (destaque por contorno, sem tingir), C-41 (filtros com altura única).

Não verificável: C-02 (histórico de encaminhamentos de 16 está recolhido).

---

## (b) Achados novos

| id | tela | problema observado | efeito | sugestão concreta | esforço | prio |
| --- | --- | --- | --- | --- | --- | --- |
| R2-01 | 05 a 14, 16, 18, 21, 23 a 32 | Navegação repetida. Em listas, aba ativa + migalha + título dizem a mesma coisa ("Árvores" / "Inventário › Árvores" / "Árvores"; "Usuários" nas telas de Administração). Em detalhes (06 a 10, 16, 18, 21, 24), "← Árvores" + migalha + título + sub-abas: cinco camadas antes do conteúdo (y=98, 148, 180, 210, 280). Em 06 o conteúdo só começa em y≈316 (35% da altura). | Perde-se um terço da primeira dobra em chrome; "voltar" e migalha redundantes (o item que a rodada 1 temia). | Tirar o "← voltar" (a migalha já é clicável). Em telas com aba ativa, tirar a migalha. Em detalhes, migalha só com o último nível clicável. | P | P1 |
| R2-02 | 01 | Texto demais nos cartões. O cartão 1 tem 9 linhas de legenda ("Base: 243 registros", "Válido: ativa, com localização e origem registradas (critério provisório)", "Situação atual (ignora o período)", "(registro anterior) · melhorou"). "Situação atual (ignora o período)" repete em 4 cartões. Alturas desiguais (cartão 1 ≈335 px, cartão 5 ≈235 px), com vazio em baixo nos cartões 2, 3, 4 e 6. | Número grande se perde no meio de legenda. Difícil varrer 6 cartões. | Padrão fixo: valor, variação em chip (seta + "vs. 30/09"), uma linha de legenda. Base, definição de "válido" e "ignora o período" vão para o popover do (i), que já existe. Selo pequeno "12 m" no cartão de janela fixa. Altura única por linha. | M | P1 |
| R2-03 | 01b | "Outros indicadores" repete o que já está acima: "Árvores cadastradas 243" (igual ao primeiro cartão), "Inspeções aguardando revisão 6" e "Tarefas atrasadas 4" (iguais às linhas de Alertas e pendências). Seis blocos com sparkline e o link "Como é calculado" repetido 6 vezes. Sobram ≈300 px de vazio sob "Espécies confirmadas" (y≈1560 a 1800 na captura reduzida). | Densidade sem informação nova, e a coluna da esquerda fica oca. | Manter só "Com altura ou DAP 98,8%", "Inspeções pendentes (tarefas) 13" e "Ocorrências registradas 12", em linhas simples. Usar o espaço liberado para "Bairros que pedem atenção" (ver G-03). | M | P2 |
| R2-04 | 01, 01b | O bloco "Árvores no território" mostra título e legenda, mas ≈270 px de branco no lugar do mapa. | Se não for artefato da captura (WebGL), a Visão geral não mostra onde estão os problemas. | Verificar ao vivo. Se for real, é erro P1: mostrar o mapa ou um esqueleto de carregamento com mensagem de falha. Se for artefato, fazer a captura esperar o `idle` do mapa. | P | P1 |
| R2-05 | 06, 18 | Coordenadas em dois formatos: 06 mostra "-3,746602, -38,540452" (vírgula decimal e vírgula separadora), 18 mostra "-3.746612, -38.540432". | Ambiguidade de leitura e de cópia. | Um só formato em toda a UI, p. ex. "3,746602° S, 38,540452° O", com botão "copiar" que entrega ponto decimal. | P | P2 |
| R2-06 | 02, 03, 04, 33, 34, 35 | No painel de camadas, "Role para ver mais" se sobrepõe ao título da seção seguinte ("OCORRÊNCIA⌄ Role para ver mais"). O painel tem 5 seletores sempre abertos e ocupa ≈745 px de altura. | Texto sobreposto parece defeito, e o painel ainda cobre a esquerda do mapa. | Trocar o texto por sombra no rodapé do painel. Recolher os 4 filtros secundários em "Mais filtros" (fechado por padrão). | M | P2 |
| R2-07 | 02b | O zoom do município ainda mostra agrupamentos sobrepostos, com números ilegíveis e triângulos escondidos por baixo. | A tela de entrada do produto não mostra distribuição legível no zoom afastado. | Aumentar o raio de agrupamento em zoom baixo. Mostrar um agrupador por bairro com o total e o anel da pior condição. | M | P2 |
| R2-08 | 34 | "Seleção por área" diz "52 árvores", mas a lista mostra 5 e o botão diz "Mostrar mais (2 restantes)" (5 + 2 = 7, não 52). A quinta linha (ARV-000010) está cortada pela caixa de rolagem. Com o painel de camadas aberto, sobram ≈470 px de mapa entre os dois painéis. | Contagem que não fecha. Perde-se a confiança no número que gera as tarefas. | Mostrar "exibindo 5 de 52" com "Ver todas em lista". Recolher o painel de camadas ao abrir a seleção. | M | P2 |
| R2-09 | 01b | O "Ver catálogo" ao fim de "165 árvores válidas ainda sem espécie confirmada não entram nesta distribuição" leva ao catálogo de espécies, não às 165 árvores. A barra "Condição aparente registrada" tem 45% "Sem avaliação registrada" (110 árvores) sem ação associada. As barras de "Ocorrências em aberto por prioridade" usam o mesmo laranja para Sem prioridade, Baixa e Média, fora da paleta de prioridade da direção visual. | O número aponta um problema, mas o clique não leva até ele. Cor inconsistente com a legenda do mapa. | "Ver 165 árvores" abre `Árvores` filtrada por espécie não confirmada. Na barra de condição, "Criar tarefas de inspeção para as 110 sem avaliação" (a ação já existe em 05). Barras com a cor de prioridade da paleta. | P | P2 |
| R2-10 | 16 | "Cancelar" é vermelho sólido ao lado de "Concluir". A ocorrência está "Em atendimento" e ao mesmo tempo "Sem responsável". | Ação destrutiva com o mesmo peso da principal. Estado avançado sem dono. | "Cancelar" em contorno vermelho ou dentro de "⋯", com motivo obrigatório. Avisar ao concluir sem responsável (ou sem evidência: a seção de evidências está vazia). | P | P2 |
| R2-11 | 19 | Tarefas "Bloqueada" (TAR-000010, TAR-000005) mostram o botão verde "Iniciar". | A ação principal contradiz o estado. Convida a ignorar o bloqueio ("Acesso bloqueado por obra no local"). | Para Bloqueada, a ação principal vira "Retomar" (com confirmação de que o bloqueio acabou) e o motivo fica junto do selo. | P | P1 |
| R2-12 | 17 | A fila de revisão não tem ordenação nem filtro por "Requer encaminhamento" ou por condição; "chegou hoje" aparece em todas as linhas. | Com mais de 6 itens, o revisor não prioriza o que é ruim ou urgente. | Ordenação por "Recebida em", condição e "Requer encaminhamento". "Aguarda há N dias" quando passar de 1 dia. | P | P2 |
| R2-13 | 36 | 32 notificações não lidas, uma linha por evento (INS-000028, 29, 30...), sem agrupamento. A lista corta o último item sem indicar rolagem, sem "Ver todas" e sem preferências. INS-000028 a 30 aparecem aqui, mas a fila de 17 só tem INS-000001 a 000006. | O sino vira ruído e perde valor. Possível divergência entre os dois lugares (a confirmar). | Agrupar por tipo ("6 inspeções aguardando revisão", abre a fila). Página "Todas as notificações". Conferir a origem das INS-000028 a 30. | M | P2 |
| R2-14 | 01, 01b, 10, 26 a 29 | Códigos internos de decisão aparecem para o usuário final: "DP-14" (subtítulo de 01), "DP-13" (10), "DP-10" (26), "DP-02" (27), "DP-17" (28), "DP-11" (29), "RN-EQP-002" (rodapé de 01b). | O servidor da prefeitura não decodifica "DP-14". Lê-se como produto inacabado. | Dizer "em definição pela prefeitura" com link "Saiba mais" para uma página de pendências. O código DP fica no tooltip ou só em ambiente de homologação. Não muda nenhuma decisão. | P | P2 |
| R2-15 | 05, 20 | Códigos quebram no meio ("ARV-" / "000243" em 05; "ALR-" / "000002" e "SINT-" / "DETER-1" em 20). Em 05, "Endereço" quebra em até 3 linhas enquanto "Atualizado em" sobra largura; as linhas têm ≈77 px e cabem ≈6 por tela. | Leitura picada e pouca densidade na lista principal. | `white-space: nowrap` nos códigos. Redistribuir larguras (endereço mais largo, data em uma linha). | P | P1 |
| R2-16 | 05 | As 7 caixas de filtro ocupam duas linhas, e "Ocorrências abertas" mostra "—" em todas as linhas visíveis. | Espaço gasto sem informação. | Mostrar só 4 filtros fixos (busca, espécie, bairro, situação) e o resto em "Mais filtros". Mostrar a coluna só quando houver valor ou como contagem 0. | M | P3 |
| R2-17 | 09 | A lixeira sumiu e a foto não mostra ação de ampliar ou remover. | Não dá para corrigir uma foto errada nem vê-la em tamanho maior. | Clique abre ampliação. Menu "⋯" no cartão com "Remover" e confirmação. | P | P3 |
| R2-18 | 30 | Linhas de Usuário sem identificação do usuário ("Registro: —", autor "Primeiro acesso (provedor de login)"). O rodapé diz "1–50 de 2022" com 3 linhas visíveis. A descrição fala só de usuários, equipes e territórios, mas a tabela traz "Área verde". | A auditoria não responde "quem". O total confunde. | Preencher "Registro" com o nome ou e-mail do usuário alterado. Explicar se o total conta eventos ou grupos. Atualizar o texto da descrição. | P | P2 |
| R2-19 | 18 | A barra fixa de ação sobrepõe o bloco "Evidências" na captura (y≈840 a 900). | Se a página não reservar espaço no fim, a barra esconde o último conteúdo. | Garantir `padding-bottom` igual à altura da barra. | P | P3 |
| R2-20 | 12 | O indicador mostra o passo 2 de 3, mas a escolha do arquivo (passo 1) está na mesma tela. | Os passos descrevem outra coisa do que a tela faz. | Renomear: 1 "Arquivo e fonte", 2 "Colunas", 3 "Conferir". | P | P3 |
| R2-21 | 21 | A coluna de condição usa minúscula ("boa") e "—" onde 05 e 17 dizem "Boa" e "Não avaliada". | Inconsistência de vocabulário. | Reaproveitar o mesmo componente de condição (ponto + rótulo) das outras listas. | P | P3 |
| R2-22 | 01 | A comparação em percentual sobre base pequena: "+250% vs. 11/09/26" em inspeções (7 contra 2, por conta aritmética), "+33%" em ocorrências registradas (12 contra 9, idem). | O percentual exagera variações pequenas. | Mostrar "7 (antes 2)" quando a base for menor que ~30. | P | P3 |

---

## (c) Lacunas de produto (priorizadas)

Todas verificadas pelo que as capturas mostram ou não mostram. "Não visível" quer dizer que não aparece nas 38 telas, não que não exista no código.

| id | Lacuna | Evidência | Prio | Critério de pronto |
| --- | --- | --- | --- | --- |
| G-01 | Fluxo ponta a ponta sem elo visível: campo → revisão → ocorrência/tarefa → fechamento. | 17 mostra "Requer encaminhamento" (INS-000005 e 000001) e 18 só oferece "Devolver" e "Validar…", sem "Abrir ocorrência". 16 não mostra a origem (inspeção ou alerta) nem as tarefas vinculadas; tem só "Criar tarefa de atendimento". 19 mostra tarefas por árvore, sem link para a inspeção resultante. Concluir (16, 19) não mostra campo de resultado. | P1 | De uma inspeção com "Requer encaminhamento", há um botão que cria a ocorrência já preenchida. 16 mostra "Origem" e "Tarefas vinculadas" com estado. Concluir ocorrência ou tarefa registra resultado e evidência. A aba Histórico da árvore mostra o encadeamento em ordem. Teste de ponta a ponta cobre os quatro passos. |
| G-02 | A visão geral diz quanto, mas não onde agir primeiro. | 01 lista seis contagens sem recorte territorial. 01b não tem ranking de bairros. O destaque de bairro existe (33), mas nada na visão geral leva a ele. | P1 | Cartão "Bairros que pedem atenção" ordenado por regra declarada (ocorrências vencidas, risco confirmado, árvores ruins ou mortas, sem avaliação). Cada linha abre o mapa com o bairro em destaque. A fórmula aparece em "Como é calculado". Gestor acha o bairro em ≤10 s. |
| G-03 | Sem onboarding nem checklist de implantação. | Nenhuma captura mostra primeira entrada nem estado vazio. A única orientação é "Incompleta" em 25 e 19. | P1 | Admin vê checklist (importar inventário, territórios, equipes, tipos de ocorrência, usuários) com marcação automática. Cada lista vazia tem mensagem e CTA. Capturas de base vazia entram no conjunto. |
| G-04 | Faixa de demonstração e saúde das fontes (C-04). | Ausentes em todas as telas. | P1 | Faixa configurável por ambiente. Indicador de fonte atrasada com link para Integrações. "Última coleta" e "Próxima" em 29. |
| G-05 | Lista de ocorrências não dirige o trabalho. | 15 abre em "Todas", sem ordenação por urgência ou atraso, sem prazo restante nas abertas. | P1 | Abre em "Em aberto", ordenado por atraso e prioridade. Coluna "Prazo" com "vence em N dias" e destaque do atrasado. |
| G-06 | Ajuda contextual inexistente. | Nenhum link "Ajuda" na barra lateral ou no cabeçalho. Termos como "registro válido", "condição aparente", "Estimada (web)", "Importada" e "Risco confirmado" não têm explicação no ponto de uso, exceto em 01 (ícone i). | P2 | Ícone "?" no cabeçalho abre ajuda curta por rota. Tooltip nos selos e termos (≥10 termos). Sem códigos DP no texto. |
| G-07 | Sem ação em lote em ocorrências e tarefas. | Só 05 tem caixa de seleção. 19 reatribui linha a linha ("Reatribuir" em "⋯"). | P2 | Seleção múltipla em 15 e 19, com "Reatribuir", "Definir prazo" e "Definir prioridade", e registro na auditoria. |
| G-08 | Exportação só em Análises e na seleção por área. | 15, 17, 19 e 20 não têm botão de exportar. | P2 | CSV com metadados (data, usuário, filtros) em cada lista, respeitando o escopo. |
| G-09 | Notificações sem central nem preferências. | 36 mostra um menu suspenso de 32 itens, sem "Ver todas". | P2 | Página de notificações, agrupamento por tipo, escolha de quais receber. |
| G-10 | Nenhuma captura abaixo de 1440 px. | Todas as 38 são 1440x900. Há usuários de campo. | P3 | Capturas a 1024 e 768 das telas de campo e revisão, com defeitos corrigidos. |

---

## (d) Os 12 itens de maior valor, em ordem

1. **G-01** — Elo visível entre inspeção, ocorrência, tarefa e fechamento. Hoje cada etapa existe, mas a cadeia não.
2. **G-05 / C-22** — Lista de ocorrências abrindo em "Em aberto", por urgência, com prazo restante.
3. **G-02** — "Bairros que pedem atenção" na Visão geral, ligado ao destaque de bairro do mapa.
4. **G-04 / C-04** — Faixa de demonstração e indicador de fontes, ausentes em todas as telas desde a rodada 1.
5. **G-03** — Onboarding e estados vazios guiados, com capturas de base vazia.
6. **R2-01** — Remover a navegação redundante (voltar, migalha, aba e título).
7. **R2-11** — Tarefa bloqueada mostrando "Iniciar".
8. **R2-04** — Verificar o bloco de mapa em branco na Visão geral.
9. **R2-02 / R2-03** — Cartões enxutos na Visão geral e fim da repetição em "Outros indicadores".
10. **R2-14 / G-06** — Tirar códigos DP do texto da UI e criar ajuda contextual.
11. **R2-10** — "Cancelar" sem peso de ação principal, e aviso ao concluir sem responsável ou evidência.
12. **R2-15** — Códigos sem quebra e larguras de coluna na lista de árvores.

Fora do top 12 e baratos: R2-05 (coordenadas), R2-09 (CTA "Ver 165 árvores"), R2-13 (notificações agrupadas), R2-18 (auditoria identificar o usuário).

---

## Pontos fortes que subiram nesta rodada

- A Visão geral agora entrega "Alertas e pendências" na primeira dobra, ordenado por gravidade, com ícone e contagem.
- A revisão de inspeção tem barra fixa e aviso de "sem evidências" no ponto de decisão.
- A sugestão de IA deixou de empurrar uma espécie: seletor vazio e confirmação desabilitada.
- Estados de equipe e catálogo dizem o próximo passo ("Adicione membros e território para receber tarefas").
- A Qualidade de dados recolhe os zerados e ordena por gravidade.
