import {
  ErroApi,
  useNotificacoesAjustes,
  useNotificacoesAtualizarAjustes,
  useTerritoriosListar,
  type AjustesNotificacao as Ajustes,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { Campo, EntradaData, ListaMarcavel } from "../../ui/campos";
import { Carregando, Erro } from "../../ui/estados";
import { invalidarCaminhos } from "../../util/cache";
import { formatarData, plural } from "../../util/formatos";

/**
 * De onde e até quando receber avisos (M-27): bairros de interesse dentro do escopo e
 * "silenciar até" uma data. Vale para todos os tipos de aviso, novos a partir de agora.
 */
export function AjustesNotificacao() {
  const consulta = useNotificacoesAjustes();
  if (consulta.isPending) return <Carregando />;
  if (consulta.isError) {
    return <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />;
  }
  return <Formulario ajustes={consulta.data.data} />;
}

function Formulario({ ajustes }: { ajustes: Ajustes }) {
  const cliente = useQueryClient();
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const salvar = useNotificacoesAtualizarAjustes<ErroApi>({
    mutation: { onSuccess: () => invalidarCaminhos(cliente, "/api/v1/notificacoes/ajustes") },
  });
  const [escolhidos, setEscolhidos] = useState(ajustes.territorios.map((t) => t.id));
  const [ate, setAte] = useState("");
  const salvos = ajustes.territorios.map((t) => t.id);
  const mudouBairros =
    escolhidos.length !== salvos.length || escolhidos.some((id) => !salvos.includes(id));

  return (
    <section aria-labelledby="titulo-ajustes" className="mb-6">
      <h2 id="titulo-ajustes" className="mb-1 text-base font-semibold">
        Onde e até quando receber
      </h2>
      <p className="mb-3 text-sm text-texto-suave">
        Vale para todos os tipos de aviso novos. O que já chegou ao sino continua lá.
      </p>
      {salvar.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {Object.values(salvar.error.errosDeCampo).flat()[0] ?? salvar.error.message}
        </p>
      )}
      <div className="flex flex-col gap-5 rounded-lg border border-borda bg-superficie p-4">
        <div>
          <ListaMarcavel
            legenda="Bairros de interesse"
            opcoes={(bairros.data?.data.results ?? []).map((b) => ({
              valor: b.id,
              rotulo: b.nome,
            }))}
            selecionados={escolhidos}
            aoAlterar={setEscolhidos}
            vazio={bairros.isPending ? "Carregando bairros…" : "Nenhum bairro no seu escopo."}
            className="max-h-48 overflow-y-auto"
          />
          <p className="mt-1.5 text-xs text-texto-suave">
            {escolhidos.length === 0
              ? "Nenhum bairro marcado: você recebe os avisos de todo o seu escopo."
              : `Você recebe só os avisos de ${plural(escolhidos.length, "bairro marcado", "bairros marcados")}, dentro do seu escopo.`}
          </p>
          <Botao
            className="mt-2"
            variante="secundario"
            disabled={!mudouBairros || salvar.isPending}
            onClick={() => salvar.mutate({ data: { territorios_ids: escolhidos } })}
          >
            Salvar bairros
          </Botao>
        </div>
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Silenciar por um período</h3>
          {ajustes.silenciada && ajustes.silenciada_ate ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm">
                Avisos silenciados até {formatarData(ajustes.silenciada_ate)}.
              </p>
              <Botao
                variante="secundario"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate({ data: { silenciada_ate: null } })}
              >
                Voltar a receber
              </Botao>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Campo
                rotulo="Silenciar até"
                ajuda="Até essa data, inclusive, nenhum aviso novo chega (sino nem e-mail). Útil nas férias. Use o formato dd/mm/aaaa."
              >
                {(p) => <EntradaData {...p} value={ate} onChange={setAte} className="max-w-40" />}
              </Campo>
              <Botao
                variante="secundario"
                disabled={ate === "" || salvar.isPending}
                onClick={() => salvar.mutate({ data: { silenciada_ate: ate } })}
              >
                Silenciar
              </Botao>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
