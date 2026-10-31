# Engine de Inteligência Arbórea

Plataforma municipal para inventariar, inspecionar, monitorar e gerir árvores e
áreas verdes, com dados rastreáveis, IA assistiva e operação de campo resiliente
à conectividade.

- **Território inicial:** Fortaleza, Ceará, Brasil
- **Plataformas:** painel web desktop (gestão) e aplicativo móvel (campo)
- **Foco atual:** **painel web desktop**
- **Direção visual:** C — Field Operations

> Status: especificação em elaboração. Nada aqui é decisão aprovada, salvo
> quando marcado explicitamente como **Decidido**.

## Estrutura do repositório

```
docs/
├── referencia/
│   └── especificacao-consolidada-v1.md   # documento de origem (não editar)
├── specs/
│   ├── README.md                         # índice, convenções e status
│   ├── web/                              # specs do painel web (foco atual)
│   └── transversal/                      # regras comuns a web e mobile
└── decisoes/
    └── pendentes.md                      # decisões em aberto e impacto no web
```

Comece por [`docs/specs/README.md`](docs/specs/README.md).

## Como contribuir com as specs

1. Toda mudança de spec é feita via pull request.
2. Requisitos têm identificador estável (ex.: `RF-MAPA-003`). Não reutilize IDs
   removidos; marque-os como `Removido`.
3. Ao fechar uma decisão de [`docs/decisoes/pendentes.md`](docs/decisoes/pendentes.md),
   registre data, responsável e as specs afetadas.
4. O documento em `docs/referencia/` é a fonte original e não deve ser alterado;
   divergências são tratadas nas specs.
