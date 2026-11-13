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
| M-16 | P3 | Papéis incomuns no mesmo usuário | Acúmulo de papéis (ex.: técnico e revisor) pode exigir atenção. Depende da matriz de perfis (DP-01). | Aviso na administração de usuários quando a combinação for marcada como incomum na DP-01. |
| M-17 | P3 | Definição oficial de "registro válido" | O cartão marca o critério como provisório. Depende da DP-14. | Texto e cálculo atualizados quando a DP-14 for fechada. |
| M-18 | P3 | Arborização do entorno: ficha do bairro e cruzamento com o inventário | A camada coroplética mostra só o percentual do Censo 2022, em dica ao passar o cursor. Não há onde ver base, definição e método por bairro, nem a comparação com as árvores cadastradas. | Clique no bairro abre ficha com proveniência completa (método, licença, ingestão). Cruzamento com a densidade do inventário só depois das fórmulas da DP-14. |
| M-25 | P3 | Resumo de notificações por e-mail e SMTP de produção | Hoje sai um e-mail por evento; o SMTP real depende da hospedagem (DP-21). | Resumo diário opcional, verificação do e-mail e SMTP configurado no ambiente. |
| M-30 | P3 | Resultado e foto quando a tarefa fecha pela ocorrência ou pela inspeção | Esses caminhos não passam pela regra de resultado e foto. Os tipos poda, remoção e plantio dependem da DP-17. | Regra decidida e aplicada nos três caminhos. |
| M-32 | P3 | Grupos de bairro: nome no mapa e clique que enquadra o bairro | O grupo mostra contagem e anel, mas o nome só aparece na dica; o clique aproxima sem enquadrar o bairro. | Rótulo do bairro no grupo e clique que ajusta o mapa ao polígono. |

## Áreas verdes

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| AV-02 | P2 | Licença das praças (CKAN sem licença) e citação oficial | A API do Fortaleza em Mapas declara uso livre com citação; o dataset equivalente no CKAN tem licença vazia. Ver DP-10. | SEUMA/URBFOR confirmam a licença e a citação; o texto de `licenca` é ajustado se necessário. |
| AV-04 | P3 | Política para áreas que sumiram da fonte | A reimportação mensal e o aviso de fonte desatualizada (60 dias) já existem, mas `importar_areas_verdes` mantém registros que sumiram da fonte (só avisa). Ver RF-INT-005. | Decidir se a área ausente é marcada como "não vista na última importação" ou removida, com o efeito no mapa e na proximidade dos focos. |
| AV-06 | P3 | Triagem de focos históricos em lote | `ingerir_focos_historico` cria os focos como "Alerta detectado", e um mês do Ceará pode trazer centenas deles nas pendências de triagem. | Estado inicial ou marca própria para carga histórica (por exemplo, "histórico"), fora das pendências, com a decisão registrada (depende do fluxo da DP-15). |
| AV-05 | P3 | Data de referência exata | A fonte só informa o ano (2019, 2023); a data gravada é 1º de janeiro desse ano, e a tela mostra só o ano. | Fonte com data exata, ou campo "ano de referência" separado no modelo. |

## Fontes públicas

Ver [fontes verificadas](../integracoes/fontes-publicas.md).

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| F-01 | P2 | Vento e chuva (INMET) para risco de queda | A API `apitempo.inmet.gov.br` não estava liberada na rede da verificação. | Host liberado, estação de Fortaleza escolhida, série ingerida com fonte, e alerta meteorológico ligado a ocorrências de queda. |
| F-05 | P3 | Flora e Funga do Brasil e MapBiomas Alerta | O site da Flora tem desafio anti-robô; o MapBiomas exige token e host liberado. | Acesso oficial (API ou acordo) e token do MapBiomas em credencial do ambiente (DP-11). |
| F-08 | P3 | PRODES Caatinga: seletor de ano e cruzamento com o inventário | A camada mostra todos os anos de uma vez, pela cor, e não diz quantas árvores cadastradas ficam junto de cada polígono. | Filtro por ano (ou intervalo) na camada e contagem de árvores cadastradas por polígono, com a escala regional declarada. |
| F-09 | P3 | Manejo da URBFOR: bairros ambíguos e restantes sem bairro | Depois dos aliases, 6,2% das árvores seguem ambíguas (Praia do Futuro I e II, Conjunto Ceará I e II, na mesma regional) e 2,3% sem bairro (sem bairro no texto, "Sítio São João", só número de imóvel). | A URBFOR informa o bairro (ou as coordenadas) desses serviços, ou o responsável decide uma regra de rateio (DP-10). |
| F-07 | P3 | Códigos CNUC das UCs municipais | APA da Sabiaguaba, ARIE Prof. Abreu Matos e ARIE da Matinha do Pici não casaram com o CNUC. | Código ou ato legal obtido da SEUMA e gravado. |

## Plataforma e dependências

| # | Prio | Item | Por quê | Pronto quando |
| --- | --- | --- | --- | --- |
| D-01 | P2 | Próxima LTS do Django | O Dependabot propôs 6.1, que não é LTS (#16 fechado). | Migrar para a próxima LTS quando sair, com o CI verde. A 5.2 tem suporte até 2028. |
| D-04 | P3 | Retenção e eliminação de evidências | "Remover" hoje só oculta (DP-09). | Política decidida; remoção física e retirada de EXIF implementadas. |
| D-05 | P3 | TypeScript 7 (novo compilador) | O Dependabot propôs a 7.0 e o CI falhou (#28 fechado). | Bloqueado pelo typescript-eslint: a 8.72 declara `typescript >=4.8.4 <6.1.0` e lança "typescript-eslint does not support TS 7.0" ao carregar (acompanhamento em typescript-eslint/typescript-eslint#10940, suporte previsto só para TS >=7.1). Com `typescript@7.0.2`, `pnpm typecheck` e `pnpm build` passam sem mudança de código; só o `pnpm lint` falha. Pronto quando o typescript-eslint suportar a 7.x e `typecheck`, `lint`, `test` e `build` passarem. Alternativa não adotada: rodar o lint com a API da 6 (`@typescript/typescript6`), que exige contornar o peer do typescript-eslint. |
