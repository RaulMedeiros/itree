# Decisões pendentes

Itens que precisam de decisão antes de congelar a especificação. DP-01 a DP-15
vêm de §12 da especificação consolidada; DP-16 em diante surgiram na
elaboração das specs do web.

Ao fechar uma decisão: mudar o status para **Decidido**, registrar data,
responsável, a decisão e as specs atualizadas.

| ID | Decisão | Impacto no web | Bloqueia fase | Status |
| -- | ------- | -------------- | ------------- | ------ |
| <a id="dp-01"></a>DP-01 | Perfis definitivos e matriz de permissões | T-03, todas as telas | F0 | Aberta |
| <a id="dp-02"></a>DP-02 | Taxonomia oficial e catálogo de espécies | W-03, W-10, W-06 (distribuição por espécie) | F1 | Aberta |
| <a id="dp-03"></a>DP-03 | Protocolo de inspeção e escalas de condição aparente | W-05, W-06, filtros de W-02/W-03 | F2 | Aberta |
| <a id="dp-04"></a>DP-04 | Campos obrigatórios por tipo de inspeção | W-05, W-10 | F2 | Aberta |
| <a id="dp-05"></a>DP-05 | Regras de validação e assinatura técnica | W-05, risco confirmado em W-04 | F2 | Aberta |
| <a id="dp-06"></a>DP-06 | Sistema de referência espacial e padrões de geometria | W-02, T-02, exportação GeoJSON | F1 | Proposta em [ADR-0001 §2.3](../adr/0001-stack-tecnica.md#23-padrões-que-a-stack-impõe) (EPSG:4326 + EPSG:31984) — aguarda validação |
| <a id="dp-07"></a>DP-07 | Provedor de mapas (ruas/satélite) e política de cache | W-02 (data da imagem, custo, licença) | F1 | Parcial: MapLibre definido em ADR-0001; provedores em ADR futura |
| <a id="dp-08"></a>DP-08 | Infraestrutura de armazenamento de imagens | W-03, W-05 | F1 | Parcial: S3-compatível definido em ADR-0001; onde hospedar depende da hospedagem |
| <a id="dp-09"></a>DP-09 | Retenção, privacidade e acesso a fotos e localização | W-03, W-05, W-07, W-09 | F1 | Aberta |
| <a id="dp-10"></a>DP-10 | Fontes municipais oficiais e responsáveis | T-05, camadas de W-02 | F1 | Aberta |
| <a id="dp-11"></a>DP-11 | Credenciais, limites e condições das APIs externas | W-08, T-05 | F3 | Aberta |
| <a id="dp-12"></a>DP-12 | Interoperabilidade com sistemas municipais | T-05, importação W-03 | F1 | Aberta |
| <a id="dp-13"></a>DP-13 | Calibração e validação dos modelos de IA | T-04 | F3 | Aberta |
| <a id="dp-14"></a>DP-14 | Indicadores oficiais e fórmulas (incl. "registro válido") | W-06, W-09, RN-INV-001 | F2 | Aberta |
| <a id="dp-15"></a>DP-15 | Fluxo institucional de encaminhamento e confirmação de infrações | W-08 | F3 | Aberta |
| <a id="dp-16"></a>DP-16 | Permitir registrar inspeção pelo web (contingência)? | W-05 RF-INSP-008, W-00 §4 | F2 | Aberta |
| <a id="dp-17"></a>DP-17 | Tipos de ocorrência, fluxo de estados e prazos (SLA) | W-04, W-10 | F1 | Aberta |
| <a id="dp-18"></a>DP-18 | Existe inventário legado a importar? Formato e fonte | W-03 importação, W-00 §4 | F1 | Aberta |
| <a id="dp-19"></a>DP-19 | Provedor de autenticação (SSO institucional?) | RF-ACL-001 | F0 | Parcial: OIDC via Keycloak (ADR-0001); papéis na aplicação (ADR-0002); confirmar se a prefeitura tem SSO para federar |
| <a id="dp-20"></a>DP-20 | Stack técnica (web, backend e app) | Todas | F0 | **Decidido** em 2026-10-31 — [ADR-0001](../adr/0001-stack-tecnica.md) |
| <a id="dp-21"></a>DP-21 | Hospedagem: nuvem comercial ou infraestrutura da prefeitura | ADR de implantação, local de armazenamento (DP-08) | Produção | Aberta |

## Próximo passo recomendado

1. Fechar DP-01 e confirmar DP-19 para iniciar F0 (DP-20 decidido).
2. Validar visualmente as telas centrais (W-00 §6) em paralelo.
3. Fechar DP-02, DP-06, DP-07, DP-08, DP-09, DP-17 e DP-18 antes de F1.
