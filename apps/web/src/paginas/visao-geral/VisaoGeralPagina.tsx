import {
  useEquipesListar,
  useIndicadoresPainel,
  useTerritoriosListar,
  type PainelIndicadores,
} from "@itree/api-client";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Info,
  Leaf,
  Minus,
  ShieldAlert,
  Timer,
  TreeDeciduous,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ROTULOS_CONDICAO } from "@itree/domain";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { LinhaDoTempo } from "../../componentes/Historico";
import { EntradaData, Selecao } from "../../ui/campos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { CORES_CONDICAO } from "../../mapa/simbologia";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Tabela, Td, Th, Linha } from "../../ui/tabela";
import { cn } from "../../util/cn";
import {
  descreverVariacao,
  formatarData,
  formatarDataCurta,
  formatarDataHora,
  plural,
} from "../../util/formatos";
import {
  BarraSegmentada,
  BarrasHorizontais,
  GraficoMensal,
  Sparkline,
  type PontoSerie,
  type Serie,
} from "./graficos";
import { MapaResumo } from "./MapaResumo";

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
  anterior?: number | null;
  /** Data do valor anterior: início do período anterior ou data do registro (M-11). */
  anterior_em?: string | null;
  /** Instantâneos registrados (até 12 pontos, mensais); vazia sem histórico. */
  serie?: PontoSerie[];
}

interface Pendencia {
  id: string;
  titulo: string;
  gravidade: string;
  quantidade: number;
  link: { pagina: string; filtros: Record<string, string> };
}

interface SeriesMensais {
  meses: string[];
  definicao: string;
  series: Serie[];
}

interface Distribuicao {
  titulo: string;
  definicao: string;
  nao_confirmadas?: number;
  itens: { rotulo: string; quantidade: number }[];
}

interface BairroAtencao {
  id: string;
  nome: string;
  indice: number;
  componentes: { id: string; rotulo: string; quantidade: number; peso: number }[];
  link: { pagina: string; filtros: Record<string, string> };
}

interface BairrosAtencao {
  titulo: string;
  definicao: string;
  formula: string;
  itens: BairroAtencao[];
}

interface DesempenhoEquipe {
  equipe: string;
  tarefas_abertas: number;
  tarefas_atrasadas: number;
  tarefas_concluidas_periodo: number;
  inspecoes_periodo: number;
}

interface IndicadorExterno {
  id: string;
  nome: string;
  valor: number | null;
  numerador: number;
  base: number | null;
  unidade: string;
  fonte: string;
  fonte_url: string;
  licenca: string;
  data_referencia: string | null;
  ingerido_em: string;
  definicao: string;
  metodo: string;
  bairros_com_dado: number;
  bairros_no_escopo: number;
}

const ICONES: Record<string, LucideIcon> = {
  arvores_validas: TreeDeciduous,
  especie_confirmada: Leaf,
  cobertura_inspecao: ClipboardCheck,
  inspecoes_realizadas: CalendarCheck,
  ocorrencias_abertas: TriangleAlert,
  tempo_atendimento: Timer,
};
const DESTAQUE = Object.keys(ICONES);
/** Direção desejável da variação: inspeções subir é bom; tempo de atendimento cair é bom. */
const MELHOR_SUBIR: Record<string, boolean | undefined> = {
  inspecoes_realizadas: true,
  tempo_atendimento: false,
  arvores_validas: true,
  especie_confirmada: true,
  com_medidas: true,
  cobertura_inspecao: true,
  tarefas_atrasadas: false,
  ocorrencias_atrasadas: false,
};

function valorFormatado(i: Indicador) {
  if (i.valor === null) return "Sem dados";
  const numero = i.valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return i.unidade === "%" ? `${numero}%` : i.unidade ? `${numero} ${i.unidade}` : numero;
}

/** Linha única de comparação, igual em todos os cartões: sinal e texto ("melhorou",
 * "piorou") acompanham a cor, e a data-base é sempre explícita. */
