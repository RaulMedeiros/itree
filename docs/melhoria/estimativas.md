# Estimativa de custo (tokens) e estratégia de execução

Toda iteração do [ciclo](README.md) começa com uma estimativa de tokens e termina
comparando o estimado com o real. O objetivo é planejar o trabalho dentro do
limite de uso do ambiente e melhorar a estimativa a cada rodada.

## Base empírica (iterações 5 a 8, nov/2026)

Consumo medido dos subagentes (campo `subagent_tokens` de cada entrega):

| Tipo de trabalho | Exemplos | Faixa observada |
| --- | --- | --- |
| Lote de implementação com 1 ou 2 itens pequenos | lint e bloqueio do TS 7 (6A); administração (lote F) | 85–110 mil |
| Lote com 3 a 5 itens (backend e/ou web, com testes) | lotes A–E da crítica; ondas 2 e 3 | 140–250 mil |
| Lote com 5 a 7 itens ou com dado real (rede, validação) | 4C, 4D, 5B, 5D, 6B, 6C | 280–370 mil |
| Integração de fonte pública (verificação real e testes) | limites, Censo, áreas verdes | 160–250 mil |
| Revisor da revisão de prontidão (Opus, só leitura) | 7 fatias | 100–190 mil |
| Crítica de 38 a 39 capturas | rodadas 1 e 2 | ~190 mil |
| Pesquisa e verificação de fontes | 1ª e 2ª rodadas | 115 mil a mais |

Custo da integração (meu, fora dos subagentes): de 30 a 60 mil por PR (rebase,
conflitos, verificação completa, PR, CI e merge). Sobe para 60 a 100 mil quando
há conflito semântico entre lotes, por exemplo uma API que muda de formato.

Regra prática: **cerca de 50 mil tokens por item de backlog**, mais **40 mil por PR
integrado**, mais **20% de folga** para conflitos e correções.

## Estratégia de uso do ambiente

- **Limite de 5 horas.** Quatro subagentes em paralelo bateram no limite quatro
  vezes. Use **no máximo 2 subagentes ao mesmo tempo**. Ao bater no limite, não
  recomece: retome o mesmo subagente (o trabalho fica no worktree) quando o
  limite for reiniciado.
- **Modelo por papel.** Implementação usa Sonnet. Revisão de prontidão usa Opus,
  porque a precisão do achado depende disso. Integração, conflitos e decisões
  ficam comigo.
- **Isolamento.** Cada lote tem um worktree e uma branch próprios. O subagente
  faz commit, mas não faz push nem PR. Cada um usa um banco de teste próprio
  (`itree_<lote>`).
- **Lotes disjuntos.** Agrupe por área de arquivo para reduzir conflitos. Os
  arquivos que mais conflitam são `util/formatos.ts`, `docs/melhoria/backlog.md`,
  `openapi.yaml` e o cliente gerado, e os testes de página. O subagente não edita
  o backlog; eu edito. Arquivos gerados são regenerados no fim do rebase, nunca
  mesclados à mão.
- **Integração em série.** Faça rebase sobre a main, rode a verificação completa
  (a mesma da CI), abra o PR, espere o CI e faça o merge. Só então integre o
  próximo lote. Testes que passam isolados podem quebrar depois de integrar
  outro lote.
- **Capturas.** O banco de testes local e o compose disputam a porta 5432. Gere
  as capturas só quando nenhum subagente estiver testando.
- **O que não paralelizar.** Um lote que muda o formato de uma API usada por
  outro lote vai antes, sozinho.

## Registro: estimado e real

Ao fim de cada plano, preencha uma linha. O "real" soma os `subagent_tokens`
mais a estimativa da integração (40 mil por PR, ou o observado). Se o erro
passar de 25%, anote a causa e ajuste a regra prática acima.

| Data | Plano | Estimado | Real | Erro | Causa e ajuste |
| --- | --- | --- | --- | --- | --- |
