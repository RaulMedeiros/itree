import { EstadoInspecaoEnum, useInspecoesListar, useTerritoriosListar } from "@itree/api-client";
import { ROTULOS_CONDICAO, ROTULOS_ESTADO_INSPECAO } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { SeloEstadoInspecao } from "../../componentes/selos";
import { CORES_CONDICAO } from "../../mapa/simbologia";
import { EntradaData, Selecao } from "../../ui/campos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { contar, diasDesde, formatarDataHora } from "../../util/formatos";

const TAMANHO = 50;

/** Tempo na fila de revisão, em dias corridos. */
function aguardaHa(dias: number): string {
  if (dias <= 0) return "chegou hoje";
  return `aguarda há ${contar(dias, "dia", "dias")}`;
}

export interface BuscaInspecoes {
  estado?: string;
  bairro?: string;
  desde?: string;
  ate?: string;
  pagina?: number;
}

export function InspecoesPagina() {
  const filtros = useSearch({ from: "/autenticado/inspecoes/" });
  const navegar = useNavigate({ from: "/inspecoes/" });
  const fila = (filtros.estado ?? "em_revisao") === "em_revisao";
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const consulta = useInspecoesListar({
    ...filtros,
    bairro,
    estado: filtros.estado ?? "em_revisao",
    // A fila é atendida por ordem de chegada; o histórico, do mais recente.
    ordenar: fila ? "realizada_em" : "-realizada_em",
    tamanho: TAMANHO,
  });
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const filtrar = (parcial: Partial<BuscaInspecoes>) =>
    void navegar({ search: (s: BuscaInspecoes) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Inspeções"
        descricao="Inspeções feitas em campo pelo aplicativo. A revisão decide o que entra no cadastro da árvore."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Situação"
          value={filtros.estado ?? "em_revisao"}
          onChange={(e) => filtrar({ estado: e.target.value })}
          className="max-w-56"
        >
          <option value="em_revisao">Fila de revisão</option>
          {Object.values(EstadoInspecaoEnum)
            .filter((e) => e !== "em_revisao")
            .map((e) => (
              <option key={e} value={e}>
                {ROTULOS_ESTADO_INSPECAO[e]}
              </option>
            ))}
          <option value={Object.values(EstadoInspecaoEnum).join(",")}>Todas</option>
        </Selecao>
        <Selecao
          aria-label="Bairro"
          value={bairro ?? ""}
          onChange={(e) => {
            filtrar({ bairro: e.target.value || undefined });
            aoEscolherBairro(e.target.value);
          }}
          className="max-w-52"
        >
          <option value="">Todos os bairros</option>
          {bairros.data?.data.results.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </Selecao>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          De
          <EntradaData
            value={filtros.desde ?? ""}
            onChange={(v) => filtrar({ desde: v || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <EntradaData
            value={filtros.ate ?? ""}
            onChange={(v) => filtrar({ ate: v || undefined })}
            className="w-40"
          />
        </label>
      </div>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio
          titulo={fila ? "Nenhuma inspeção aguardando revisão" : "Nenhuma inspeção encontrada"}
        >
          Inspeções chegam pelo aplicativo de campo.
        </Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Inspeção</Th>
                <Th>Árvore</Th>
                <Th>Técnico</Th>
                <Th>Condição aparente</Th>
                <Th>Situação</Th>
                <Th>Recebida em</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((i) => (
                <Linha key={i.id} className="hover:bg-fundo">
                  <Td>
                    <Link
                      to="/inspecoes/$id"
                      params={{ id: i.id }}
                      className="font-mono font-medium text-marca-escura hover:underline"
                    >
                      {i.codigo}
                    </Link>
                    <p className="text-xs text-texto-suave">
                      Realizada em {formatarDataHora(i.realizada_em)}
                    </p>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">{i.arvore.codigo}</span>
                    <p className="text-xs text-texto-suave">
                      {i.arvore.bairro ?? i.arvore.endereco}
                    </p>
                  </Td>
                  <Td>{i.tecnico.nome || i.tecnico.email}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: CORES_CONDICAO[i.condicao_aparente ?? "nao_avaliada"],
                        }}
                      />
                      {ROTULOS_CONDICAO[i.condicao_aparente ?? "nao_avaliada"]}
                    </span>
                    {i.sinais?.length ? (
                      <p className="text-xs text-texto-suave">
                        {contar(i.sinais.length, "sinal", "sinais")}
                      </p>
                    ) : null}
                    {i.requer_encaminhamento && (
                      <p>
                        <Selo tom="atencao">Requer encaminhamento</Selo>
                      </p>
                    )}
                  </Td>
                  <Td>
                    <SeloEstadoInspecao estado={i.estado ?? "rascunho"} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatarDataHora(i.recebida_em)}
                    {i.estado === "em_revisao" && (
                      <p className="text-xs font-medium text-atencao">
                        {aguardaHa(diasDesde(i.recebida_em))}
                      </p>
                    )}
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) => void navegar({ search: (s: BuscaInspecoes) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
    </div>
  );
}
