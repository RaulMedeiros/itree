# Gerador das capturas de tela

Recria a pilha local com dados sintéticos e captura as telas em
[`docs/telas/`](../../docs/telas/README.md).

> **Atenção:** `gerar.sh` executa `docker compose down -v`, apagando o banco e
> os arquivos do ambiente local.

## Uso

1. Construa as imagens da pilha completa:

   ```bash
   docker compose -f infra/docker/compose.yml --profile completo build
   ```

2. Na raiz do repositório, com o Node e o Playwright (Chromium) instalados:

   ```bash
   scripts/telas/gerar.sh
   ```

Para refazer só algumas telas sem recriar os dados, use a variável `SO` e o
arquivo de identificadores gerado na última execução:

```bash
SO=01,15 node scripts/telas/capturar.js /tmp/telas-ids.json docs/telas
```

## Arquivos

| Arquivo                                                                                                   | Conteúdo                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gerar.sh`                                                                                                | Sobe a pilha, importa os territórios, cria os usuários, semeia e captura                                                                                                  |
| `semear.py`                                                                                               | Dados sintéticos: 240 árvores importadas, duplicidades, evidências ilustradas, ocorrências, tarefas, inspeções (pelo serviço de sincronização), alertas e sugestões de IA |
| `ids.py`                                                                                                  | Identificadores dos registros que algumas telas abrem                                                                                                                     |
| `capturar.js`                                                                                             | Roteiro Playwright: entra como gestor e como administradora e salva cada tela                                                                                             |
| `bairros-sinteticos.geojson`, `focos-sinteticos.csv`, `deter-sintetico.geojson`, `inventario-exemplo.csv` | Entradas sintéticas                                                                                                                                                       |

Os logins usados (`gestor@itree.local`/`gestor` e `admin@itree.local`/`admin`)
existem só no realm de desenvolvimento do Keycloak (`infra/docker/keycloak`).

A semeadura usa `random.seed`, então os dados se repetem a cada execução. Os
códigos e as datas mudam conforme o dia da geração.
