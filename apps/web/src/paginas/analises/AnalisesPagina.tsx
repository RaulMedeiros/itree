import {
  ErroApi,
  baixarArquivo,
  useRelatoriosAnalise,
  useRelatoriosCatalogo,
} from "@itree/api-client";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Download, FileText } from "lucide-react";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Botao } from "../../ui/botao";
import { MenuAgrupado } from "../../ui/menu";
import { EntradaData, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { GraficoMensal, type Serie } from "../visao-geral/graficos";

export interface BuscaAnalises {
  analise?: string;
  inicio?: string;
  fim?: string;
}

interface SerieMensal {
  meses: string[];
  series: Serie[];
  /** Meses (AAAA-MM) que a fonte não publicou. */
  sem_dado?: string[];
  /** Um gráfico por grupo (a paleta validada tem duas cores, no máximo duas séries por gráfico). */
  grupos?: { titulo: string; series: string[] }[];
}

interface LinhaAnalise {
  rotulo: string;
  valor: number;
  base?: number;
  numerador?: number;
  /** Composição do valor (por exemplo, poda, supressão e recolhimento), em texto. */
  detalhe?: string;
}

export function AnalisesPagina() {
  const filtros = useSearch({ from: "/autenticado/analises" });
  const navegar = useNavigate({ from: "/analises" });
  const catalogo = useRelatoriosCatalogo();
  const analises = (catalogo.data?.data.analises ?? []) as {
    id: string;
    titulo: string;
    definicao: string;
  }[];
  const selecionada = filtros.analise ?? analises[0]?.id;
  const consulta = useRelatoriosAnalise(
    { analise: selecionada ?? "", inicio: filtros.inicio, fim: filtros.fim },
    { query: { enabled: !!selecionada } },
  );
  const podeExportar = usePermissao("relatorios.exportar");
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const filtrar = (parcial: Partial<BuscaAnalises>) =>
    void navegar({ search: (s: BuscaAnalises) => ({ ...s, ...parcial }) });

  const baixar = async (
    rotulo: string,
    caminho: string,
    parametros: Record<string, string | undefined>,
  ) => {
    setBaixando(rotulo);
    setErro(null);
    try {
      await baixarArquivo(caminho, parametros);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Falha ao gerar o arquivo.");
    } finally {
      setBaixando(null);
    }
  };

  const dados = consulta.data?.data;
  const linhas = (dados?.linhas ?? []) as unknown as LinhaAnalise[];
  const percentual = dados?.unidade === "%";
  const baseRotulo = dados?.base_rotulo || "concluídas";
  const maximo = percentual ? 100 : Math.max(1, ...linhas.map((l) => l.valor));
  const evolucao = (dados?.serie_mensal ?? null) as SerieMensal | null;

  return (
    <div className="mx-auto max-w-6xl">
      <CabecalhoPagina
        titulo="Análises e relatórios"
        descricao="Indicadores calculados sobre o seu escopo, com definição e fonte, e exportações com metadados."
      />

      {podeExportar && (
        <section className="mb-6 rounded-lg border border-borda bg-superficie p-4">
          <h2 className="mb-1 font-semibold">Exportações</h2>
          <p className="mb-3 text-sm text-texto-suave">
            Cada arquivo inclui data de geração, usuário, filtros, fontes e sistema de referência.
            Toda exportação fica registrada na auditoria.
          </p>
          <div className="flex flex-wrap gap-2">
            <MenuAgrupado
              rotulo="Exportar dados"
              icone={<Download />}
              desabilitado={baixando !== null}
              grupos={(
                [
                  ["arvores", "Inventário"],
                  ["ocorrencias", "Ocorrências"],
                  ["alertas", "Alertas ambientais"],
                ] as const
              ).map(([conjunto, nome]) => ({
                titulo: nome,
                itens: (
                  [
                    ["csv", "CSV"],
                    ["xlsx", "XLSX"],
                    ["geojson", "GeoJSON"],
                  ] as const
                ).map(([formato, rotulo]) => ({
                  rotulo: `${nome} (${rotulo})`,
                  aoEscolher: () =>
                    void baixar(`${conjunto}-${formato}`, "/api/v1/relatorios/exportar", {
                      conjunto,
                      formato,
                    }),
                })),
              }))}
            />
            <Botao
              variante="secundario"
              disabled={baixando !== null}
              onClick={() =>
                void baixar("pdf", "/api/v1/relatorios/painel.pdf", {
                  inicio: filtros.inicio,
                  fim: filtros.fim,
                })
              }
            >
              <FileText /> Relatório de indicadores (PDF)
            </Botao>
          </div>
          {baixando && (
            <p role="status" className="mt-2 text-sm text-texto-suave">
              Gerando arquivo…
            </p>
          )}
          {erro && (
            <p role="alert" className="mt-2 text-sm text-perigo">
              {erro}
            </p>
          )}
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Análise"
          value={selecionada ?? ""}
          onChange={(e) => filtrar({ analise: e.target.value })}
          className="max-w-96"
        >
          {analises.map((a) => (
            <option key={a.id} value={a.id}>
              {a.titulo}
            </option>
          ))}
        </Selecao>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          De{" "}
          <EntradaData
            value={filtros.inicio ?? ""}
            onChange={(v) => filtrar({ inicio: v || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até{" "}
          <EntradaData
            value={filtros.fim ?? ""}
            onChange={(v) => filtrar({ fim: v || undefined })}
            className="w-40"
          />
        </label>
      </div>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <section className="rounded-lg border border-borda bg-superficie p-4">
          <h2 className="font-semibold">{dados!.titulo}</h2>
          <p className="text-sm text-texto-suave">{dados!.definicao}</p>
          <p className="mb-4 text-xs text-texto-suave">
            Período: {formatarData(String(dados!.periodo.inicio))} a{" "}
            {formatarData(String(dados!.periodo.fim))} · calculado em{" "}
            {formatarDataHora(dados!.calculado_em)} · fonte: {dados!.fonte}
          </p>
          {linhas.length === 0 ? (
            <Vazio titulo="Sem dados para o período" />
          ) : (
            <div className={evolucao ? "grid gap-6 lg:grid-cols-2" : undefined}>
              <Tabela>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="w-1/2">Valor</Th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <Linha key={l.rotulo}>
                      <Td>{l.rotulo}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded bg-neutro-clara" aria-hidden>
                            <div
                              className="h-2 rounded bg-marca"
                              style={{ width: `${(l.valor / maximo) * 100}%` }}
                            />
                          </div>
                          <span className="w-20 text-right font-medium tabular-nums">
                            {l.valor.toLocaleString("pt-BR")}
                            {percentual ? "%" : ""}
                          </span>
                        </div>
                        {l.detalhe && <p className="text-xs text-texto-suave">{l.detalhe}</p>}
                        {l.base !== undefined && (
                          <p className="text-xs text-texto-suave">
                            {l.numerador !== undefined
                              ? `${l.numerador.toLocaleString("pt-BR")} de ${l.base.toLocaleString("pt-BR")} ${baseRotulo}`
                              : `base: ${l.base} ${baseRotulo}`}
                          </p>
                        )}
                      </Td>
                    </Linha>
                  ))}
                </tbody>
                {dados!.total != null && (
                  <tfoot>
                    <tr>
                      <Td className="font-semibold">Total</Td>
                      <Td className="text-right font-semibold tabular-nums">
                        {dados!.total.toLocaleString("pt-BR")}
                      </Td>
                    </tr>
                  </tfoot>
                )}
              </Tabela>
              {evolucao && (
                <div>
                  {(evolucao.grupos ?? [{ titulo: "Evolução mensal", series: [] }]).map((g) => (
                    <div key={g.titulo} className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold">{g.titulo}</h3>
                      <GraficoMensal
                        meses={evolucao.meses}
                        series={
                          g.series.length
                            ? evolucao.series.filter((s) => g.series.includes(s.id))
                            : evolucao.series
                        }
                        semDado={evolucao.sem_dado}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
