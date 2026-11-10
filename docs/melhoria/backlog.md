# Backlog de melhorias

Itens priorizados do [ciclo de melhoria](README.md). Os itens prontos saem
daqui e vão para o histórico do ciclo.

Legenda de prioridade: **P1** próxima iteração · **P2** em seguida · **P3**
quando houver espaço ou decisão.

## Produto e interface

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| M-03 | P2 | Mapa: seleção por área (RF-MAPA-022) | Criar tarefas ou exportar a partir de uma região. | Desenhar retângulo ou polígono, listar os itens e enviar para "criar tarefas" ou exportação. |
| M-04 | P2 | Mapa: círculo de incerteza (RN-MAPA-001) | Não sugerir precisão maior que a real. | Ao aproximar, pontos com precisão pior que o limiar mostram o raio. Depende do limiar (DP-06). |
| M-05 | P2 | Mapa: destacar o bairro buscado (RF-MAPA-011) | Hoje só enquadra. | Polígono realçado até a próxima interação. |
| M-06 | P2 | Mapa base em vector tiles próprios (dados OSM) | O OSM raster é carregado, e o servidor público tem política de uso restrita para produção. | Estilo claro próprio (Protomaps/PMTiles hospedado ou provedor), com glifos para rótulos nativos. Depende da DP-21 (hospedagem). |
| M-07 | P2 | Agrupamentos com a pior condição | O grupo é neutro e esconde concentrações de problema. | O anel do grupo indica a pior condição contida, com legenda. |
| M-09 | P3 | Atualização periódica das referências e Flora e Funga do Brasil | Artigos e imagens mudam, e a origem "nativa" tem fonte oficial brasileira. | Tarefa agendada (mensal) e link para a Flora e Funga do Brasil quando houver correspondência exata. |
| M-11 | P2 | Visão geral: indicadores instantâneos com tendência | Hoje só os indicadores do período comparam com o anterior; os instantâneos (ex.: espécie confirmada) não têm histórico. | Instantâneos registrados periodicamente (tarefa diária) e variação/sparkline a partir deles, com a data de cada registro. |
| M-08 | P3 | Tema de cores no restante do painel | Coerência com o novo mapa. | Tokens de `ui-tokens` revisados com contraste AA. |

## Plataforma e dependências

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| D-01 | P2 | Próxima LTS do Django | O Dependabot propôs 6.1, que não é LTS (#16 fechado). | Migrar para a próxima LTS quando sair, com o CI verde. A 5.2 tem suporte até 2028. |
| D-02 | P2 | Python 3.14+ alinhado | Imagem, CI e `.python-version` precisam usar a mesma versão (#11 fechado). | As três fontes atualizadas juntas, com a suíte verde. |
| D-03 | P2 | Node 24/26 LTS alinhado | `.nvmrc`, CI e Dockerfile (#9 fechado). | Os três atualizados juntos. |
| D-04 | P3 | Retenção e eliminação de evidências | "Remover" hoje só oculta (DP-09). | Política decidida; remoção física e retirada de EXIF implementadas. |
| D-05 | P3 | TypeScript 7 (novo compilador) | O Dependabot propôs a 7.0 e o CI falhou (#28 fechado). | Ajustar código e configuração à 7.x com typecheck, lint e testes verdes. |
