# Engine de Inteligência Arbórea

## Especificação consolidada do projeto --- versão de trabalho

**Status:** definição funcional e exploração visual\
**Território inicial:** Município de Fortaleza, Ceará, Brasil\
**Plataformas:** aplicativo móvel para equipes de campo e painel web
desktop para gestão\
**Diretriz visual:** C --- Field Operations\
**Princípio de produto:** inteligência geoespacial e ambiental com dados
rastreáveis, IA assistiva e operação de campo resiliente à
conectividade.

------------------------------------------------------------------------

## 1. Visão do produto

O Engine de Inteligência Arbórea é uma plataforma municipal para
inventariar, inspecionar, monitorar e gerir árvores e áreas verdes,
integrando dados de campo, geolocalização, imagens, bases públicas,
sensores e recursos de inteligência artificial.

A plataforma deve atender a dois contextos complementares:

-   **Operação de campo:** técnicos localizam árvores, realizam
    inspeções, registram evidências e trabalham mesmo sem conexão.
-   **Gestão municipal:** gestores visualizam o inventário, acompanham
    ocorrências, analisam indicadores territoriais, distribuem tarefas e
    produzem relatórios.

O sistema também poderá incorporar monitoramento ambiental territorial,
incluindo sinais de queimadas e alterações na cobertura vegetal. Esses
sinais devem ser tratados como alertas para análise, não como
confirmação automática de infração.

### Objetivos principais

1.  Construir e manter um inventário georreferenciado da arborização
    municipal.
2.  Padronizar inspeções e registros técnicos.
3.  Acompanhar condições aparentes, ocorrências e intervenções.
4.  Apoiar a priorização operacional por território e criticidade.
5.  Integrar dados públicos ambientais e cartográficos.
6.  Aplicar IA para apoiar identificação, preenchimento e análise,
    mantendo validação humana.
7.  Oferecer rastreabilidade de dados, evidências, alterações e
    sincronizações.

------------------------------------------------------------------------

## 2. Escopo e premissas já definidos

  -----------------------------------------------------------------------
  Tema                                Definição
  ----------------------------------- -----------------------------------
  Abrangência territorial             Municipal, com Fortaleza como
                                      território inicial

  Plataformas                         Aplicativo móvel e painel web
                                      desktop

  Jornada prioritária                 Inspeção de árvore em campo

  Operação offline                    Essencial para os fluxos de campo

  Inteligência artificial             Assistiva; não substitui decisão
                                      técnica

  Mapa                                Camadas de ruas e satélite

  Georreferenciamento                 GPS, geometria e contexto
                                      territorial

  Evidências                          Fotografias e registros associados
                                      à inspeção

  Gestão de acesso                    Perfis, papéis e permissões

  Direção visual                      Field Operations: clara,
                                      operacional, orientada a mapa e
                                      tarefas
  -----------------------------------------------------------------------

### Premissas de confiabilidade

-   Não exibir indicadores fictícios como se fossem dados reais.
-   Identificar claramente dados medidos, estimados, inferidos e
    importados.
-   Exibir fonte, data de atualização e limitações dos dados externos.
-   Não transformar uma detecção remota em confirmação de ilegalidade.
-   Não apresentar diagnóstico estrutural definitivo a partir de uma
    fotografia.
-   Não executar fusão ou exclusão automática de registros duplicados.
-   Exibir o estado real de armazenamento local e sincronização.

------------------------------------------------------------------------

## 3. Arquitetura de navegação

### 3.1 Painel web desktop

Navegação principal proposta:

1.  **Visão geral**
2.  **Mapa**
3.  **Inventário**
4.  **Inspeções**
5.  **Ocorrências**
6.  **Equipes e tarefas**
7.  **Análises e relatórios**
8.  **Administração**

Acesso a sensores, integrações, intervenções e qualidade de dados pode
ocorrer por módulos secundários ou dentro dos módulos relacionados.

### 3.2 Aplicativo móvel

Navegação principal proposta:

1.  **Início**
2.  **Mapa**
3.  **Inspecionar**
4.  **Inventário**

Tarefas atribuídas, ocorrências, notificações e sincronização devem
estar disponíveis a partir da tela inicial e dos fluxos contextuais.

### 3.3 Relação entre plataformas

-   O desktop é orientado à gestão, análise territorial, supervisão e
    configuração.
