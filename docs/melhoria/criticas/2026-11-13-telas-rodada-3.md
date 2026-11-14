# Crítica das telas do iTree, rodada 3 (etapa "Criticar"): qualidade visual e de interação

Base: 39 capturas reais em `docs/telas/` (1440×900; 01b, 16 e 18 em página inteira), em modo demonstração e com os 121 bairros oficiais. Também li as rodadas 1 e 2, a direção visual, o backlog e as decisões pendentes. Nenhuma sugestão antecipa decisão pendente: onde uma DP aparece, a proposta muda só a forma de mostrá-la.

Limites do método:
- Há um único tamanho de tela.
- Não há estados de carregamento, erro ou base vazia. "Primeiros passos" existe em `paginas/visao-geral/PrimeirosPassos.tsx`, mas não aparece em nenhuma captura.
- O indicador de fontes (`layout/FontesIndicador.tsx`) só aparece quando há problema, e não aparece.
- O único estado de foco visível é o anel duplo da busca em 33, que está correto.
- Onde citei código, conferi o arquivo. Os demais caminhos são prováveis.

Convenções: esforço P/M/G = pequeno/médio/grande. Prioridade P1 = próxima iteração; P2 e P3 vêm depois.

---

## (a) Status da rodada 2

A rodada 2 tinha 22 achados, 10 lacunas e as sobras da rodada 1.

**Resolvidos (confirmados nas capturas):**
- R2-03: "Outros indicadores" ficou com 3 itens.
- R2-05: coordenadas em "lat -3,746602 · lon -38,540452", iguais em 06 e 18.
- R2-07: grupos por bairro, sem sobreposição, em 02b.
- R2-08: "Exibindo 50 de 52" e "Ver todas em lista (52)".
- R2-09: "Ver 165 árvores", "Criar tarefas… 110" e cores de prioridade da paleta.
- R2-10: "Cancelar" com contorno e aviso "sem responsável".
- R2-11: "Desbloquear" nas tarefas bloqueadas.
- R2-12: ordenação, filtro de condição e "Requer encaminhamento" em 17.
- R2-13: notificações agrupadas e "Ver todas".
- R2-14: nenhum código DP visível; o texto diz "em definição pela prefeitura".
- R2-15: códigos sem quebra.
- R2-17: menu "⋯" no cartão da foto.
- R2-20: passos "Arquivo e fonte / Colunas / Revisão".
- R2-21: "Boa" e "Não avaliada" em 21.
- Lacunas G-02 (Bairros que pedem atenção), G-04 (faixa de demonstração; "Última/Próxima coleta" em 29), G-05 (15 abre em "Em aberto", ordenada por prazo), G-06 ("Ajuda" na barra e "?" nos termos), G-07 (seleção em 15, 17, 19 e 20), G-08 ("Exportar CSV" em 15, 17, 19 e 20) e G-09 ("Ver todas").
- G-01 está quase resolvida: 16 mostra "Origem" e "Tarefas vinculadas", 18 tem "Validar e encaminhar…" e 08 tem "Eventos | Cadeias".

**Não resolvidos ou parciais:**

| id | O que a captura ainda mostra |
| --- | --- |
| C-01 / R2-histórico | Em 08: "Tipo dap", "Tipo altura", "Origem medido", "Valor 38" com "Unidade cm" em outra linha, "Estado **Em revisao**" (sem acento) e "Versão 1". → R3-26 |
| C-07b | No gráfico mensal (01b), nov/26 (6 e 2) segue sem marca de "mês em andamento". → R3-18 |
| C-20 | Em 13, "Não são a mesma árvore" e "Fundir registros…" ainda têm o mesmo peso e tamanho pequeno. |
| C-27 | Em 20, "nenhuma aberta a até 100 m" se repete igual nas 3 linhas, em letra miúda. |
| R2-01 | O "← voltar" saiu e as listas ficaram sem migalha. Nos detalhes de Inventário e Administração ainda há aba de seção, migalha, título e subabas (06 a 10, 24, 32). Em 06 o conteúdo só começa em y≈316. → R3-04 |
| R2-02 / R2-22 | Os cartões de 01 ainda têm 3 linhas de comparação ("+12 vs. 30/09/26 (registro anterior) · melhorou"). O percentual sobre base pequena continua em "+42%" (tempo médio). → R3-15 |
| R2-04 | O mapa resumo aparece agora, mas sem árvores perceptíveis no enquadramento do município (01b). → R3-16 |
| R2-06 | "Role para ver mais" ganhou faixa própria e não se sobrepõe mais. O painel continua com cerca de 320×745 px e cinco grupos abertos, cobrindo o mapa. → R3-21 |
| R2-16 | Os filtros foram resolvidos. "Ocorrências abertas" mostra "—" em todas as linhas visíveis de 05. |
| R2-18 | Em 30, as linhas de "Usuário" ainda têm "Registro: —" (autor "Sistema: vínculo da conta no primeiro acesso"). |
| R2-19 | Em 18, a barra fixa de decisão ainda cobre o bloco "Evidências" (y≈840 a 900). → R3-25 |
| G-03 | Não verificável: nenhuma captura mostra base vazia nem primeiro acesso. |
| G-10 | Não resolvido: todas as capturas seguem em 1440 px. |

