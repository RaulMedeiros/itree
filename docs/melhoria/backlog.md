# Backlog de melhorias

Itens priorizados do [ciclo de melhoria](README.md). Os itens prontos saem
daqui e vão para o histórico do ciclo.

Legenda de prioridade: **P1** próxima iteração · **P2** em seguida · **P3**
quando houver espaço ou decisão.

## Produto e interface

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| M-04 | P2 | Mapa: círculo de incerteza (RN-MAPA-001) | Não sugerir precisão maior que a real. | Ao aproximar, pontos com precisão pior que o limiar mostram o raio. Depende do limiar (DP-06). |
| M-06 | P2 | Mapa base em vector tiles próprios (dados OSM) | O OSM raster é carregado, e o servidor público tem política de uso restrita para produção. | Estilo claro próprio (Protomaps/PMTiles hospedado ou provedor), com glifos para rótulos nativos. Depende da DP-21 (hospedagem). |
| M-12 | P3 | Seleção por área: persistência e toque | A área não vai para a URL (abrir um item perde a seleção) e o retângulo não funciona com toque. | Área codificada na URL e restaurada; arrasto por toque; clicar numa árvore com área ativa abre o painel da árvore. |
| M-13 | P2 | Achados da crítica das telas de 2026-11-11 que não couberem nos lotes | Ver [crítica](criticas/2026-11-11-telas.md). | Cada achado restante vira item próprio aqui, com critério de pronto. |

## Áreas verdes

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| AV-01 | P2 | Praças separadas de areninhas, calçadões e rotatórias | O mapa 99 mistura equipamentos no mesmo conjunto (18 areninhas, 5 calçadões, 1 rotatória e 27 nomes "Sem Denominação Oficial"), e hoje todos viram "praça". | Subtipo derivado da fonte (prefixo do nome ou campo), exibido na ficha e filtrável, com regra documentada. |
| AV-02 | P2 | Licença das praças (CKAN sem licença) e citação oficial | A API do Fortaleza em Mapas declara uso livre com citação; o dataset equivalente no CKAN tem licença vazia. Ver DP-10. | SEUMA/URBFOR confirmam a licença e a citação; o texto de `licenca` é ajustado se necessário. |
| AV-03 | P3 | Conferir UCs com o CNUC (MMA, cc-by) | Código e esfera do CNUC permitem validar nomes e atos legais. A API da prefeitura repete a mesma UC em várias feições (a APA do Estuário do Rio Ceará tem 4). | Código CNUC gravado nas UCs e feições da mesma UC agrupadas na exibição. |
| AV-04 | P3 | Atualização periódica e aviso de fonte desatualizada | `importar_areas_verdes` é manual e mantém registros que sumiram da fonte (só avisa). Ver RF-INT-005. | Tarefa agendada, estado "fonte desatualizada" na tela e política para registros ausentes. |
| AV-05 | P3 | Data de referência exata | A fonte só informa o ano (2019, 2023); a data gravada é 1º de janeiro desse ano, e a tela mostra só o ano. | Fonte com data exata, ou campo "ano de referência" separado no modelo. |

## Plataforma e dependências

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| D-01 | P2 | Próxima LTS do Django | O Dependabot propôs 6.1, que não é LTS (#16 fechado). | Migrar para a próxima LTS quando sair, com o CI verde. A 5.2 tem suporte até 2028. |
| D-04 | P3 | Retenção e eliminação de evidências | "Remover" hoje só oculta (DP-09). | Política decidida; remoção física e retirada de EXIF implementadas. |
| D-05 | P3 | TypeScript 7 (novo compilador) | O Dependabot propôs a 7.0 e o CI falhou (#28 fechado). | Ajustar código e configuração à 7.x com typecheck, lint e testes verdes. |
