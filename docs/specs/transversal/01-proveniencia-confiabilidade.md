# T-01 — Confiabilidade e proveniência de dados

**Status:** Rascunho · **Aplica-se a:** web e mobile

## 1. Princípio

Todo dado exibido deve permitir responder: **de onde veio, quando, quem
registrou, como foi obtido e quão preciso é.**

## 2. Classes de origem de valor

| Origem       | Definição                                                 | Exemplo                         |
| ------------ | --------------------------------------------------------- | ------------------------------- |
| Medido       | Obtido por medição manual ou instrumental, com método.    | DAP com fita diamétrica.        |
| Estimado     | Aproximação humana ou computacional sem medição direta.   | Altura estimada visualmente.    |
| Inferido     | Produzido por modelo/algoritmo (IA).                      | Espécie sugerida por imagem.    |
| Importado    | Vindo de base externa ou legada.                          | Inventário de 2019 em CSV.      |

Origem de localização: `GPS de campo`, `Importada`, `Estimada (web)`,
`Geocodificada (endereço)`.

## 3. Regras

- **RN-PROV-001** — Campos relevantes armazenam valor + origem + método +
  unidade (quando aplicável) + data + responsável + fonte.
- **RN-PROV-002** — Toda alteração de entidade principal gera evento de
  auditoria (quem, quando, o quê, valor anterior, valor novo, origem do
  canal: web/app/importação/integração, dispositivo quando houver).
- **RN-PROV-003** — Dados externos exibem fonte, data de atualização e
  limitações conhecidas.
- **RN-PROV-004** — Inferências de IA são armazenadas como entidades próprias,
  nunca sobrescrevendo silenciosamente valores validados.
- **RN-PROV-005** — Dado ausente não é exibido nem calculado como zero sem regra
  explícita.
- **RN-PROV-006** — Não há fusão ou exclusão automática de registros.
- **RN-PROV-007** — Precisão exibida nunca excede a precisão do dado de origem
  (casas decimais, círculos de incerteza, arredondamento de medidas).
- **RN-PROV-008** — Dados fictícios só existem em ambiente de demonstração e são
  identificados em toda tela e exportação.
- **RN-PROV-009** — Detecção remota não é tratada como confirmação de
  ilegalidade; fotografia não gera diagnóstico estrutural definitivo.

## 4. Critérios de aceite

- **CA-PROV-001** — Para qualquer valor no detalhe de árvore, o usuário consegue
  ver origem, data e responsável em até um clique.
- **CA-PROV-002** — A auditoria permite reconstruir o estado de uma árvore em
  qualquer data passada.
