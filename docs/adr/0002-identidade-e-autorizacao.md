# ADR-0002 — Identidade no provedor OIDC, autorização na aplicação

**Status:** Aceito · **Data:** 2026-10-31 · **Relaciona-se a:** ADR-0001, T-03, W-10, DP-01, DP-19

## Contexto

O Keycloak (ADR-0001) pode guardar tanto a identidade (login, senha, MFA) quanto
os papéis dos usuários. A especificação, porém, exige:

- administração de papéis e **escopo territorial** pelo próprio painel (W-10);
- **auditoria** de toda mudança de acesso, com valor anterior, novo e
  justificativa (RF-ADM-002, CA-ADM-001);
- perda de acesso **imediata** ao desativar um usuário (RF-ADM-001);
- possibilidade de federar com um SSO já existente na prefeitura (DP-19), onde
  a plataforma pode não ter permissão para gerenciar papéis.

## Decisão

1. **O provedor OIDC cuida só da identidade.** O backend valida o token
   (assinatura via JWKS, emissor, audiência `itree-api`, expiração) e usa os
   claims `sub`, `email`, `email_verified` e `name`.
2. **Papéis e escopo territorial vivem no banco da aplicação**, no modelo
   `Usuario`, auditados pelo `django-pghistory`. Papéis do Keycloak são ignorados.
3. **Vínculo do usuário local**, nesta ordem:
   - pelo `sub`, se já vinculado;
   - pelo e-mail **verificado**, se um administrador pré-cadastrou o usuário;
   - senão, cria o usuário **sem papéis**: ele entra e vê "acesso aguarda
     liberação", sem acesso a dados.
   Um e-mail já vinculado a outro `sub` é recusado.
4. **Desativação** é verificada a cada requisição; o token deixa de valer na
   aplicação imediatamente, mesmo que ainda não tenha expirado no provedor.
5. **Matriz de permissões em código** (`backend/itree/contas/permissoes.py`):
   cada mudança passa por revisão e fica no histórico do repositório. Ela é
   provisória até DP-01.
6. **Escopo territorial** é aplicado no servidor por interseção espacial com a
   união dos territórios do usuário (`filtrar_por_escopo`). Usuário sem escopo
   não vê registros territoriais.
7. **Primeiro administrador** de cada ambiente é criado pelo comando
   `manage.py criar_administrador`.

## Consequências

- A plataforma funciona com qualquer provedor OIDC (Keycloak próprio ou SSO da
  prefeitura) sem depender de como ele modela papéis.
- Toda mudança de acesso fica na mesma trilha de auditoria do restante dos dados.
- O administrador precisa atribuir papéis no painel; não há sincronização
  automática de grupos do provedor. Se a prefeitura exigir isso, uma nova ADR
  substitui o item 2.
- Usuários que nunca entraram aparecem como "aguardando primeiro acesso".