-   O aplicativo móvel é orientado à execução de tarefas, inspeção,
    captura de evidências e consulta em campo.
-   Ambos consomem o mesmo modelo de dados e respeitam as permissões do
    usuário.
-   Alterações feitas offline no aplicativo são sincronizadas
    posteriormente e mantêm histórico de origem.

------------------------------------------------------------------------

## 4. Especificação funcional das telas

## 4.1 Visão geral --- desktop

**Objetivo:** oferecer uma leitura operacional e territorial do estado
da arborização e das atividades municipais.

### Componentes previstos

-   Indicadores de árvores cadastradas.
-   Inspeções pendentes, atrasadas e concluídas.
-   Distribuição por espécie, quando houver classificação confiável.
-   Distribuição por condição aparente registrada.
-   Ocorrências abertas e por prioridade.
-   Completude e qualidade do inventário.
-   Mapa de distribuição de árvores e ocorrências.
-   Alertas ambientais provenientes de fontes identificadas.
-   Desempenho operacional por equipe e período.
-   Atividades e atualizações recentes.

### Regras

-   Cada indicador deve ter definição, período, filtros e fonte.
-   Distinguir quantidade total de registros de quantidade de registros
    válidos.
-   Não inferir condição de saúde quando não houver inspeção ou
    evidência suficiente.
-   Não misturar alertas externos com ocorrências confirmadas.

## 4.2 Mapa geoespacial --- desktop e mobile

**Objetivo:** explorar árvores, ocorrências e contexto territorial.

### Funcionalidades

-   Alternância entre mapa de ruas e imagem de satélite.
-   Camadas de árvores, inspeções, ocorrências e tarefas.
-   Camadas territoriais e ambientais disponíveis.
-   Filtros por espécie, condição aparente, período, status e equipe.
-   Busca por identificador, endereço, bairro ou coordenada.
-   Seleção de árvore ou ocorrência para abrir painel contextual.
-   Visualização de agrupamentos quando houver alta densidade de pontos.
-   Exibição da origem e precisão disponível da localização.
-   Registro de localização GPS no momento da inspeção.

### Regras

-   Não sugerir precisão maior que a do dado de origem.
-   Diferenciar localização coletada em campo de localização importada
    ou estimada.
-   Informar data da imagem de satélite quando essa informação estiver
    disponível.
-   Camadas indisponíveis ou desatualizadas devem ser identificadas.

## 4.3 Inventário arbóreo

**Objetivo:** manter o cadastro individual e histórico de cada árvore.

### Dados previstos

-   Identificador único.
-   Identificadores externos, quando existirem.
-   Espécie comum e científica, com nível de confiança ou validação.
-   Coordenadas e endereço/bairro.
-   Características dendrométricas: altura, diâmetro e outras medidas
    aplicáveis.
-   Condição aparente observada.
-   Fotografias e documentos.
-   Data e responsável pelo cadastro.
-   Histórico de inspeções.
-   Histórico de ocorrências e intervenções.
-   Origem e qualidade dos dados.

### Regras

-   Medidas devem indicar método, unidade, data e responsável.
-   Valores estimados devem ser explicitamente marcados como
    estimativas.
-   Identificações taxonômicas sugeridas por IA aguardam validação
    quando necessário.
-   Possíveis duplicidades são apresentadas para revisão humana.
-   A exclusão e fusão de registros devem ser auditáveis.

## 4.4 Inspeções --- jornada prioritária

**Objetivo:** permitir que o técnico execute uma inspeção padronizada em
campo.

### Fluxo proposto

1.  Localizar a árvore pelo mapa, tarefa, busca ou leitura de
    identificador.
2.  Confirmar se o registro corresponde à árvore observada.
3.  Registrar ou confirmar localização GPS.
4.  Capturar fotografias e outras evidências.
5.  Preencher espécie e características observáveis.
6.  Registrar medidas e método de medição.
7.  Avaliar condição aparente com critérios padronizados.
8.  Registrar observações e eventual ocorrência.
9.  Revisar os dados.
10. Salvar localmente ou enviar para sincronização.

### Campos e evidências

-   Data e hora.
-   Técnico responsável.
-   Identificador da árvore.
-   Coordenadas e precisão GPS, se disponível.
-   Fotografias com vínculo à inspeção.
-   Espécie identificada ou sugerida.
-   Medidas e respectivas unidades.
-   Condição aparente e sinais observados.
-   Observações técnicas.
-   Necessidade de revisão ou encaminhamento.

