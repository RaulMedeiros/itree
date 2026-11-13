import {
  useNotificacoesAtualizarPreferencias,
  useNotificacoesPreferencias,
  type PreferenciaNotificacao,
} from "@itree/api-client";
import { ROTULOS_PAPEL } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";

import { useUsuario } from "../../acesso/ContextoUsuario";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { invalidarCaminhos } from "../../util/cache";
import { AjustesNotificacao } from "./AjustesNotificacao";

/** Minha conta (M-14): quem sou no sistema e como quero ser avisado. */
export function MinhaContaPagina() {
  const eu = useUsuario();
  return (
    <div className="mx-auto max-w-3xl">
      <CabecalhoPagina
        titulo="Minha conta"
        descricao="Seus dados no sistema e como você quer receber os avisos."
      />
      <section aria-labelledby="titulo-dados" className="mb-6">
        <h2 id="titulo-dados" className="mb-2 text-base font-semibold">
          Dados
        </h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 rounded-lg border border-borda bg-superficie p-4 text-sm">
          <dt className="text-texto-suave">Nome</dt>
          <dd>{eu.nome || "—"}</dd>
          <dt className="text-texto-suave">E-mail</dt>
          <dd>{eu.email}</dd>
          <dt className="text-texto-suave">Papéis</dt>
          <dd className="flex flex-wrap gap-1">
            {eu.papeis.map((p) => (
              <Selo key={p} tom="marca">
                {ROTULOS_PAPEL[p]}
              </Selo>
            ))}
          </dd>
        </dl>
        <p className="mt-1 text-xs text-texto-suave">
          Nome, e-mail e papéis são administrados pela equipe responsável pelo sistema.
        </p>
      </section>
      <AjustesNotificacao />
      <PreferenciasNotificacao />
    </div>
  );
}

function PreferenciasNotificacao() {
  const cliente = useQueryClient();
  const consulta = useNotificacoesPreferencias();
  const salvar = useNotificacoesAtualizarPreferencias({
    mutation: { onSuccess: () => invalidarCaminhos(cliente, "/api/v1/notificacoes/preferencias") },
  });

  const mudar = (p: PreferenciaNotificacao, parcial: Partial<PreferenciaNotificacao>) => {
    const novo = { ...p, ...parcial };
    salvar.mutate({
      data: {
        preferencias: [{ tipo: novo.tipo, ativa: novo.ativa, email: novo.ativa && novo.email }],
      },
    });
  };

  return (
    <section aria-labelledby="titulo-notificacoes">
      <h2 id="titulo-notificacoes" className="mb-1 text-base font-semibold">
        Notificações
      </h2>
      <p className="mb-3 text-sm text-texto-suave">
        Para cada tipo de aviso, escolha se ele aparece no sino e se também chega por e-mail. As
        escolhas valem para os avisos novos e são salvas ao marcar.
      </p>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <table className="w-full rounded-lg border border-borda bg-superficie text-sm">
          <caption className="sr-only">Preferências de notificação por tipo</caption>
          <thead>
            <tr className="border-b border-borda text-left text-xs text-texto-suave">
              <th scope="col" className="px-4 py-2 font-medium">
                Tipo
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Receber
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Também por e-mail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {consulta.data.data.map((p) => (
              <tr key={p.tipo}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  {p.rotulo}
                </th>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-marca"
                    aria-label={`Receber: ${p.rotulo}`}
                    checked={p.ativa}
                    disabled={salvar.isPending}
                    onChange={(e) => mudar(p, { ativa: e.target.checked })}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-marca"
                    aria-label={`Também por e-mail: ${p.rotulo}`}
                    checked={p.ativa && p.email}
                    disabled={!p.ativa || salvar.isPending}
                    onChange={(e) => mudar(p, { email: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p role="status" className="mt-2 min-h-5 text-xs text-texto-suave">
        {salvar.isError
          ? "Não foi possível salvar. Tente de novo."
          : salvar.isSuccess
            ? "Preferências salvas."
            : ""}
      </p>
    </section>
  );
}