function LinhaComparacao({
  texto,
  data,
  rotuloBase,
  diferenca,
  bom,
}: {
  texto: string;
  data: string | null | undefined;
  rotuloBase: string;
  diferenca: number;
  bom: boolean | null;
}) {
  const Icone = diferenca === 0 ? Minus : diferenca > 0 ? ArrowUpRight : ArrowDownRight;
  const avaliacao = diferenca === 0 || bom === null ? "" : bom ? " · melhorou" : " · piorou";
  return (
    <p
      className={cn(
        "flex items-start gap-1 text-xs font-medium",
        diferenca === 0 || bom === null ? "text-texto-suave" : bom ? "text-sucesso" : "text-perigo",
      )}
    >
      <Icone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {diferenca === 0 ? "Igual" : texto} vs. {data ? `${formatarDataCurta(data)} ` : ""}(
        {rotuloBase}){avaliacao}
      </span>
    </p>
  );
}

function Variacao({ i }: { i: Indicador }) {
  if (i.periodo !== "selecionado" || i.anterior === null || i.anterior === undefined) return null;
  if (i.valor === null) return null;
  // Contagens com base pequena mostram a diferença absoluta; médias (dias) seguem em %.
  const { texto, diferenca } =
    i.unidade === "" ? descreverVariacao(i.valor, i.anterior) : porcentagem(i.valor, i.anterior);
  if (texto === null) {
    return <p className="text-xs text-texto-suave">Período anterior: 0</p>;
  }
  const subiu = diferenca > 0;
  const bom = MELHOR_SUBIR[i.id] === undefined ? null : MELHOR_SUBIR[i.id] === subiu;
  return (
    <LinhaComparacao
      texto={texto}
      data={i.anterior_em}
      rotuloBase="período anterior"
      diferenca={diferenca}
      bom={bom}
    />
  );
}

function porcentagem(valor: number, anterior: number) {
  const diferenca = valor - anterior;
  if (anterior === 0) return { texto: null, diferenca };
  const pct = Math.round((100 * diferenca) / anterior);
  return { texto: `${pct > 0 ? "+" : ""}${pct}%`, diferenca };
}

/** Variação de um instantâneo desde o registro anterior ao período (ou, sem ele,
 * o primeiro ponto da série), com a data; mais o sparkline. Sem série, nada. */
function Tendencia({ i }: { i: Indicador }) {
  const serie = i.serie ?? [];
  if (i.periodo === "selecionado" || serie.length < 2 || i.valor === null) return null;
  const referencia =
    i.anterior != null && i.anterior_em ? { valor: i.anterior, data: i.anterior_em } : serie[0]!;
  const diferenca = Math.round((i.valor - referencia.valor) * 10) / 10;
  const numero = Math.abs(diferenca).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const texto = i.unidade === "%" ? `${sinal}${numero} p.p.` : `${sinal}${numero}`;
  const bom =
    MELHOR_SUBIR[i.id] === undefined || diferenca === 0
      ? null
      : MELHOR_SUBIR[i.id] === diferenca > 0;
  return (
    <div>
      <LinhaComparacao
        texto={texto}
        data={referencia.data}
        rotuloBase="registro anterior"
        diferenca={diferenca}
        bom={bom}
      />
      <Sparkline serie={serie} unidade={i.unidade} />
    </div>
  );
}

/** Janela temporal do indicador, dita só em "Como é calculado": a face do cartão fica
 * com valor, nome, comparação e tendência. */
function textoJanela(i: Indicador): string {
  if (i.periodo === "selecionado") return "o período selecionado";
  const fixa = /12 meses/.test(i.nome);
  return `${fixa ? "fixa de 12 meses" : "situação atual"} (ignora o período)`;
}

/** "Como é calculado": definição, fórmula, base, janela e fonte, fora da face do cartão. */
function Definicao({
  i,
  compacta = false,
  notas = [],
}: {
  i: Indicador;
  compacta?: boolean;
  notas?: string[];
}) {
  return (
    <details className="mt-2 text-xs text-texto-suave">
      <summary
        className="inline-flex cursor-pointer items-center gap-1"
        title={compacta ? "Como é calculado" : undefined}
      >
        <Info className="size-3.5" aria-hidden />{" "}
        <span className={compacta ? "sr-only" : undefined}>Como é calculado</span>
      </summary>
      <p className="mt-1">{i.definicao}</p>
      <p className="mt-1">Fórmula: {i.formula}</p>
      {i.base !== null && i.unidade !== "dias" && (
        <p className="mt-1">Base: {i.base.toLocaleString("pt-BR")} árvores válidas</p>
      )}
      {notas.map((n) => (
        <p key={n} className="mt-1">
          {n}
        </p>
      ))}
      <p className="mt-1">Janela: {textoJanela(i)}</p>
      <p className="mt-1">Fonte: {i.fonte}</p>
    </details>
  );
}