### Estados de inspeção

-   Rascunho.
-   Pendente de sincronização.
-   Sincronizando.
-   Sincronizada.
-   Em revisão.
-   Devolvida para correção.
-   Validada.

**Importante:** estado de sincronização e estado do processo de negócio
são dimensões diferentes. Uma inspeção pode estar validada no fluxo de
negócio e ainda exigir representação própria de sincronização em
dispositivos, ou vice-versa.

## 4.5 Identificação assistida por IA

**Objetivo:** sugerir espécies e apoiar a captura de dados.

### Funcionalidades realistas

-   Sugestão de espécie a partir de fotografias.
-   Exibição de alternativas quando a imagem não for conclusiva.
-   Indicação de qualidade insuficiente da imagem.
-   Orientação sobre fotografias adicionais necessárias.
-   Registro do modelo e versão usados na inferência.
-   Confirmação ou correção por usuário habilitado.

### Limitações e segurança

-   A IA não deve afirmar uma espécie quando a evidência for
    insuficiente.
-   Não apresentar percentuais de confiança sem calibração e validação
    do modelo.
-   A sugestão deve ser distinguida de uma identificação confirmada.
-   O resultado da IA deve ser armazenado como inferência, não
    sobrescrever silenciosamente o cadastro validado.

## 4.6 Assistente visual de inspeção

**Objetivo:** destacar sinais visíveis que merecem atenção do técnico.

Exemplos de sinais que podem ser apontados, dependendo da qualidade da
imagem:

-   Folhagem escassa ou descoloração.
-   Feridas ou danos visíveis.
-   Presença aparente de fungos ou estruturas suspeitas.
-   Inclinação perceptível.
-   Danos em tronco ou galhos.

A interface deve usar linguagem como "sinal visual possível" ou "requer
avaliação". Não deve produzir diagnóstico fitossanitário definitivo nem
concluir risco de queda ou segurança estrutural apenas pela fotografia.

## 4.7 Medições assistidas por visão computacional

**Objetivo:** reduzir esforço de preenchimento quando houver condições
técnicas adequadas.

-   Estimativas de dimensões somente quando houver escala, calibração ou
    método validado.
-   Distinguir claramente medida manual, medida instrumental e
    estimativa computacional.
-   Permitir correção humana.
-   Registrar método, unidade, condições e origem.

Não apresentar medidas métricas precisas obtidas de uma fotografia comum
sem referência de escala ou calibração.

## 4.8 Ocorrências e riscos

**Objetivo:** registrar situações que demandem avaliação ou ação
municipal.

### Campos

-   Tipo de ocorrência.
-   Árvore ou área relacionada.
-   Localização.
-   Descrição.
-   Evidências.
-   Data e origem do registro.
-   Prioridade operacional.
-   Responsável ou equipe.
-   Prazo e estado.
-   Histórico de encaminhamentos.

### Distinções obrigatórias

-   **Condição aparente:** o que foi observado.
-   **Prioridade operacional:** ordem de atendimento definida pela
    gestão.
-   **Risco confirmado:** conclusão que depende de avaliação técnica
    competente.

## 4.9 Equipes e tarefas

**Objetivo:** organizar a execução das atividades de campo.

-   Cadastro de equipes e membros.
-   Atribuição de inspeções e ocorrências.
-   Lista de tarefas por responsável, território e prazo.
-   Estados de execução.
-   Histórico de atribuições.
-   Acompanhamento de pendências e produtividade.
-   Rotas como recurso futuro, condicionado à qualidade dos dados e
    conectividade.

## 4.10 Análises e relatórios

**Objetivo:** transformar dados validados em indicadores para gestão.

Indicadores possíveis:

-   Árvores cadastradas por bairro.
-   Inspeções por período e equipe.
-   Percentual de registros com localização válida.
-   Distribuição das condições aparentes registradas.
-   Ocorrências por tipo, estado e prioridade.
-   Tempo entre abertura e atendimento de ocorrência.
-   Evolução do inventário e da cobertura de inspeções.
-   Alertas ambientais por fonte, período e território.

Exportações previstas: CSV, XLSX, PDF e GeoJSON, conforme o tipo de dado
e as permissões.

## 4.11 Sensores e monitoramento

