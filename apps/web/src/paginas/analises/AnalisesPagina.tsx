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
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";

export interface BuscaAnalises {
  analise?: string;
  inicio?: string;
  fim?: string;
}

interface LinhaAnalise {
  rotulo: string;
  valor: number;
  base?: number;
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
  const maximo = Math.max(1, ...linhas.map((l) => l.valor));

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
            {(
              [
                ["arvores", "Inventário"],
                ["ocorrencias", "Ocorrências"],
                ["alertas", "Alertas ambientais"],
              ] as const
            ).flatMap(([conjunto, nome]) =>
              (["csv", "xlsx", "geojson"] as const).map((formato) => (
                <Botao
                  key={`${conjunto}-${formato}`}
                  tamanho="pequeno"
                  variante="secundario"
                  disabled={baixando !== null}
                  onClick={() =>
                    void baixar(`${conjunto}-${formato}`, "/api/v1/relatorios/exportar", {
                      conjunto,
                      formato,
                    })
                  }
                >
                  <Download /> {nome} ({formato.toUpperCase()})
                </Botao>
              )),
            )}
            <Botao
              tamanho="pequeno"
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
          <Entrada
            type="date"
            value={filtros.inicio ?? ""}
            onChange={(e) => filtrar({ inicio: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até{" "}
          <Entrada
            type="date"
            value={filtros.fim ?? ""}
            onChange={(e) => filtrar({ fim: e.target.value || undefined })}
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
                        </span>
                      </div>
                      {l.base !== undefined && (
                        <p className="text-xs text-texto-suave">base: {l.base} concluídas</p>
                      )}
                    </Td>
                  </Linha>
                ))}
              </tbody>
            </Tabela>
          )}
        </section>
      )}
    </div>
  );
}
