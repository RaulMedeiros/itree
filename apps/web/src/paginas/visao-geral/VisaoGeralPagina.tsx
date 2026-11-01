import { useEquipesListar, useIndicadoresPainel, useTerritoriosListar } from "@itree/api-client";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Info } from "lucide-react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { LinhaDoTempo } from "../../componentes/Historico";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Tabela, Td, Th, Linha } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";

export interface BuscaVisaoGeral {
  inicio?: string;
  fim?: string;
  bairro?: string;
  equipe?: string;
}

interface Indicador {
  id: string;
  nome: string;
  definicao: string;
  formula: string;
  valor: number | null;
  base: number | null;
  unidade: string;
  periodo: string;
  fonte: string;
  link: { pagina: string; filtros: Record<string, string> } | null;
}

interface Distribuicao {
  titulo: string;
  definicao: string;
  nao_confirmadas?: number;
  itens: { rotulo: string; quantidade: number }[];
}

interface DesempenhoEquipe {
  equipe: string;
  tarefas_abertas: number;
  tarefas_atrasadas: number;
  tarefas_concluidas_periodo: number;
  inspecoes_periodo: number;
}

function valorFormatado(i: Indicador) {
  if (i.valor === null) return "Sem dados";
  const numero = i.valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return i.unidade === "%" ? `${numero}%` : i.unidade ? `${numero} ${i.unidade}` : numero;
}

function CartaoIndicador({ i }: { i: Indicador }) {
  const conteudo = (
    <>
      <p className="text-sm font-medium text-texto-suave">{i.nome}</p>
      <p className={`mt-1 text-2xl font-semibold ${i.valor === null ? "text-texto-suave" : ""}`}>
        {valorFormatado(i)}
      </p>
      <p className="mt-1 text-xs text-texto-suave">
        {i.periodo === "selecionado" ? "No período" : "Situação atual"}
        {i.base !== null && i.unidade === "%" ? ` · base: ${i.base.toLocaleString("pt-BR")}` : ""}
        {i.base !== null && i.unidade === "dias" ? ` · ${i.base} concluídas` : ""}
      </p>
    </>
  );
  // A definição fica fora do link (não se aninha controle interativo em <a>) e
  // num <details>, alcançável por teclado e toque — não só por hover (RNF-A11Y).
  return (
    <div className="rounded-lg border border-borda bg-superficie p-4 has-[a:hover]:border-marca">
      {i.link ? (
        <Link to={i.link.pagina} search={i.link.filtros} className="block">
          {conteudo}
        </Link>
      ) : (
        conteudo
      )}
      <details className="mt-2 text-xs text-texto-suave">
        <summary className="inline-flex cursor-pointer items-center gap-1">
          <Info className="size-3.5" aria-hidden /> Como é calculado
        </summary>
        <p className="mt-1">{i.definicao}</p>
        <p className="mt-1">Fórmula: {i.formula}</p>
        <p className="mt-1">Fonte: {i.fonte}</p>
      </details>
    </div>
  );
}

