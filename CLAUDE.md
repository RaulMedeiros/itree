# Memória do projeto para o Claude

Instruções permanentes para sessões do Claude Code neste repositório.

## Antes de executar um plano: estimar tokens e escolher a estratégia

- Todo plano começa com uma **estimativa de custo em tokens**, e toda execução
  termina com o **registro do estimado e do real**. A base, a regra prática e a
  tabela de registro estão em [docs/melhoria/estimativas.md](docs/melhoria/estimativas.md).
  Leia esse arquivo antes de estimar e atualize-o ao terminar.
- **Regra prática atual:** item pequeno ~25 mil tokens; item de funcionalidade
  ~50 mil; item estrutural 150–200 mil; mais 40 mil por PR integrado e 20% de
  folga. Detalhes e histórico em `docs/melhoria/estimativas.md`.
- **Aprenda a cada plano.** Compare o estimado com o real, que é a soma dos
  `subagent_tokens` de cada entrega mais a integração. Se o erro passar de 25%,
  anote a causa e ajuste a regra prática no documento.

## Estratégia de uso deste ambiente

- **No máximo 2 subagentes em paralelo.** Quatro em paralelo bateram no limite
  de 5 horas várias vezes.
- **Ao bater no limite, retome o mesmo subagente** (`SendMessage`) quando o
  limite for reiniciado. O trabalho fica no worktree; não recomece do zero.
- **Modelos.** Implementação usa Sonnet. Revisão de prontidão e crítica usam
  Opus. Integração, conflitos e decisões ficam com a sessão principal.
- **Isolamento.** Cada lote tem worktree e branch próprios. O subagente faz
  commit, mas não faz push nem PR, e usa banco de teste próprio
  (`DATABASE_URL=postgis://itree:itree@localhost:5432/itree_<lote>`).
- **Nunca `git stash` em worktree.** A stash é compartilhada entre worktrees:
  um subagente já aplicou a stash de outro. Para guardar trabalho, faça commit.
  Ponha essa regra no pedido de cada subagente.
- **Lotes em áreas de arquivo separadas.** O subagente não edita
  `docs/melhoria/backlog.md`. Arquivos gerados (`openapi.yaml` e o cliente
  Orval) são regenerados depois do rebase, nunca mesclados à mão.
- **Integração em série:**
  1. rebase sobre a `main`;
  2. verificação completa, igual à da CI (ruff, makemigrations, pytest,
     spectacular, `pnpm gerar:api`, format, lint, typecheck, test);
  3. PR, CI verde e merge;
  4. só então o próximo lote.
- **Capturas** (`scripts/telas/gerar.sh`) disputam a porta 5432 com o banco de
  testes local. Gere-as só quando nenhum subagente estiver testando.
- **As capturas são o teste de ponta a ponta.** Elas sobem a pilha real com dados
  antigos e novos. Já pegaram uma semeadura quebrada e um erro 500 com lotes
  anteriores a uma migração, que a CI não viu. Gere-as ao fim de todo plano que
  mude modelo, migração ou importação.

## Regras do produto

Siga o [ciclo de melhoria](docs/melhoria/README.md):

- não antecipe decisões pendentes (`docs/decisoes/pendentes.md`);
- dados de demonstração são sempre sintéticos e declarados;
- nenhum número ambiental sem fonte e método;
- os limites territoriais vêm da fonte oficial (`importar_limites_fortaleza`).
