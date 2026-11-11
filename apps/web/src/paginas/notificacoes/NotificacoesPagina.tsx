import {
  TipoNotificacaoEnum,
  useNotificacoesLer,
  useNotificacoesLerTodas,
  useNotificacoesListar,
  type Notificacao,
} from "@itree/api-client";
import { ROTULOS_TIPO_NOTIFICACAO } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { Botao } from "../../ui/botao";
import { Selecao } from "../../ui/campos";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { invalidarCaminhos } from "../../util/cache";
import { contarFiltros, destinoDoLink } from "../../util/filtros";
import { formatarDataHora, plural } from "../../util/formatos";

const TAMANHO = 25;

export interface BuscaNotificacoes {
  tipo?: TipoNotificacaoEnum;
  lida?: "true" | "false";
  pagina?: number;
}

/** Central de notificações (G-09): todas as do usuário, com filtro por tipo e por lida. */
export function NotificacoesPagina() {
  const filtros = useSearch({ from: "/autenticado/notificacoes" });
  const navegar = useNavigate({ from: "/notificacoes" });
  const cliente = useQueryClient();
  const consulta = useNotificacoesListar({
    tipo: filtros.tipo,
    lida: filtros.lida === undefined ? undefined : filtros.lida === "true",
    pagina: filtros.pagina,
    tamanho: TAMANHO,
  });
  const atualizar = () => invalidarCaminhos(cliente, "/api/v1/notificacoes");
  const ler = useNotificacoesLer({ mutation: { onSuccess: atualizar } });
  const lerTodas = useNotificacoesLerTodas({ mutation: { onSuccess: atualizar } });

  const filtrar = (parcial: Partial<BuscaNotificacoes>) =>
    void navegar({ search: (s: BuscaNotificacoes) => ({ ...s, ...parcial, pagina: undefined }) });

  const abrir = (n: Notificacao) => {
    if (!n.lida) ler.mutate({ id: n.id });
    if (n.link) void navegar(destinoDoLink(n.link));
  };

  return (
    <div className="mx-auto max-w-4xl">
      <CabecalhoPagina
        titulo="Notificações"
        descricao="Tudo o que mudou e pede a sua atenção, das mais novas para as mais antigas."
        acoes={
          <Botao
            variante="secundario"
            disabled={lerTodas.isPending}
            onClick={() => lerTodas.mutate()}
          >
            Marcar todas como lidas
          </Botao>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Tipo"
          value={filtros.tipo ?? ""}
          onChange={(e) => filtrar({ tipo: (e.target.value || undefined) as TipoNotificacaoEnum })}
          className="w-full sm:w-60"
        >
          <option value="">Todos os tipos</option>
          {Object.values(TipoNotificacaoEnum).map((t) => (
            <option key={t} value={t}>
              {ROTULOS_TIPO_NOTIFICACAO[t]}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Situação"
          value={filtros.lida ?? ""}
          onChange={(e) =>
            filtrar({ lida: (e.target.value || undefined) as BuscaNotificacoes["lida"] })
          }
          className="w-full sm:w-48"
        >
          <option value="">Lidas e não lidas</option>
          <option value="false">Não lidas</option>
          <option value="true">Lidas</option>
        </Selecao>
      </div>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <ListaVazia
          filtrada={contarFiltros(filtros) > 0}
          aoLimparFiltros={() => void navegar({ search: {} })}
          titulo="Nada novo por aqui"
        >
          Avisos de tarefas, inspeções, riscos confirmados e alertas chegam aqui, no seu escopo
          territorial.
        </ListaVazia>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-borda rounded-lg border border-borda bg-superficie">
            {consulta.data.data.results.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => abrir(n)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-marca-clara"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.lida ? "" : "bg-marca"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.lida ? "" : "font-medium"}`}>
                      {n.titulo}
                      {!n.lida && <span className="sr-only"> (não lida)</span>}
                    </span>
                    {n.texto && <span className="block text-sm text-texto-suave">{n.texto}</span>}
                    <span className="block text-xs text-texto-suave">
                      {formatarDataHora(n.criado_em)}
                    </span>
                  </span>
                  <Selo tom="neutro">{ROTULOS_TIPO_NOTIFICACAO[n.tipo]}</Selo>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-texto-suave">
            {plural(consulta.data.data.count, "notificação", "notificações")}
          </p>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) =>
              void navegar({ search: (s: BuscaNotificacoes) => ({ ...s, pagina: p }) })
            }
          />
        </>
      )}
    </div>
  );
}