---

## (b) Achados novos

| id | tela | problema observado | efeito | sugestão concreta | esf. | prio |
| --- | --- | --- | --- | --- | --- | --- |
| R3-01 | 02, 02b, 03, 04, 33, 34, 35, 37 | O mapa usa `h-[calc(100vh-3.5rem)]` (`paginas/mapa/MapaPagina.tsx:1060`) e não desconta a faixa de demonstração de 32 px (`layout/Shell.tsx`). A página fica 32 px mais alta que a janela. Efeitos visíveis: o item "Ajuda" da barra lateral aparece cortado (y≈895); "Legenda" fica colada à borda; a atribuição "© colaboradores do OpenStreetMap" e a escala não aparecem no mapa principal (no mini-mapa de 06 e 21 aparecem); em 34 o botão principal da seleção por área está cortado (faixa verde em y≈890). | Parece quebrado. A atribuição do OSM é exigência de licença. A ação principal da seleção some. | Shell com altura limitada: `h-dvh flex-col`, `main` com `flex-1 min-h-0 overflow-auto`. O mapa passa a usar `h-full`, sem cálculo fixo. Teste de layout com e sem a faixa. | P | P1 |
| R3-02 | 20, 21 | Em Alertas ambientais (lista e detalhe), nenhum item da barra lateral fica ativo. A rota é `/alertas`, mas o módulo "Ocorrências" aponta para `/ocorrencias` (`acesso/modulos.ts`). | Quem chega pelo sino ou pelos pendentes não sabe em que área está. | Dar ao módulo um conjunto de prefixos ativos (`/ocorrencias`, `/alertas`) e usar `activeOptions` / correspondência manual em `Shell.tsx`. | P | P1 |
| R3-03 | 05, 11, 15, 17, 19, 20, 23, 29 | O cabeçalho de página não segue um padrão. As ações ficam à direita do título em 05, 11, 17, 19, 20 e 23. Em 15 ficam abaixo da descrição, à esquerda, e antes das abas. Em 29 a ação principal "Enviar arquivo da fonte" fica no corpo, à esquerda. As abas de seção vêm acima do título em Inventário e Administração, e abaixo do título e das ações em Ocorrências/Alertas. | O olhar procura a ação em lugares diferentes a cada tela. É o sinal mais forte de "protótipo". | `CabecalhoPagina` (`ui/pagina.tsx`) com ordem fixa: abas de seção → título e descrição à esquerda → ações à direita, com a principal por último. Em 15/20, as abas sobem para cima do título, como em Inventário. Aplicar em `OcorrenciasPagina`, `AlertasPagina` e `IntegracoesPagina`. | M | P1 |
| R3-04 | 06 a 10, 24, 32 | Nos detalhes, quatro camadas de navegação antes do conteúdo: aba de seção ("Árvores" ativa), migalha "Inventário › Árvores › ARV-000058", título e subabas (Resumo… Histórico). Em 16, 18 e 21 só há migalha, título e conteúdo. | Cerca de 200 px de cabeçalho. Os detalhes de Inventário e Administração diferem dos de Ocorrências e Inspeções. | Em rotas de detalhe, esconder a fila de abas de seção em `LayoutInventario.tsx` e `LayoutAdministracao.tsx`; a migalha já leva de volta. Fica igual a 16, 18 e 21. | P | P2 |
| R3-05 | 03, 06, 07, 15, 16, 17, 19, 20 | Os selos não são consistentes. "Importada" é azul em 06/03 e "Importado" é cinza na coluna Origem de 07. "Prioridade baixa" e "Em atendimento" são selos grandes (≈32 px) em 16 e pequenos em 15. "Alerta detectado" é âmbar, mas na paleta o alerta é roxo (`#7048e8`). "Atrasada" é selo vermelho em 15 e 19, ao lado de texto vermelho que diz o mesmo. | A cor deixa de carregar significado (princípio 2 da direção visual). Os tamanhos variam sem critério. | Em `ui/selo.tsx`, criar a variante `tamanho` (sm, md) e, em `componentes/selos.tsx`, um mapa único de tom por domínio: origem, situação, prioridade e alerta. Alerta em violeta. Mesmo rótulo e gênero ("Importada") para a mesma origem. | M | P2 |
| R3-06 | 03, 05, 06, 07, 16, 18, 30, 34 | Os códigos aparecem em fontes diferentes: monoespaçada verde nas listas, monoespaçada preta no cartão do mapa (03, 34), sem serifa no título (06 "ARV-000058", 16 "OCO-000014"). Valores com unidade em fonte monoespaçada e espaçamento largo ("40 cm", "6,8 m", "38 cm pendente", 07 e 18). Há fontes misturadas na mesma célula ("2 registros em INS-000030", 30). | A tipografia parece improvisada e a leitura fica truncada. | Componente `<Codigo>` único (mono, 13 px, mesma cor em todo lugar, inclusive nos títulos). Números e medidas na fonte do texto com `tabular-nums`, nunca em mono. | P | P2 |
| R3-07 | 10, 13, 16, 30 | Botões e campos na mesma linha com alturas diferentes. "Buscar" (h-8) ao lado de campos de h-9 em 30. "Confirmar espécie" e "Rejeitar" (h-8) ao lado do seletor h-9 em 10. "Definir", "Registrar" e "Alterar" pequenos e cada um num canto do cartão em 16. | Desalinhamento perceptível nas linhas de ação. | Regra no `Botao`: dentro de uma linha de formulário, sempre `tamanho="normal"`. `pequeno` só em linhas de tabela. Em 16, a ação do cartão vai sempre no canto superior direito. | P | P2 |
| R3-08 | 05, 14, 16, 18, 26, 27, 28, 29 | Recolhíveis com o `<details>` nativo do navegador: triângulo "▶", 12 a 14 px, sem padding. "▶ Detalhes técnicos" fica colado ao campo de busca (27) e ao título "Fontes" (29). | É um elemento cru do navegador, com espaçamento inconsistente. | Componente `<Recolhivel>` com chevron lucide, área de clique de 36 px e margem fixa. Trocar em `componentes/DetalhesTecnicos.tsx` e `componentes/Historico.tsx`, depois nas páginas (ver UI-2). | P | P2 |
| R3-09 | 15, 17, 20 | Filtros quebram em duas linhas: "Todas as equipes" e "Só atrasadas" (15), "De/até" (17) e "Detectados de/até" (20). Em 15, o seletor de situação está truncado: "Em aberto (não encerr". | A barra de filtros fica irregular e o filtro principal fica ilegível. | Componente de barra de filtros em `ui/campos.tsx`: uma linha com os 3 ou 4 filtros principais e o resto em "Mais filtros" (padrão já usado em 05). Intervalo de datas num único campo "Período" com atalhos, como em 01. Opção curta "Em aberto". | M | P2 |
| R3-10 | 01, 05, 11, 20, 26, 28, 29 | Tabelas: 05 transborda na horizontal ("ATUALIZADO EM" e "13/11/202…" cortados a 1440 px) sem sinal de rolagem. Cabeçalhos em caixa alta quebram em 2 ou 3 linhas ("OCORRÊNCIAS ABERTAS COM RISCO CONFIRMADO", "ÁRVORES A ATÉ 100 M", "EM TRIAGEM OU ENCAMINHADAS"). Nomes quebram com espaço sobrando ("Joaquim / Távora" em 01b, "Gabriel / Gestor" em 11 e 29). | Tabela cortada parece defeito. Os cabeçalhos pesam mais que os dados. | `ui/tabela.tsx`: `Th` com rótulo curto e dica completa, sombra lateral de rolagem (`ui/rolagem.tsx`) e `nowrap` em nomes de pessoa e bairro. Em 05, tirar "Ocorrências abertas" quando tudo for "—" ou estreitar "Endereço". | M | P1 |
| R3-11 | 19 | Ação por linha em verde sólido: 9 botões primários visíveis ("Concluir", "Iniciar", "Desbloquear"), de larguras diferentes e com a borda esquerda desalinhada. | O verde perde a função de "ação principal" e a tela fica pesada. | Ação da linha como botão secundário de largura fixa (ou só no "⋯"), mantendo o primário para a ação da página. `paginas/tarefas/TarefasPagina.tsx`. | P | P2 |
| R3-12 | 31, 32, 06 | Placeholders com cara de wireframe: os 8 cartões de 31 têm uma faixa de 80 px com a mesma folha e "Referências não consultadas" repetido. 32 tem um bloco vazio do tamanho de meia tela. Em 06, "Sem foto" ocupa metade da largura. O README promete referências reais (Wikipedia/Commons), mas as capturas não as mostram. | O catálogo de espécies parece inacabado. | Cartão compacto sem faixa de imagem quando não houver foto. "Referências não consultadas" vira um ícone discreto. Em 06, reduzir o vazio para uma linha com o botão "Adicionar foto". Em `scripts/telas`, consultar as referências antes das capturas (se houver rede) ou declarar a ausência. `EspeciesCatalogoPagina.tsx`. | M | P2 |
| R3-13 | 22 | Os campos "De/até" estão vazios (dd/mm/aaaa), mas o texto diz "Período: 13/11/2025 a 13/11/2026". | Não se vê qual período está aplicado. | Preencher os campos com o período efetivo e trazer os atalhos 30 dias / 12 meses / Ano de 01. `AnalisesPagina.tsx`. | P | P2 |
| R3-14 | 22 | A análise por bairro lista os 121 bairros, quase todos com 0, sob os cabeçalhos genéricos "ITEM / VALOR". | Muita rolagem sem informação. | Cabeçalhos "Bairro / Árvores". Os zeros vão para "Sem árvores no escopo (114)", recolhido. | P | P2 |
| R3-15 | 01 | Os cartões ainda dizem "(registro anterior) · melhorou" em 3 linhas. "+42%" sobre base pequena. O ícone (i) fica solto no rodapé, com vazio entre ele e o texto. | O número principal divide atenção com a legenda. | Variação em chip de uma linha ("↗ +12 desde 30/09"), sem "melhorou". Percentual só com base ≥ 30. (i) ao lado do rótulo. `VisaoGeralPagina.tsx`. | M | P2 |
| R3-16 | 01b | O mapa resumo enquadra o município inteiro e mostra só os limites de bairro: os pontos e grupos das 243 árvores não se distinguem. | O bloco "Árvores no território" não mostra árvores. | Enquadrar pela extensão dos dados (`fitBounds` das árvores do escopo) ou usar os agrupadores por bairro de 02b. `paginas/visao-geral/MapaResumo.tsx`. | P | P1 |
| R3-17 | 01b | O botão "Criar tarefas de inspeção para as 110 sem avaliação" estoura a borda direita do cartão "Condição aparente registrada". | Defeito visual na tela de entrada. | Botão com largura total do cartão e texto que quebra, ou rótulo curto "Criar 110 tarefas de inspeção". `graficos.tsx` / `VisaoGeralPagina.tsx`. | P | P1 |
| R3-18 | 01b | O mês corrente do gráfico mensal não tem marca (C-07b). | A queda em nov/26 parece real. | Último ponto vazado e rótulo "nov/26 (parcial)". | P | P2 |
| R3-19 | 36, 01, 17 | O sino diz "28 inspeções aguardando revisão" (contador 30). "Alertas e pendências" diz "Inspeções aguardando revisão 6", e a fila de 17 tem 6 itens. | Dois números para a mesma coisa minam a confiança. | O texto do grupo diz o que conta ("28 avisos de inspeção recebidos") ou o grupo reflete as pendências atuais. Conferir a origem no servidor. `layout/Sino.tsx`. | M | P1 |
| R3-20 | 02, 03, 04, 33, 35 | Rótulos de bairro duplicados: o da aplicação em caixa alta e, logo abaixo, o do OSM em cinza ("JOSÉ BONIFÁCIO / José Bonifácio", "BENFICA / Benfica", "FÁTIMA / Fátima"). O mapa base mostra ícones de POI (cruzes, "P", hospital) e números de porta (03). Os triângulos cinza-escuros de "sem prioridade" se confundem com esses ícones. | O dado deixa de ser o protagonista (princípios 1 e 5). | Sem antecipar a M-06 (vector tiles): dessaturar e clarear mais o raster (`raster-saturation`, `raster-brightness-min`, `raster-contrast` em `mapa/estilo.ts`). Halo branco de 1,5 px em todos os símbolos (`mapa/simbologia.ts`). Rótulo próprio do bairro só em zoom ≤ 14, onde o OSM ainda não rotula. | M | P2 |
| R3-21 | 02, 02b, 33, 34, 37 | O painel de camadas (≈320×745 px) cobre cerca de 25% do mapa, e o enquadramento não o considera. Em 02b, rótulos são cortados na borda do painel ("ELLERY", "ARQUELÂNDIA"). Em 37, o oeste da cidade fica sob o painel. Em 34, com os dois painéis abertos, sobram cerca de 470 px de mapa. | Os dados ficam escondidos atrás do controle. | `map.setPadding({ left: largura do painel })` e `fitBounds` com o mesmo padding. Grupos "Contexto" e "Ambientais" recolhidos por padrão. Recolher o painel de camadas ao abrir a seleção por área. `MapaPagina.tsx`. | M | P1 |
| R3-22 | 37 | Na coropleta do Censo, os rótulos escuros sobre as classes mais escuras não se leem (Meireles, Aldeota, Dionísio Torres). A legenda das 5 classes fica recolhida. | A camada não se lê sem abrir a legenda. | Rótulos com halo branco nas camadas coropléticas (`mapa/rotulos.ts`, `mapa/coropletica.ts`). Ao ligar uma camada de contexto, abrir a legenda nessa seção (`Legenda` em `MapaPagina.tsx`). | P | P2 |
| R3-23 | 35 | As áreas verdes têm preenchimento oliva-claro de baixo contraste sobre o mapa base, perto do verde de "Boa". | Camada difícil de ver e cor que disputa com a condição. | Contorno mais forte e hachura leve, conferidos pelo `contraste.mjs` como as outras rampas. `mapa/simbologia.ts`. | P | P3 |
| R3-24 | 21 | O mini-mapa do alerta mostra só o losango. As 2 árvores listadas logo abaixo (79 m e 95 m) e o raio de 100 m não aparecem. O cartão de dados à direita tem cerca de 150 px vazios. | A relação espacial que a tela quer mostrar fica só na tabela. | Desenhar o círculo do raio e as árvores próximas com a simbologia de condição. `AlertaDetalhePagina.tsx`. | M | P2 |
| R3-25 | 18 | A barra fixa cobre "Evidências" (R2-19). O cabeçalho mostra o identificador cru "Aplicativo de campo (android-sintetico)". | O último conteúdo fica oculto e a origem tem texto técnico, sem acento. | `padding-bottom` igual à altura da barra. Rótulo humano para o dispositivo ("Aplicativo de campo · Android"). `InspecaoDetalhePagina.tsx`. | P | P3 |
| R3-26 | 08 (e 16, 18, 30, onde o histórico é expandido) | O histórico ainda mostra valores crus (C-01): "Tipo dap", "Origem medido", "Valor 38" com a unidade em outra linha, "Em revisao" sem acento e "Versão 1". | Lê-se como saída de banco de dados. | Em `componentes/historicoFormatos.ts`: rótulos de enum ("DAP", "Medido", "Em revisão"), valor e unidade numa linha ("38 cm") e campo `versao` oculto. Acrescentar casos a `Historico.test.tsx`. | P | P1 |
| R3-27 | 26 | O aviso diz "Os limites vêm de fonte aberta e não são oficiais", mas a coluna Fonte diz "Prefeitura Municipal de Fortaleza – Fortaleza em Mapas (Ipplan)", e o README fala em "bairros oficiais". A fonte se repete em 2 linhas de link em cada linha, com o ícone de link solto à direita. | Mensagem contraditória sobre a origem e tabela inflada. | Ajustar o texto ao que a DP-10 diz hoje (fonte municipal importada; responsável ainda não confirmado), sem fechar a DP. Mostrar a fonte uma vez, acima da tabela, e por linha só quando divergir. `TerritoriosPagina.tsx`. | P | P2 |
| R3-28 | 24 | O escopo territorial repete "Já coberto pelo território superior marcado" em azul em cada filho. O formulário termina em x≈1160, com cerca de 256 px vazios, e "Histórico" fica isolado. "Salvar alterações" fica depois da lista longa. | Ruído visual e salvar fora de vista. | Com o pai marcado, recolher os filhos e mostrar uma nota única. Barra fixa de salvar, ao modo de 18. `UsuarioDetalhePagina.tsx`. | M | P3 |
| R3-29 | 16 | Os cartões "Prioridade operacional" e "Situação" têm borda de acento verde à esquerda (o conteúdo da prioridade é azul), alturas maiores que o conteúdo e vazio em baixo. "Evidências" é título solto, fora de cartão, enquanto as outras seções estão em cartões. | Hierarquia irregular. | Seções no mesmo cartão-padrão, sem acento ou com acento na cor do estado. "Evidências" dentro de um cartão, como "Tarefas vinculadas". `OcorrenciaDetalhePagina.tsx`. | P | P3 |
| R3-30 | 15 | O atraso aparece duas vezes ("atrasado há 2 dias" em vermelho e o selo "Atrasada"). "Sem prioridade definida" aparece em selo cinza em 7 de 8 linhas. | Redundância e ruído na coluna que mais importa. | Um só selo "Atrasada há 2 dias". "Sem prioridade" em texto suave, sem selo. `OcorrenciasPagina.tsx`. | P | P3 |
| R3-31 | 17 | "chegou hoje" em âmbar em todas as linhas. | A cor de atenção marca o estado normal. | Texto suave até N dias, âmbar só depois disso ("aguarda há 3 dias"). `InspecoesPagina.tsx`. | P | P3 |
| R3-32 | 11 | O "Desfazer" desabilitado leva 3 linhas de explicação em letra miúda, alinhadas à direita. | A linha fica pesada e desalinhada. | Explicação em dica (ícone (i) ao lado do botão). `ImportacoesPagina.tsx`. | P | P3 |
| R3-33 | 01 → 23 | A busca do cabeçalho muda de posição conforme o nome do usuário (x≈632 com "Gabriel Gestor", x≈614 com "Ana Administradora"): `justify-between` em `Cabecalho`. | Um elemento fixo do cabeçalho "pula" entre telas. | Cabeçalho em grade de 3 colunas (`1fr auto 1fr`), com a busca centrada e de largura fixa. `layout/Shell.tsx`. | P | P3 |