**Objetivo:** integrar dispositivos de monitoramento quando houver
implantação física.

-   Cadastro de dispositivo e localização.
-   Tipo de sensor e unidade.
-   Série temporal de medições.
-   Estado de conectividade.
-   Alertas por limites configurados.
-   Histórico de manutenção e calibração.

Sensores são uma evolução posterior e dependem de hardware,
conectividade, contratos de dados e operação de manutenção.

## 4.12 Administração

-   Usuários, equipes e papéis.
-   Permissões por módulo e escopo territorial.
-   Catálogo de espécies e parâmetros de inspeção.
-   Configuração de tipos e estados de ocorrência.
-   Integrações e credenciais.
-   Auditoria de alterações.
-   Gestão de dispositivos e sincronização.
-   Configuração de notificações.

------------------------------------------------------------------------

## 5. Operação offline e sincronização

A operação offline é requisito essencial para inspeções de campo.

### Capacidades offline prioritárias

-   Consultar dados previamente armazenados no dispositivo.
-   Criar e editar rascunhos de inspeção.
-   Capturar fotografias e associá-las à inspeção.
-   Registrar coordenadas GPS quando disponíveis no dispositivo.
-   Guardar alterações em fila local.
-   Exibir claramente o estado de cada registro.
-   Retomar envio após perda ou retorno de conectividade.

### Requisitos técnicos

-   Identificadores locais únicos para registros criados offline.
-   Fila persistente de sincronização.
-   Retentativas idempotentes, evitando duplicação.
-   Confirmação de recebimento pelo servidor.
-   Tratamento explícito de conflitos.
-   Registro de data, dispositivo, usuário e origem da alteração.
-   Indicadores de espaço local e itens pendentes, quando suportados.

### Limites

-   Recursos de IA que dependam de serviços em nuvem não estarão
    disponíveis sem conexão, salvo se houver modelo local implementado.
-   Mapas offline completos e otimização de rotas não são pressupostos
    do primeiro lançamento.
-   O aplicativo deve informar quando uma camada ou dado não foi baixado
    para uso offline.

------------------------------------------------------------------------

## 6. Inteligência artificial --- escopo e prioridade

  ------------------------------------------------------------------------
  Capacidade                     Prioridade proposta Papel da IA
  --------------------- ---------------------------- ---------------------
  Sugestão de espécie          P0/P1, após validação Recomendar
  por imagem                                 técnica alternativas

  Apoio visual à        P0/P1, com escopo controlado Destacar sinais
  inspeção                                           observáveis

  Qualidade e                                     P0 Detectar campos
  completude de dados                                inconsistentes

  Possíveis registros                             P0 Sugerir pares para
  duplicados                                         revisão

  Estimativa de medidas                           P1 Estimar somente com
  por imagem                                         calibração

  Priorização de                                  P1 Apoiar ordenação com
  inspeções                                          critérios explicáveis

  Inteligência                                    P1 Cruzar indicadores e
  territorial                                        camadas

  Copiloto de gestão                              P1 Consultar dados e
  municipal                                          explicar indicadores

  Relatórios técnicos                             P1 Gerar rascunhos com
  assistidos                                         fontes rastreáveis
  ------------------------------------------------------------------------

### Regras transversais para IA

1.  Identificar conteúdo gerado por IA.
2.  Exibir fonte e data dos dados usados.
3.  Permitir revisão e correção humana.
4.  Registrar versão do modelo e resultado original.
5.  Não inventar medições, eventos ou indicadores.
6.  Não converter correlação em causalidade.
7.  Não emitir conclusão legal ou diagnóstico técnico sem validação
    competente.

------------------------------------------------------------------------

## 7. Dados públicos e integrações

A plataforma pode combinar dados próprios do município com fontes
públicas. A disponibilidade, cobertura, formato, licença e frequência
devem ser verificadas antes de cada integração produtiva.