function CartaoDestaque({ i, notas }: { i: Indicador; notas?: string[] }) {
  const Icone = ICONES[i.id] ?? Info;
  const conteudo = (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-marca-clara text-marca">
        <Icone className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-2xl leading-tight font-semibold",
            i.valor === null && "text-texto-suave",
          )}
        >
          {valorFormatado(i)}
        </p>
        <p className="text-sm text-texto-suave">{i.nome}</p>
      </div>
    </div>
  );
  // Altura igual na linha: o cartão estica e o "Como é calculado" fica no pé.
  return (
    <div className="flex h-full flex-col rounded-xl border border-borda bg-superficie p-4 shadow-sm has-[a:hover]:border-marca">
      {i.link ? (
        <Link to={i.link.pagina} search={i.link.filtros} className="block">
          {conteudo}
        </Link>
      ) : (
        conteudo
      )}
      <div className="mt-2 flex flex-col gap-0.5 pl-[3.25rem]">
        <Variacao i={i} />
        <Tendencia i={i} />
      </div>
      <div className="mt-auto">
        <Definicao i={i} compacta notas={notas} />
      </div>
    </div>
  );
}

/** Linha simples de um indicador secundário: nome, valor e, se houver, a comparação. */
function LinhaIndicador({ i }: { i: Indicador }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-texto-suave">{i.nome}</p>
        <p className={cn("font-semibold tabular-nums", i.valor === null && "text-texto-suave")}>
          {i.link ? (
            <Link to={i.link.pagina} search={i.link.filtros} className="hover:underline">
              {valorFormatado(i)}
            </Link>
          ) : (
            valorFormatado(i)
          )}
        </p>
      </div>
      <Variacao i={i} />
      <Tendencia i={i} />
      <Definicao i={i} compacta />
    </li>
  );
}

/** Indicador de fonte pública externa: separado dos da operação (borda tracejada,
 * fundo neutro) e sempre com órgão, data de referência, ingestão e definição. */
function CartaoExterno({ i }: { i: IndicadorExterno }) {
  const numero =
    i.valor === null
      ? "Sem dados"
      : `${i.valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${i.unidade === "%" ? "%" : ""}`;
  const ano = i.data_referencia?.slice(0, 4);
  return (
    <article
      aria-label={i.nome}
      className="rounded-xl border border-dashed border-borda bg-fundo p-4 sm:max-w-md"
    >
      <p className="text-sm text-texto-suave">{i.nome}</p>
      <p
        className={cn(
          "text-2xl leading-tight font-semibold",
          i.valor === null && "text-texto-suave",
        )}
      >
        {numero}
      </p>
      {i.base !== null && (
        <p className="text-xs text-texto-suave">
          {i.numerador.toLocaleString("pt-BR")} de {i.base.toLocaleString("pt-BR")} faces de quadra
          {i.bairros_no_escopo > i.bairros_com_dado
            ? ` · ${i.bairros_com_dado} de ${i.bairros_no_escopo} bairros do escopo com dado`
            : ` · ${i.bairros_com_dado} bairro${i.bairros_com_dado === 1 ? "" : "s"}`}
        </p>
      )}
      <p className="mt-1 text-xs text-texto-suave">
        Fonte:{" "}
        <a
          href={i.fonte_url}
          target="_blank"
          rel="noreferrer"
          className="text-marca-escura underline"
        >
          {i.fonte}
        </a>
        {ano ? ` (referência: ${ano})` : ""} · ingerido em {formatarData(i.ingerido_em)}
      </p>
      <details className="mt-2 text-xs text-texto-suave">
        <summary className="inline-flex cursor-pointer items-center gap-1">
          <Info className="size-3.5" aria-hidden /> Como é calculado
        </summary>
        <p className="mt-1">{i.definicao}</p>
        <p className="mt-1">Método: {i.metodo}</p>
        <p className="mt-1">Licença ou termos: {i.licenca}</p>
      </details>
    </article>
  );
}