function Barras({ d }: { d: Distribuicao }) {
  const maximo = Math.max(1, ...d.itens.map((i) => i.quantidade));
  return (
    <section className="rounded-lg border border-borda bg-superficie p-4">
      <h2 className="font-semibold">{d.titulo}</h2>
      <p className="mb-3 text-xs text-texto-suave">{d.definicao}</p>
      {d.itens.length === 0 ? (
        <p className="text-sm text-texto-suave">Sem dados no período e filtros.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {d.itens.map((item) => (
            <li key={item.rotulo} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate">{item.rotulo}</span>
                <span className="font-medium tabular-nums">
                  {item.quantidade.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-0.5 h-2 rounded bg-neutro-clara" aria-hidden>
                <div
                  className="h-2 rounded bg-marca"
                  style={{ width: `${(item.quantidade / maximo) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {d.nao_confirmadas ? (
        <p className="mt-3 text-xs text-texto-suave">
          {d.nao_confirmadas.toLocaleString("pt-BR")} árvores válidas ainda sem espécie confirmada
          não entram nesta distribuição.
        </p>
      ) : null}
    </section>
  );
}

export function VisaoGeralPagina() {
  const filtros = useSearch({ from: "/autenticado/visao-geral" });
  const navegar = useNavigate({ from: "/visao-geral" });
  const consulta = useIndicadoresPainel(filtros);
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const podeEquipes = usePermissao("tarefas.ler");
  const equipes = useEquipesListar(
    { ativa: true, tamanho: 200 },
    { query: { enabled: podeEquipes } },
  );
  const filtrar = (parcial: Partial<BuscaVisaoGeral>) =>
    void navegar({ search: (s: BuscaVisaoGeral) => ({ ...s, ...parcial }) });
  const dados = consulta.data?.data;

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Visão geral"
        descricao={
          dados
            ? `Período de ${formatarData(String(dados.periodo.inicio))} a ${formatarData(String(dados.periodo.fim))} · calculado em ${formatarDataHora(dados.calculado_em)} · indicadores oficiais ainda em definição (DP-14)`
            : "Indicadores do seu escopo territorial."
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          De
          <Entrada
            type="date"
            value={filtros.inicio ?? ""}
            onChange={(e) => filtrar({ inicio: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <Entrada
            type="date"
            value={filtros.fim ?? ""}
            onChange={(e) => filtrar({ fim: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        <Selecao
          aria-label="Bairro"
          value={filtros.bairro ?? ""}
          onChange={(e) => filtrar({ bairro: e.target.value || undefined })}
          className="max-w-52"
        >
          <option value="">Todo o escopo</option>
          {bairros.data?.data.results.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </Selecao>
        {equipes.data && (
          <Selecao
            aria-label="Equipe"
            value={filtros.equipe ?? ""}
            onChange={(e) => filtrar({ equipe: e.target.value || undefined })}
            className="max-w-52"
          >
            <option value="">Todas as equipes</option>
            {equipes.data.data.results.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </Selecao>
        )}
      </div>

      {consulta.isPending ? (
        <Carregando linhas={6} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {(dados!.indicadores as unknown as Indicador[]).map((i) => (
              <CartaoIndicador key={i.id} i={i} />
            ))}
          </div>
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            {Object.values(dados!.distribuicoes as unknown as Record<string, Distribuicao>).map(
              (d) => (
                <Barras key={d.titulo} d={d} />
              ),
            )}
          </div>
          {dados!.equipes.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 font-semibold">Desempenho por equipe</h2>
              <Tabela>
                <thead>
                  <tr>
                    <Th>Equipe</Th>
                    <Th>Tarefas abertas</Th>
                    <Th>Atrasadas</Th>
                    <Th>Concluídas no período</Th>
                    <Th>Inspeções no período</Th>
                  </tr>
                </thead>
                <tbody>
                  {(dados!.equipes as unknown as DesempenhoEquipe[]).map((e) => (
                    <Linha key={e.equipe}>
                      <Td className="font-medium">{e.equipe}</Td>
                      <Td>{e.tarefas_abertas}</Td>
                      <Td className={e.tarefas_atrasadas ? "text-perigo" : ""}>
                        {e.tarefas_atrasadas}
                      </Td>
                      <Td>{e.tarefas_concluidas_periodo}</Td>
                      <Td>{e.inspecoes_periodo}</Td>
                    </Linha>
                  ))}
                </tbody>
              </Tabela>
              <p className="mt-1 text-xs text-texto-suave">
                Números da equipe, sem ranqueamento individual (RN-EQP-002).
              </p>
            </section>
          )}
          {dados!.atividades.length > 0 && (
            <section>
              <h2 className="mb-3 font-semibold">Atividades recentes</h2>
              <LinhaDoTempo eventos={dados!.atividades} carregando={false} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
