import { EstadoInspecaoEnum, useInspecoesListar, useTerritoriosListar } from "@itree/api-client";
import { ROTULOS_CONDICAO, ROTULOS_ESTADO_INSPECAO } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { SeloEstadoInspecao } from "../../componentes/selos";
import { BotaoExportarCsv } from "../../componentes/BotaoExportarCsv";
import { CORES_CONDICAO } from "../../mapa/simbologia";
import { EntradaData, Selecao } from "../../ui/campos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { Botao } from "../../ui/botao";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { contarFiltros } from "../../util/filtros";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { contar, diasDesde, formatarDataHora } from "../../util/formatos";

const TAMANHO = 50;

/** Ordenações oferecidas. A fila abre pelas mais antigas; o histórico, pelas mais recentes. */
const ORDENACOES = [
  { valor: "recebida_em", rotulo: "Mais antigas primeiro" },
  { valor: "-recebida_em", rotulo: "Mais recentes primeiro" },
  { valor: "condicao", rotulo: "Pior condição primeiro" },
  { valor: "-realizada_em", rotulo: "Última realizada primeiro" },
] as const;

/** Tempo na fila de revisão, em dias corridos. "Chegou hoje" só aparece para quem chegou hoje. */
function aguardaHa(dias: number): string {
  if (dias <= 0) return "chegou hoje";
  return `aguarda há ${contar(dias, "dia", "dias")}`;
}

export interface BuscaInspecoes {
  estado?: string;
  bairro?: string;
  desde?: string;
  ate?: string;
  condicao?: string;
  requer_encaminhamento?: "true";
  ordenar?: string;
  pagina?: number;
}

export function InspecoesPagina() {
  const filtros = useSearch({ from: "/autenticado/inspecoes/" });
  const navegar = useNavigate({ from: "/inspecoes/" });
  const fila = (filtros.estado ?? "em_revisao") === "em_revisao";
  const ordenacao = ORDENACOES.some((o) => o.valor === filtros.ordenar)
    ? (filtros.ordenar as string)
    : fila
      ? "recebida_em"
      : "-realizada_em";
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const consulta = useInspecoesListar({
    ...filtros,
    bairro,
    estado: filtros.estado ?? "em_revisao",
    condicao: filtros.condicao,
    requer_encaminhamento: filtros.requer_encaminhamento === "true" ? true : undefined,
    // A fila é atendida pelas que esperam há mais tempo; o histórico abre pelas mais recentes.
    ordenar: ordenacao,
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
        acoes={
          <BotaoExportarCsv
            conjunto="inspecoes"
            leitura="inspecoes.ler"
            filtros={{ ...filtros, bairro, estado: filtros.estado ?? "em_revisao" }}
          />
        }
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
        <Selecao
          aria-label="Condição aparente"
          value={filtros.condicao ?? ""}
          onChange={(e) => filtrar({ condicao: e.target.value || undefined })}
          className="max-w-52"
        >
          <option value="">Todas as condições</option>
          {Object.entries(ROTULOS_CONDICAO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Selecao>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-marca"
            checked={filtros.requer_encaminhamento === "true"}
            onChange={(e) =>
              filtrar({ requer_encaminhamento: e.target.checked ? "true" : undefined })
            }
          />
          Requer encaminhamento
        </label>
        <Selecao
          aria-label="Ordenar por"
          value={ordenacao}
          onChange={(e) => filtrar({ ordenar: e.target.value })}
          className="max-w-56"
        >
          {ORDENACOES.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
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
        <ListaVazia
          filtrada={contarFiltros({ ...filtros, bairro }) > 0}
          aoLimparFiltros={() => void navegar({ search: {} })}
          titulo={fila ? "Nenhuma inspeção aguardando revisão" : "Ainda não há inspeções"}
          acao={
            <Botao variante="secundario" asChild>
              <Link to="/equipes-tarefas">Ver tarefas de inspeção</Link>
            </Botao>
          }
        >
          Inspeções chegam pelo aplicativo de campo, enviadas por quem executa a tarefa. Crie
          tarefas de inspeção para as equipes e acompanhe-as em Equipes e tarefas.
        </ListaVazia>
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
                      className="font-mono font-medium whitespace-nowrap text-marca-escura hover:underline"
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