---

## (c) Agrupamento em dois lotes

A regra do CLAUDE.md (50 mil tokens por item de backlog, mais 40 mil por PR, mais 20% de folga) é cara para achados P. Proponho somar os achados em **6 itens de backlog por lote**.

### UI-1: componentes transversais, layout e shell

**Área de arquivos:** `apps/web/src/layout/`, `ui/`, `componentes/`, `mapa/` (estilo, simbologia, rótulos, coropleta), `acesso/modulos.ts`, `paginas/inventario/LayoutInventario.tsx`, `paginas/administracao/LayoutAdministracao.tsx`.

**Única exceção:** a linha 1060 de `MapaPagina.tsx` (classe do contêiner), por causa da R3-01. O UI-2 não mexe nela.

| Item de backlog | Achados |
| --- | --- |
| UI-1a Shell com altura limitada e navegação | R3-01, R3-02, R3-33 |
| UI-1b Cabeçalho de página e navegação de detalhe | R3-03 (componente), R3-04 |
| UI-1c Selos e códigos | R3-05, R3-06 |
| UI-1d Botões, recolhíveis e barra de filtros | R3-07, R3-08 (componente), R3-09 (componente) |
| UI-1e Tabelas e histórico | R3-10, R3-26 |
| UI-1f Legibilidade do mapa e notificações | R3-20, R3-22 (halo), R3-23, R3-19 (Sino) |