const GRAVIDADE: Record<string, { classe: string; Icone: LucideIcon; rotulo: string }> = {
  critica: { classe: "text-perigo bg-perigo-clara", Icone: ShieldAlert, rotulo: "Crítica" },
  alta: { classe: "text-atencao bg-atencao-clara", Icone: TriangleAlert, rotulo: "Alta" },
  media: { classe: "text-info bg-info-clara", Icone: CircleAlert, rotulo: "Média" },
};

function Pendencias({ itens }: { itens: Pendencia[] }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-borda bg-superficie p-4">
      <h2 className="font-semibold">Alertas e pendências</h2>
      <p className="mb-3 text-xs text-texto-suave">O que precisa de ação agora, no seu escopo.</p>
      {itens.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-sucesso">
          <CircleCheck className="size-4" aria-hidden /> Nenhuma pendência no momento.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-borda">
          {itens.map((p) => {
            const g = GRAVIDADE[p.gravidade] ?? GRAVIDADE.media!;
            return (
              <li key={p.id}>
                <Link
                  to={p.link.pagina}
                  search={p.link.filtros}
                  className="group flex items-center gap-3 py-2.5"
                >
                  <span
                    className={cn("grid size-8 shrink-0 place-items-center rounded-lg", g.classe)}
                  >
                    <g.Icone className="size-4" aria-hidden />
                    <span className="sr-only">Gravidade {g.rotulo.toLowerCase()}</span>
                  </span>
                  <span className="flex-1 text-sm group-hover:underline">{p.titulo}</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {p.quantidade.toLocaleString("pt-BR")}
                  </span>
                  <ChevronRight className="size-4 text-texto-suave" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Ranking dos bairros do escopo por um índice simples: cada componente aparece separado
 * e a fórmula, em "Como é calculado". Cada bairro abre o mapa com ele em destaque. */
function BairrosQuePedemAtencao({ dados }: { dados: BairrosAtencao }) {
  return (
    <Painel
      titulo={dados.titulo}
      definicao="Onde agir primeiro: os bairros do seu escopo com mais ocorrências e árvores pendentes."
      className="mb-4"
    >
      {dados.itens.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-sucesso">
          <CircleCheck className="size-4" aria-hidden /> Nenhum bairro com pendência no momento.
        </p>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Bairro</Th>
              {dados.itens[0]!.componentes.map((c) => (
                <Th key={c.id} className="text-right">
                  {c.rotulo}
                </Th>
              ))}
              <Th className="text-right">Índice</Th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((b, posicao) => (
              <Linha key={b.id}>
                <Td className="font-medium">
                  <span className="mr-2 text-texto-suave tabular-nums">{posicao + 1}.</span>
                  <Link
                    to={b.link.pagina}
                    search={b.link.filtros}
                    className="text-marca-escura hover:underline"
                    aria-label={`${b.nome}: ver no mapa`}
                  >
                    {b.nome}
                  </Link>
                </Td>
                {b.componentes.map((c) => (
                  <Td
                    key={c.id}
                    className={cn(
                      "text-right tabular-nums",
                      c.quantidade === 0 && "text-texto-suave",
                    )}
                  >
                    {c.quantidade.toLocaleString("pt-BR")}
                  </Td>
                ))}
                <Td className="text-right font-semibold tabular-nums">
                  {b.indice.toLocaleString("pt-BR")}
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      <details className="mt-3 text-xs text-texto-suave">
        <summary className="inline-flex cursor-pointer items-center gap-1">
          <Info className="size-3.5" aria-hidden /> Como é calculado
        </summary>
        <p className="mt-1">{dados.definicao}</p>
        <p className="mt-1">Índice = {dados.formula}.</p>
        <p className="mt-1">
          Ordem: do maior para o menor índice; em empate, por nome. Fonte: {FONTE_REGISTROS}.
        </p>
      </details>
    </Painel>
  );
}

const FONTE_REGISTROS = "Registros da plataforma";

/** Cor da condição pelo rótulo devolvido pela API; texto da barra por luminância. */
const COR_POR_ROTULO: Record<string, { cor: string; textoClaro: boolean }> = {
  ...Object.fromEntries(
    (Object.keys(ROTULOS_CONDICAO) as (keyof typeof ROTULOS_CONDICAO)[]).map((c) => [
      ROTULOS_CONDICAO[c],
      { cor: CORES_CONDICAO[c], textoClaro: c === "morta" },
    ]),
  ),
  "Sem avaliação registrada": { cor: CORES_CONDICAO.nao_avaliada, textoClaro: false },
};

/** Ordem semântica da condição: da melhor para a pior; sem avaliação por último. */
const ORDEM_CONDICAO = [
  "Boa",
  "Regular",
  "Ruim",
  "Aparentemente morta",
  "Sem avaliação registrada",
];
const ordemCondicao = (rotulo: string) =>
  ORDEM_CONDICAO.includes(rotulo) ? ORDEM_CONDICAO.indexOf(rotulo) : ORDEM_CONDICAO.length;

function Painel({
  titulo,
  definicao,
  children,
  className,
}: {
  titulo: string;
  definicao?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-borda bg-superficie p-4", className)}>
      <h2 className="font-semibold">{titulo}</h2>
      {definicao && <p className="mb-3 text-xs text-texto-suave">{definicao}</p>}
      {children}
    </section>
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diasAtras = (hoje: Date, dias: number) =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias);

/** Atalhos de período; o fim é sempre hoje. */
const ATALHOS_PERIODO: {
  rotulo: string;
  periodo: (hoje: Date) => Pick<BuscaVisaoGeral, "inicio" | "fim">;
}[] = [
  { rotulo: "30 dias", periodo: (h) => ({ inicio: iso(diasAtras(h, 30)), fim: iso(h) }) },
  { rotulo: "12 meses", periodo: (h) => ({ inicio: iso(diasAtras(h, 365)), fim: iso(h) }) },
  {
    rotulo: "Ano",
    periodo: (h) => ({ inicio: iso(new Date(h.getFullYear(), 0, 1)), fim: iso(h) }),
  },
];

export function VisaoGeralPagina() {
  const filtros = useSearch({ from: "/autenticado/visao-geral" });
  const navegar = useNavigate({ from: "/visao-geral" });
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const consulta = useIndicadoresPainel({ ...filtros, bairro });
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
          <EntradaData
            value={filtros.inicio ?? String(dados?.periodo.inicio ?? "")}
            onChange={(v) => filtrar({ inicio: v || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <EntradaData
            value={filtros.fim ?? String(dados?.periodo.fim ?? "")}
            onChange={(v) => filtrar({ fim: v || undefined })}
            className="w-40"
          />
        </label>
        <div className="flex items-center gap-1" role="group" aria-label="Atalhos de período">
          {ATALHOS_PERIODO.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => filtrar(a.periodo(new Date()))}
              className="rounded-md border border-borda px-2 py-1 text-xs text-texto-suave hover:border-marca hover:text-marca-escura"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <Selecao
          aria-label="Bairro"
          value={bairro ?? ""}
          onChange={(e) => {
            filtrar({ bairro: e.target.value || undefined });
            aoEscolherBairro(e.target.value);
          }}
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
        <ConteudoPainel dados={dados!} />
      )}
    </div>
  );
}

function ConteudoPainel({ dados }: { dados: PainelIndicadores }) {
  const indicadores = dados.indicadores as unknown as Indicador[];
  const porId = Object.fromEntries(indicadores.map((i) => [i.id, i]));
  const distribuicoes = dados.distribuicoes as unknown as Record<string, Distribuicao>;
  const series = dados.series_mensais as unknown as SeriesMensais;
  const pendencias = dados.pendencias as unknown as Pendencia[];
  const bairrosAtencao = dados.bairros_atencao as unknown as BairrosAtencao | undefined;
  // Não repete o que já está nos cartões nem em "Alertas e pendências" (que traz, com
  // link, os que têm quantidade). A contagem de registros fica na base do 1º cartão.
  const repetidos = new Set([...DESTAQUE, "arvores_registros", ...pendencias.map((p) => p.id)]);
  const outros = indicadores.filter((i) => !repetidos.has(i.id));
  const externos = (dados.contexto_externo ?? []) as unknown as IndicadorExterno[];
  return (
    <>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {DESTAQUE.filter((id) => porId[id]).map((id) => (
              <CartaoDestaque
                key={id}
                i={porId[id]!}
                notas={
                  id === "arvores_validas" && porId.arvores_registros?.valor
                    ? [
                        `Base: ${porId.arvores_registros.valor.toLocaleString("pt-BR")} registros no escopo, em qualquer situação.`,
                      ]
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <Pendencias itens={pendencias} />
      </div>

      {bairrosAtencao && <BairrosQuePedemAtencao dados={bairrosAtencao} />}

      <div className="mb-4">
        <MapaResumo />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Painel
          titulo="Inspeções e ocorrências por mês"
          definicao={series.definicao}
          className="lg:col-span-2"
        >
          <GraficoMensal meses={series.meses} series={series.series} />
        </Painel>
        <div className="flex flex-col gap-4">
          {distribuicoes.condicao_aparente && (
            <Painel
              titulo={distribuicoes.condicao_aparente.titulo}
              definicao={distribuicoes.condicao_aparente.definicao}
            >
              <BarraSegmentada
                partes={[...distribuicoes.condicao_aparente.itens]
                  .sort((a, b) => ordemCondicao(a.rotulo) - ordemCondicao(b.rotulo))
                  .map((c) => ({
                    rotulo: c.rotulo,
                    quantidade: c.quantidade,
                    ...(COR_POR_ROTULO[c.rotulo] ?? { cor: "#a3ada7", textoClaro: false }),
                  }))}
              />
            </Painel>
          )}
          {distribuicoes.ocorrencias_prioridade && (
            <Painel
              titulo={distribuicoes.ocorrencias_prioridade.titulo}
              definicao={distribuicoes.ocorrencias_prioridade.definicao}
            >
              <BarrasHorizontais itens={distribuicoes.ocorrencias_prioridade.itens} cor="#eb6834" />
            </Painel>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {distribuicoes.especies && (
          <Painel
            titulo={distribuicoes.especies.titulo}
            definicao={distribuicoes.especies.definicao}
            className="lg:col-span-2"
          >
            <BarrasHorizontais
              itens={distribuicoes.especies.itens.map((e) => ({ ...e, italico: true }))}
              cor="#2f9e44"
            />
            {distribuicoes.especies.nao_confirmadas ? (
              <p className="mt-3 text-xs text-texto-suave">
                {plural(distribuicoes.especies.nao_confirmadas, "árvore válida", "árvores válidas")}{" "}
                ainda sem espécie confirmada{" "}
                {distribuicoes.especies.nao_confirmadas === 1 ? "não entra" : "não entram"} nesta
                distribuição.{" "}
                <Link
                  to="/inventario/arvores"
                  search={{ especie_estado: "nao_confirmada", valida: true }}
                  className="text-marca-escura underline"
                >
                  Ver {plural(distribuicoes.especies.nao_confirmadas, "árvore", "árvores")}
                </Link>
              </p>
            ) : null}
          </Painel>
        )}
        {outros.length > 0 && (
          <Painel
            titulo="Outros indicadores"
            definicao="O que não está nos cartões nem em “Alertas e pendências”."
          >
            <ul className="flex flex-col divide-y divide-borda">
              {outros.map((i) => (
                <LinhaIndicador key={i.id} i={i} />
              ))}
            </ul>
          </Painel>
        )}
      </div>

      {externos.length > 0 && (
        <section aria-labelledby="contexto-externo" className="mb-6">
          <h2 id="contexto-externo" className="font-semibold">
            Contexto (fontes externas)
          </h2>
          <p className="mb-2 text-xs text-texto-suave">
            Dados públicos de outros órgãos, no seu escopo. Não vêm dos registros da operação e não
            entram nos indicadores acima.
          </p>
          <div className="flex flex-wrap gap-3">
            {externos.map((i) => (
              <CartaoExterno key={i.id} i={i} />
            ))}
          </div>
        </section>
      )}

      {dados.equipes.length > 0 && (
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
              {(dados.equipes as unknown as DesempenhoEquipe[]).map((e) => (
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
      {dados.atividades.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Atividades recentes</h2>
          <LinhaDoTempo eventos={dados.atividades} carregando={false} />
        </section>
      )}
    </>
  );
}
