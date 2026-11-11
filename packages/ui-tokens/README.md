# @itree/ui-tokens

Tokens de design Field Operations compartilhados entre web (`src/tokens.css`,
Tailwind v4) e app móvel (`src/tokens.ts`). Os valores de `tokens.css` são a
fonte; o script de contraste também confere que `tokens.ts` não diverge.

## Contraste (WCAG 2.x)

`pnpm test` neste pacote roda `scripts/contraste.mjs`, que calcula a razão de
luminância relativa dos pares realmente usados no painel e falha se algum
ficar abaixo de 4,5:1 (texto normal) ou 3:1 (ícones, marcadores e bordas de
componentes, WCAG 1.4.11). A CI pega regressões pelo `pnpm test` da raiz.
Ao criar um token ou um novo uso de cor, acrescente o par em `montarPares`.

Revisão do M-08: todos os pares já atendiam AA, então nenhuma cor da paleta
foi alterada (o verde da marca segue o mesmo). Foi acrescentado apenas o
token `barra-realce` (#8fd3a8), antes um literal no marcador do item ativo
da barra lateral, e os tokens da barra e `borda-campo` passaram a existir
também em `tokens.ts`.

| Par (frente sobre fundo)                                       | Razão   | Mínimo |
| -------------------------------------------------------------- | ------- | ------ |
| texto sobre fundo                                              | 14,81:1 | 4,5:1  |
| texto sobre superficie                                         | 15,91:1 | 4,5:1  |
| texto sobre neutro-clara                                       | 13,64:1 | 4,5:1  |
| texto sobre marca-clara                                        | 13,65:1 | 4,5:1  |
| texto-suave sobre fundo                                        | 6,00:1  | 4,5:1  |
| texto-suave sobre superficie                                   | 6,45:1  | 4,5:1  |
| texto-suave sobre neutro-clara                                 | 5,53:1  | 4,5:1  |
| texto-suave sobre marca-clara                                  | 5,53:1  | 4,5:1  |
| barra-texto sobre barra                                        | 12,16:1 | 4,5:1  |
| barra-texto sobre barra-ativo                                  | 8,10:1  | 4,5:1  |
| barra-suave sobre barra                                        | 8,23:1  | 4,5:1  |
| barra-suave sobre barra-ativo                                  | 5,48:1  | 4,5:1  |
| barra-realce (marcador do item ativo) sobre barra              | 6,98:1  | 3:1    |
| barra-realce (marcador do item ativo) sobre barra-ativo        | 4,65:1  | 3:1    |
| branco sobre marca                                             | 6,47:1  | 4,5:1  |
| branco sobre marca-escura                                      | 9,45:1  | 4,5:1  |
| branco sobre sucesso                                           | 6,47:1  | 4,5:1  |
| branco sobre info                                              | 6,45:1  | 4,5:1  |
| branco sobre atencao                                           | 5,93:1  | 4,5:1  |
| branco sobre perigo                                            | 6,54:1  | 4,5:1  |
| branco sobre perigo/90 (hover) sobre fundo                     | 5,58:1  | 4,5:1  |
| branco sobre perigo/90 (hover) sobre superficie                | 5,51:1  | 4,5:1  |
| selo neutro sobre neutro-clara                                 | 6,65:1  | 4,5:1  |
| selo marca-escura sobre marca-clara                            | 8,10:1  | 4,5:1  |
| selo info sobre info-clara                                     | 5,50:1  | 4,5:1  |
| selo atencao sobre atencao-clara                               | 5,28:1  | 4,5:1  |
| selo perigo sobre perigo-clara                                 | 5,50:1  | 4,5:1  |
| selo sucesso sobre sucesso-clara                               | 5,55:1  | 4,5:1  |
| marca sobre fundo                                              | 6,02:1  | 4,5:1  |
| marca sobre superficie                                         | 6,47:1  | 4,5:1  |
| marca-escura sobre fundo                                       | 8,79:1  | 4,5:1  |
| marca-escura sobre superficie                                  | 9,45:1  | 4,5:1  |
| info sobre fundo                                               | 6,00:1  | 4,5:1  |
| info sobre superficie                                          | 6,45:1  | 4,5:1  |
| atencao sobre fundo                                            | 5,52:1  | 4,5:1  |
| atencao sobre superficie                                       | 5,93:1  | 4,5:1  |
| perigo sobre fundo                                             | 6,08:1  | 4,5:1  |
| perigo sobre superficie                                        | 6,54:1  | 4,5:1  |
| sucesso sobre fundo                                            | 6,02:1  | 4,5:1  |
| sucesso sobre superficie                                       | 6,47:1  | 4,5:1  |
| neutro sobre fundo                                             | 7,22:1  | 4,5:1  |
| neutro sobre superficie                                        | 7,76:1  | 4,5:1  |
| perigo sobre perigo-clara/40 sobre superficie (linha com erro) | 6,09:1  | 4,5:1  |
| link marca-escura sobre neutro-clara                           | 8,10:1  | 4,5:1  |
| borda-campo sobre fundo                                        | 3,46:1  | 3:1    |
| anel de foco (marca) sobre fundo                               | 6,02:1  | 3:1    |
| borda-campo sobre superficie                                   | 3,71:1  | 3:1    |
| anel de foco (marca) sobre superficie                          | 6,47:1  | 3:1    |
| campo inválido: borda perigo sobre superficie                  | 6,54:1  | 3:1    |