### 7.1 Fontes prioritárias

  -----------------------------------------------------------------------
  Fonte                   Uso no Engine           Forma de acesso /
                                                  observação
  ----------------------- ----------------------- -----------------------
  INPE --- BDQueimadas    Focos de calor e        Dados abertos para
                          alertas de possível     download em formatos
                          fogo                    como CSV/KML; verificar
                                                  produto e periodicidade

  INPE --- TerraBrasilis  Produtos de             Serviços geográficos
                          monitoramento de        OGC, incluindo WFS, e
                          supressão e alterações  downloads; cobertura
                          da vegetação            varia por produto

  MapBiomas Alerta        Alertas de supressão,   API GraphQL
                          detalhes e laudos       documentada;
                          disponíveis             autenticação/token
                                                  conforme documentação

  Fortaleza Dados Abertos Limites, bairros,       API CKAN para busca de
                          praças, vias e          conjuntos e metadados;
                          conjuntos municipais    recursos podem ter
                                                  formatos distintos

  Fortaleza em Mapas      Camadas e cartografia   Portal geográfico e
                          municipal               downloads; avaliar
                                                  serviços por camada

  Fortaleza em Bairros    Contexto territorial e  Portal municipal e
                          dados por bairro        dados associados

  SEUMA / Fortaleza       Licenciamento e         Verificar campos
  Online                  informações ambientais  espaciais, formatos e
                          publicadas              possibilidade de
                                                  integração automatizada

  MapBiomas Cobertura e   Série histórica de      Downloads e integração
  Uso                     cobertura e uso da      por ferramentas
                          terra                   geoespaciais;
                                                  atualização por coleção
  -----------------------------------------------------------------------

### 7.2 Endereços de referência

-   INPE Queimadas: https://data.inpe.br/queimadas/
-   INPE dados abertos:
    https://data.inpe.br/queimadas/pages/secao_downloads/dados-abertos/
-   TerraBrasilis: https://terrabrasilis.dpi.inpe.br/
-   TerraBrasilis WFS/OWS:
    https://terrabrasilis.dpi.inpe.br/geoserver/ows
-   MapBiomas Alerta API:
    https://plataforma.alerta.mapbiomas.org/api/docs/index.html
-   MapBiomas: https://brasil.mapbiomas.org/
-   Fortaleza Dados Abertos: https://dados.fortaleza.ce.gov.br/
-   Fortaleza em Mapas: https://mapas.fortaleza.ce.gov.br/
-   Fortaleza em Bairros:
    https://fortalezaembairros.fortaleza.ce.gov.br/bairros
-   SEUMA --- conjuntos de dados:
    https://dados.fortaleza.ce.gov.br/organization/seuma
-   Fortaleza Online:
    https://portal.seuma.fortaleza.ce.gov.br/fortalezaonline/portal/listaservicos.jsf?hash=publicacaolicencaambiental
-   Plano Diretor:
    https://planodiretor.fortaleza.ce.gov.br/ords/r/diretor/plano-diretor/home

### 7.3 Exemplo de consulta à API CKAN

Pesquisa de conjuntos relacionados a áreas verdes:

``` bash
curl "https://dados.fortaleza.ce.gov.br/api/3/action/package_search?q=areas%20verdes&rows=10"
```

Endpoint base:

``` text
https://dados.fortaleza.ce.gov.br/api/3/action/
```

A API CKAN permite localizar conjuntos e metadados. A consulta dos dados
propriamente ditos depende do formato e do recurso publicado em cada
conjunto.

### 7.4 Fluxo para alertas ambientais

1.  Ingerir o evento ou polígono da fonte externa.
2.  Armazenar fonte, identificador externo, data de detecção e data de
    ingestão.
3.  Normalizar geometria e sistema de coordenadas.
4.  Cruzar com bairros, áreas protegidas, zoneamento e demais camadas
    municipais disponíveis.
5.  Consultar licenças ou autorizações quando houver dados acessíveis e
    espacialmente compatíveis.
6.  Criar alerta para triagem humana.
7.  Registrar análise, encaminhamento e eventual confirmação pela
    autoridade competente.

### 7.5 Vocabulário de status recomendado

-   **Alerta detectado:** sinal produzido por fonte externa ou
    algoritmo.
-   **Em triagem:** aguardando análise.
-   **Requer verificação:** evidência insuficiente ou contexto
    inconclusivo.
-   **Compatível com autorização localizada:** foi encontrada referência
    de licença potencialmente relacionada; validade, polígono e
    condições ainda precisam ser verificados.
-   **Encaminhado à fiscalização:** enviado para avaliação da
    autoridade.
-   **Confirmado pela autoridade:** confirmação formal registrada.
-   **Descartado:** alerta analisado e considerado não procedente, com
    justificativa.