- **Esforço:** M a G (5 P + 9 M, cerca de 2 a 3 dias de implementação).
- **Tokens pela regra:** 6 × 50 mil + 40 mil = 340 mil; com 20% de folga, **cerca de 410 mil**.
- **Verificação:** testes de `shell.test.tsx`, `Historico.test.tsx` e `pagina.test.tsx` atualizados, mais um teste novo para a altura do Shell com e sem a faixa.

### UI-2: telas específicas

**Área de arquivos:** `paginas/` exceto os dois `Layout*.tsx`, `MapaPagina.tsx` sem a linha 1060, e `scripts/telas/` (só a semeadura de referências).

| Item de backlog | Achados |
| --- | --- |
| UI-2a Visão geral | R3-15, R3-16, R3-17, R3-18 |
| UI-2b Página do mapa | R3-21, R3-22 (legenda abre ao ligar a camada), R3-24 |
| UI-2c Listas de trabalho | R3-11, R3-30, R3-31, mais a adoção de R3-03, R3-08 e R3-09 em 05, 14, 15, 16, 17, 18, 20 e 29 |
| UI-2d Análises e Importações | R3-13, R3-14, R3-32 |
| UI-2e Catálogo e Administração | R3-12, R3-27, R3-28 |
| UI-2f Detalhes | R3-25, R3-29 |

