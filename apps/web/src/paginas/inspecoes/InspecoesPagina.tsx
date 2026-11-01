import { EstadoInspecaoEnum, useInspecoesListar, useTerritoriosListar } from "@itree/api-client";
import { ROTULOS_CONDICAO, ROTULOS_ESTADO_INSPECAO } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { SeloEstadoInspecao } from "../../componentes/selos";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarDataHora } from "../../util/formatos";

const TAMANHO = 50;

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
  const consulta = useInspecoesListar({
    ...filtros,
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
          value={filtros.bairro ?? ""}
          onChange={(e) => filtrar({ bairro: e.target.value || undefined })}
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
          <Entrada
            type="date"
            value={filtros.desde ?? ""}
            onChange={(e) => filtrar({ desde: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <Entrada
            type="date"
            value={filtros.ate ?? ""}
            onChange={(e) => filtrar({ ate: e.target.value || undefined })}
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
                    {ROTULOS_CONDICAO[i.condicao_aparente ?? "nao_avaliada"]}
                    {i.sinais?.length ? (
                      <p className="text-xs text-texto-suave">
                        {i.sinais.length} sinal(is) observado(s)
                      </p>
                    ) : null}
                    {i.requer_encaminhamento && <Selo tom="atencao">Requer encaminhamento</Selo>}
                  </Td>
                  <Td>
                    <SeloEstadoInspecao estado={i.estado ?? "rascunho"} />
                  </Td>
                  <Td className="whitespace-nowrap">{formatarDataHora(i.recebida_em)}</Td>
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