**Regra crítica:** detecção por satélite, foco de calor ou ausência de
licença encontrada em uma base não prova, por si só, ilegalidade.
Produtos do INPE monitoram alterações e apoiam fiscalização; não
determinam automaticamente a legalidade de cada evento.

------------------------------------------------------------------------

## 8. Modelo conceitual de dados

Entidades principais previstas:

-   **Município / território:** limites administrativos e subdivisões.
-   **Árvore:** cadastro individual georreferenciado.
-   **Inspeção:** visita técnica e observações realizadas.
-   **Evidência:** fotografia, documento ou outro arquivo associado.
-   **Inferência de IA:** sugestão, modelo, versão e resultado.
-   **Ocorrência:** evento que exige avaliação ou ação.
-   **Tarefa:** atividade atribuída a uma pessoa ou equipe.
-   **Usuário / perfil:** identidade, papel e permissões.
-   **Equipe:** agrupamento operacional.
-   **Espécie:** catálogo taxonômico.
-   **Dispositivo / sincronização:** origem local, fila e estado de
    transmissão.
-   **Camada geográfica:** fonte, geometria, data e metadados.
-   **Auditoria:** histórico de alterações e decisões.

Relações essenciais:

-   Uma árvore pode ter muitas inspeções.
-   Uma inspeção pode conter muitas evidências e inferências de IA.
-   Uma árvore pode estar associada a várias ocorrências e tarefas ao
    longo do tempo.
-   Uma tarefa pode ser atribuída a uma equipe ou usuário.
-   Uma ocorrência externa deve manter referência à fonte original.
-   Alterações importantes devem gerar eventos de auditoria.

------------------------------------------------------------------------

## 9. Priorização de desenvolvimento

### P0 --- fundação operacional

-   Autenticação e permissões.
-   Cadastro e consulta de árvores.
-   Mapa básico com ruas e satélite.
-   Aplicativo móvel de inspeção.
-   Captura de fotos, GPS e medidas.
-   Persistência offline e sincronização.
-   Histórico e proveniência dos dados.
-   Ocorrências básicas.
-   Gestão de erros e conflitos de sincronização.

### P1 --- gestão e inteligência assistiva

-   Painel de indicadores.
-   Fluxo de revisão e validação.
-   Identificação de espécies assistida por IA.
-   Apoio visual à inspeção.
-   Equipes e tarefas.
-   Filtros geoespaciais avançados.
-   Integrações públicas prioritárias.
-   Relatórios e exportações.
-   Qualidade de dados e sugestões de duplicidade.
-   Priorização assistida de inspeções.

### P2 --- capacidades avançadas

-   Mapas offline completos.
-   Otimização de rotas.
-   Análises GIS avançadas.
-   Integração com sensores.
-   Detecção de padrões em imagens históricas.
-   Modelos preditivos, após validação dos dados e metodologia.
-   Copiloto de gestão e relatórios assistidos em escala.

------------------------------------------------------------------------

## 10. Direção visual e telas exploradas

### 10.1 Direção visual

A direção escolhida é **C --- Field Operations**.

Características visuais desejadas:

-   Interface funcional e orientada à execução.
-   Hierarquia clara de informação.
-   Mapa como elemento central em telas territoriais.
-   Cartões de indicadores compactos.
-   Estados operacionais legíveis.
-   Paleta associada a natureza e gestão ambiental, sem sacrificar
    contraste.
-   Desktop denso o suficiente para análise; mobile simples para uso em
    campo.
-   Componentes consistentes entre as duas plataformas.

### 10.2 Conceitos visuais já explorados

As imagens conceituais produzidas até aqui exploraram:

1.  **Painel geral desktop + mobile:** indicadores, mapa de Fortaleza,
    alertas e visão operacional.
2.  **Painel de funcionalidades:** visão geral, mapa interativo,
    inventário, indicadores ambientais, condição arbórea, ocorrências,
    planejamento, relatórios e operação de campo.
3.  **Adaptação para Fortaleza:** contexto urbano e costeiro, bairros e
    indicadores municipais.
4.  **Monitoramento de desmatamento e queimadas:** alertas, mapa
    satelital, camadas e lista de eventos.

Essas imagens são referências de direção visual e organização da
interface. Não representam uma especificação final aprovada, nem dados
reais. Números, marcadores e alertas nelas apresentados devem ser
considerados ilustrativos.

### 10.3 Telas que precisam de exploração visual detalhada

