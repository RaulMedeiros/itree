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
| M-14 | P3 | Preferências de notificação e e-mail | O sino cobre o uso diário, mas não há como silenciar um tipo nem receber por e-mail. | Preferências por tipo de notificação e canal de e-mail opcional, com teste. |
| M-15 | P3 | Lista de árvores: "nunca inspecionadas primeiro" | Hoje as nunca inspecionadas ficam sempre no fim da ordenação por última inspeção. | Opção de ordenação que prioriza atraso, incluindo as nunca inspecionadas no topo. |
| M-16 | P3 | Papéis incomuns no mesmo usuário | Acúmulo de papéis (ex.: técnico e revisor) pode exigir atenção. Depende da matriz de perfis (DP-01). | Aviso na administração de usuários quando a combinação for marcada como incomum na DP-01. |
| M-17 | P3 | Definição oficial de "registro válido" | O cartão marca o critério como provisório. Depende da DP-14. | Texto e cálculo atualizados quando a DP-14 for fechada. |
| M-18 | P3 | Arborização do entorno: ficha do bairro e cruzamento com o inventário | A camada coroplética mostra só o percentual do Censo 2022, em dica ao passar o cursor. Não há onde ver base, definição e método por bairro, nem a comparação com as árvores cadastradas. | Clique no bairro abre ficha com proveniência completa (método, licença, ingestão). Cruzamento com a densidade do inventário só depois das fórmulas da DP-14. |
| M-19 | P3 | Área na URL: limite e simplificação de polígonos | O parâmetro `area` aceita até 200 vértices; um polígono desenhado à mão com mais pontos é descartado ao abrir o link. | Polígono simplificado antes de ir para a URL (tolerância documentada), com aviso quando perder detalhe. |

## Áreas verdes

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| AV-01 | P2 | Praças separadas de areninhas, calçadões e rotatórias | O mapa 99 mistura equipamentos no mesmo conjunto (18 areninhas, 5 calçadões, 1 rotatória e 27 nomes "Sem Denominação Oficial"), e hoje todos viram "praça". | Subtipo derivado da fonte (prefixo do nome ou campo), exibido na ficha e filtrável, com regra documentada. |
| AV-02 | P2 | Licença das praças (CKAN sem licença) e citação oficial | A API do Fortaleza em Mapas declara uso livre com citação; o dataset equivalente no CKAN tem licença vazia. Ver DP-10. | SEUMA/URBFOR confirmam a licença e a citação; o texto de `licenca` é ajustado se necessário. |
| AV-03 | P3 | Conferir UCs com o CNUC (MMA, cc-by) | Código e esfera do CNUC permitem validar nomes e atos legais. A API da prefeitura repete a mesma UC em várias feições (a APA do Estuário do Rio Ceará tem 4). | Código CNUC gravado nas UCs e feições da mesma UC agrupadas na exibição. |
| AV-04 | P3 | Atualização periódica e aviso de fonte desatualizada | `importar_areas_verdes` é manual e mantém registros que sumiram da fonte (só avisa). Ver RF-INT-005. | Tarefa agendada, estado "fonte desatualizada" na tela e política para registros ausentes. |
| AV-05 | P3 | Data de referência exata | A fonte só informa o ano (2019, 2023); a data gravada é 1º de janeiro desse ano, e a tela mostra só o ano. | Fonte com data exata, ou campo "ano de referência" separado no modelo. |

## Fontes públicas

Ver [fontes verificadas](../integracoes/fontes-publicas.md).

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| F-01 | P2 | Vento e chuva (INMET) para risco de queda | A API `apitempo.inmet.gov.br` não estava liberada na rede da verificação. | Host liberado, estação de Fortaleza escolhida, série ingerida com fonte, e alerta meteorológico ligado a ocorrências de queda. |
| F-02 | P3 | PRODES Caatinga (histórico anual de supressão) | Não há DETER para a Caatinga; o PRODES cobre Fortaleza, em escala regional e anual. | Camada histórica opcional, com a chave `image_date` lida e a escala declarada na legenda. |
| F-03 | P3 | Equivalência de regionais entre o CKAN e o Fortaleza em Mapas | Os códigos de regional divergem entre as duas fontes. | Tabela de equivalência documentada e usada na importação. |
| F-04 | P3 | Histórico de manejo da URBFOR (podas e supressões de 2023) e plantios de 2021 | CSVs sem coordenadas e com texto livre, em ISO-8859-1. | Indicador por bairro/regional com fonte; plantios de 2021 como lote de importação de demonstração. |
| F-05 | P3 | Flora e Funga do Brasil e MapBiomas Alerta | O site da Flora tem desafio anti-robô; o MapBiomas exige token e host liberado. | Acesso oficial (API ou acordo) e token do MapBiomas em credencial do ambiente (DP-11). |

## Plataforma e dependências

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| D-01 | P2 | Próxima LTS do Django | O Dependabot propôs 6.1, que não é LTS (#16 fechado). | Migrar para a próxima LTS quando sair, com o CI verde. A 5.2 tem suporte até 2028. |
| D-04 | P3 | Retenção e eliminação de evidências | "Remover" hoje só oculta (DP-09). | Política decidida; remoção física e retirada de EXIF implementadas. |
| D-05 | P3 | TypeScript 7 (novo compilador) | O Dependabot propôs a 7.0 e o CI falhou (#28 fechado). | Ajustar código e configuração à 7.x com typecheck, lint e testes verdes. |
