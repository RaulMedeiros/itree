# Documentação do iTree

Mapa de todos os documentos. Para quem chega, comece pelo [README da raiz](../README.md).

## Comece por aqui

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Rumo do produto, 21/11/2026](decisoes/2026-11-21-rumo-do-produto.md) | As 12 decisões que definem o foco atual: pesquisa e ONG, detecção automática, 3-30-300, nada público | Antes de propor qualquer funcionalidade |
| [Desenvolvimento](desenvolvimento.md) | Testes, verificação da CI, contrato da API, migrações, capturas e variáveis de ambiente | Antes de abrir um PR |
| [Arquitetura](arquitetura/README.md) | Diagramas de contexto, contêineres e componentes; apps, tarefas Celery, fluxos | Para entender como as peças se ligam |
| [Infraestrutura](../infra/README.md) | Imagens, compose, variáveis do painel e checklist de produção | Para subir ou implantar |
| [Backend](../backend/README.md) | Estrutura do backend, comandos e permissões | Para mexer na API |
| [Segurança](../SECURITY.md) | Como reportar uma vulnerabilidade | Ao achar uma falha |

## Decisões

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Decisões pendentes](decisoes/pendentes.md) | Lista das DP, com status. Não se antecipa o que está aberto | Antes de decidir qualquer coisa de produto |
| [Rumo do produto, 21/11/2026](decisoes/2026-11-21-rumo-do-produto.md) | Decisões que fecharam DP-14, DP-18, DP-21 e outras | Idem |
| [ADR-0001: stack técnica](adr/0001-stack-tecnica.md) | Por que Django, PostGIS, React e o resto | Ao questionar uma tecnologia |
| [ADR-0002: identidade e autorização](adr/0002-identidade-e-autorizacao.md) | Login no provedor OIDC, permissões na aplicação | Ao mexer em acesso |
| [Índice dos ADRs](adr/README.md) | Status de cada ADR | Ao criar uma ADR |

## Especificações

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Índice das specs](specs/README.md) | Mapa das specs do web (W-00 a W-10) e transversais (T-01 a T-06) | Para achar a spec de uma tela |
| [Specs do web](specs/web/00-escopo-e-fases.md) | Uma spec por módulo: mapa, inventário, ocorrências, inspeções, visão geral, equipes e tarefas, alertas, análises e administração | Ao mudar uma tela |
| [Specs transversais](specs/transversal/01-proveniencia-confiabilidade.md) | Proveniência, modelo de dados, acesso, IA assistiva, integrações e não funcionais | Ao mudar regra que vale em todo o produto |
| [Especificação consolidada v1](referencia/especificacao-consolidada-v1.md) | Fonte original das specs. **Não se edita**; divergências são tratadas nas specs | Só para consultar a origem |

## Dados, fontes e indicadores

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Integrações: índice](integracoes/README.md) | Uma linha por fonte: estado, comando, periodicidade e licença | Para saber o que entra e quando |
| [Fontes públicas](integracoes/fontes-publicas.md) | Endereços, volumes verificados e modo de usar cada fonte | Ao importar ou depurar uma fonte |
| [Detecção automática](integracoes/deteccao-automatica.md) | Contrato de dados e recebimento dos lotes do projeto de detecção | Ao integrar o projeto de detecção |
| [Regra 3-30-300](indicadores/3-30-300.md) | Método, fontes e limites do indicador | Ao mexer ou citar um indicador |
| [Verificação das fontes, 11/11/2026](integracoes/verificacao-fontes-2026-11-11.md) | Histórico: relatório da primeira verificação | Para ver o que foi visto no dia |
| [Plano de integração, 15/11/2026](integracoes/plano-2026-11-15.md) | Histórico: plano já executado | Para ver por que cada fonte foi priorizada |

## Telas

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Telas](telas/README.md) | Capturas de todas as telas, em dados sintéticos | Para ver o produto sem subir nada |
| [Gerador das capturas](../scripts/telas/README.md) | Como refazer as capturas | Depois de mudar a interface |

## Melhoria contínua

| Documento | O que é | Quando ler |
| --- | --- | --- |
| [Ciclo de melhoria](melhoria/README.md) | O ciclo, as regras e o histórico das iterações | Antes de começar um trabalho |
| [Backlog](melhoria/backlog.md) | Itens priorizados | Para escolher o que fazer |
| [Estimativas](melhoria/estimativas.md) | Custo em tokens, estratégia e registro do estimado e do real | Antes e depois de executar um plano |
| [Direção visual](melhoria/direcao-visual.md) | Princípios e direção visual de interface | Ao criticar ou desenhar uma tela |
| Críticas das telas: [rodada 1](melhoria/criticas/2026-11-11-telas.md), [rodada 2](melhoria/criticas/2026-11-12-telas-rodada-2.md), [rodada 3](melhoria/criticas/2026-11-13-telas-rodada-3.md) | Histórico: achados já tratados | Para ver como a interface evoluiu |