- **Esforço:** M a G (11 P + 6 M, cerca de 2 a 3 dias).
- **Tokens pela regra:** cerca de **410 mil**, como no UI-1.
- **Dependência:** a adoção em UI-2c usa os componentes do UI-1b e do UI-1d. Ou o UI-2 começa depois do merge do UI-1, ou começa em paralelo pelos itens UI-2a, 2b, 2d, 2e e 2f e deixa o 2c para depois do rebase.
- **Capturas:** refazer depois dos dois lotes (`scripts/telas/gerar.sh`), sem subagente testando ao mesmo tempo (porta 5432).

**Total dos dois lotes: cerca de 820 mil tokens.** Ao fechar, registrar estimado e real em `docs/melhoria/estimativas.md`.

---

## (d) Os 12 achados de maior valor, em ordem

1. **R3-01**: mapa 32 px mais alto que a janela. Somem a atribuição do OSM, a escala e a ação principal da seleção por área.
2. **R3-03**: cabeçalho de página num só padrão (abas, título, ações à direita).
3. **R3-21**: painel de camadas sem padding no mapa; os dados ficam escondidos atrás dele.
4. **R3-19**: o sino diz 28 inspeções aguardando revisão, a visão geral e a fila dizem 6.
5. **R3-16**: mapa resumo da visão geral sem árvores visíveis.
6. **R3-17**: botão que estoura o cartão na visão geral.
7. **R3-02**: barra lateral sem item ativo em Alertas.
8. **R3-26**: histórico ainda com valores crus e "Em revisao" sem acento.
9. **R3-10**: tabela de árvores cortada à direita e cabeçalhos que quebram em 3 linhas.
10. **R3-05**: selos com tamanho e cor consistentes, alerta em violeta.
11. **R3-09**: filtros em uma linha e seletor de situação legível em Ocorrências.
12. **R3-20**: mapa base mais discreto, sem rótulo de bairro duplicado e com halo nos símbolos.

Fora do top 12 e baratos: R3-06 (códigos), R3-07 (alturas de botão), R3-08 (recolhíveis), R3-13 (período em Análises), R3-27 (texto contraditório em Territórios).

---

## O que já parece produto

- A faixa de demonstração está em todas as telas.
- A visão geral tem "Bairros que pedem atenção" e "Alertas e pendências" na primeira dobra.
- A ocorrência mostra o próximo passo (Concluir em destaque, Cancelar em contorno) e avisa quando está sem responsável.
- Tarefas bloqueadas mostram "Desbloquear" e o motivo junto do selo.
- O mapa em zoom afastado tem grupos por bairro limpos (02b), e a seleção por área tem contagem coerente.
- As coordenadas usam um só formato, rotulado.