**Desktop** - Visão geral municipal. - Mapa geoespacial com camadas e
painel contextual. - Lista e detalhe do inventário. - Detalhe de árvore
e histórico. - Gestão de inspeções e revisão. - Ocorrências e alertas
ambientais. - Equipes e tarefas. - Indicadores e relatórios. -
Administração e integrações.

**Mobile** - Início e tarefas do dia. - Mapa e busca de árvore. -
Detalhe de árvore. - Fluxo de inspeção passo a passo. - Captura e
revisão de fotografias. - Sugestão de identificação por IA. - Registro
de ocorrência. - Fila offline e estado de sincronização.

### 10.4 Regras para futuras gerações de UI

-   Usar dados fictícios apenas quando claramente identificados como
    demonstração.
-   Não exibir percentuais de IA sem base de calibração.
-   Não desenhar funcionalidades que dependam de infraestrutura ainda
    não definida como se já estivessem disponíveis.
-   Representar corretamente os estados offline e de sincronização.
-   Separar alertas externos de ocorrências confirmadas.
-   Não usar mapas com polígonos ou marcadores que sugiram precisão real
    sem fonte.
-   Manter coerência entre telas desktop e mobile.

------------------------------------------------------------------------

## 11. Critérios de aceite funcionais iniciais

### Inspeção offline

-   O técnico consegue iniciar e salvar uma inspeção sem internet.
-   Fotografias ficam associadas ao registro correto.
-   O aplicativo informa que os dados ainda não foram sincronizados.
-   Ao recuperar conexão, o sistema transmite os dados sem criar
    duplicatas.
-   Falhas e conflitos ficam visíveis e podem ser tratados.

### Inventário

-   Cada árvore possui identificador único.
-   A localização registra origem e precisão quando disponíveis.
-   O histórico de inspeções é consultável.
-   Valores estimados são diferenciados de medidas.
-   Sugestões de IA não sobrescrevem dados validados sem ação explícita.

### Alertas ambientais

-   Cada alerta mantém fonte e identificador externo.
-   Data de detecção e data de ingestão são distintas.
-   O mapa mostra a geometria recebida sem sugerir precisão inexistente.
-   O sistema não classifica automaticamente o evento como ilegal.
-   A análise e o encaminhamento humano ficam registrados.

### Indicadores

-   Todo indicador possui definição e período.
-   Filtros alteram os resultados de forma consistente.
-   Dados ausentes não são convertidos em zero sem regra explícita.
-   A tela informa quando uma fonte está desatualizada ou indisponível.

------------------------------------------------------------------------

## 12. Decisões pendentes

Os itens abaixo ainda precisam de decisão antes de congelar a
especificação e iniciar implementação:

1.  Perfis definitivos e matriz de permissões.
2.  Taxonomia oficial e catálogo de espécies a adotar.
3.  Protocolo técnico de inspeção e escalas de condição aparente.
4.  Campos obrigatórios por tipo de inspeção.
5.  Regras de validação e assinatura técnica.
6.  Sistema de referência espacial e padrões de geometria.
7.  Provedor de mapas e política de cache/offline.
8.  Infraestrutura de armazenamento de imagens.
9.  Política de retenção, privacidade e acesso a fotografias e
    localização.
10. Fontes municipais oficiais e responsáveis por cada conjunto de
    dados.
11. Credenciais, limites e condições de uso das APIs externas.
12. Requisitos de interoperabilidade com sistemas municipais existentes.
13. Critérios de calibração e validação dos modelos de IA.
14. Indicadores oficiais e fórmulas de cálculo.
15. Fluxo institucional para encaminhamento e confirmação de infrações
    ambientais.

------------------------------------------------------------------------

## 13. Próximo passo recomendado

Antes de implementar, fechar a especificação operacional da inspeção e
validar visualmente as telas centrais:

1.  Mapa desktop.
2.  Detalhe de árvore.
3.  Inspeção mobile, incluindo operação offline.
4.  Ocorrências e alertas ambientais.
5.  Visão geral municipal.

Após aprovação dessas telas, consolidar o design system, os contratos de
API, o modelo de dados e os critérios de aceite técnicos.

------------------------------------------------------------------------

**Estado deste documento:** consolidação do que foi definido e explorado
na conversa. Os itens identificados como propostos, futuros ou pendentes
não devem ser tratados como decisões já aprovadas.
