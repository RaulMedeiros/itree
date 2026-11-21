import { ChevronLeft, ChevronRight, Columns2, History, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Botao } from "../ui/botao";
import { cn } from "../util/cn";
import { CORES_CONDICAO, CORES_PRIORIDADE } from "./simbologia";
import { mesesEntre, mesAtual, rotuloDoMes, textoDoPeriodo, type SerieTemporal } from "./tempo";

/** Intervalo entre um mês e o seguinte na reprodução. */
export const PASSO_REPRODUCAO_MS = 800;
/** Espera depois de mexer no controle deslizante antes de pedir os tiles do novo mês. */
const ESPERA_DO_CONTROLE_MS = 200;

export interface ContagensNaData {
  arvores: number | null;
  ocorrencias_abertas: number | null;
  alertas: number | null;
}

interface Props {
  serie: SerieTemporal | undefined;
  /** Mês escolhido (`AAAA-MM`): a situação ao fim dele. */
  ate: string;
  /** Começo do intervalo; ausente = situação num mês só. */
  desde?: string;
  aoMudar: (periodo: { ate: string; desde?: string }) => void;
  aoDesligar: () => void;
  contagens?: ContagensNaData;
  comparando: boolean;
  aoComparar: (comparar: boolean) => void;
  /** No celular: controle enxuto, sem textos de apoio. */
  compacto?: boolean;
}

const numero = (n: number) => n.toLocaleString("pt-BR");

/** Botão "Linha do tempo": o controle começa desligado e o mapa mostra o presente. */
export function BotaoLinhaDoTempo({
  aoLigar,
  className,
}: {
  aoLigar: () => void;
  className?: string;
}) {
  return (
    <Botao
      variante="secundario"
      className={cn("pointer-events-auto self-start shadow max-md:h-12 max-md:px-4", className)}
      onClick={aoLigar}
    >
      <History /> Linha do tempo
    </Botao>
  );
}

/**
 * Controle de tempo do mapa: histograma mensal, controle deslizante por mês, reproduzir e passos,
 * modo intervalo e "Comparar com hoje". O período mora na URL (`ate`, `desde`); aqui só se escolhe.
 */
export function ControleTempo({
  serie,
  ate,
  desde,
  aoMudar,
  aoDesligar,
  contagens,
  comparando,
  aoComparar,
  compacto = false,
}: Props) {
  const ultimo = serie?.ultimo_mes ?? mesAtual();
  const primeiro = serie?.primeiro_mes ?? ultimo;
  const meses = useMemo(() => mesesEntre(primeiro, ultimo), [primeiro, ultimo]);
  const limitar = (indice: number) => Math.min(Math.max(indice, 0), meses.length - 1);
  const indiceDe = (mes: string) => {
    const i = meses.indexOf(mes);
    return i >= 0 ? i : mes < primeiro ? 0 : meses.length - 1;
  };
  const indiceAte = indiceDe(ate);
  const indiceDesde = desde ? Math.min(indiceDe(desde), indiceAte) : undefined;
  const intervalo = desde !== undefined;

  // Valor mostrado enquanto o controle é arrastado: a URL só muda quando a mão para.
  const [pendente, setPendente] = useState<{ ate?: number; desde?: number } | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (temporizador.current && clearTimeout(temporizador.current)), []);
  const mostradoAte = pendente?.ate ?? indiceAte;
  const mostradoDesde = pendente?.desde ?? indiceDesde;

  const confirmar = (novoAte: number, novoDesde?: number) =>
    aoMudar({
      ate: meses[limitar(novoAte)]!,
      desde: novoDesde === undefined ? undefined : meses[limitar(Math.min(novoDesde, novoAte))],
    });
  const arrastar = (parcial: { ate?: number; desde?: number }) => {
    setReproduzindo(false);
    const proximo = { ...pendente, ...parcial };
    setPendente(proximo);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      confirmar(proximo.ate ?? indiceAte, proximo.desde ?? indiceDesde);
      setPendente(null);
    }, ESPERA_DO_CONTROLE_MS);
  };
  // Passo e reprodução deslocam a janela inteira: no intervalo, `desde` acompanha `ate`.
  const irPara = (novoAte: number) => {
    const largura = indiceDesde === undefined ? undefined : indiceAte - indiceDesde;
    const alvo = limitar(novoAte);
    confirmar(alvo, largura === undefined ? undefined : Math.max(0, alvo - largura));
  };

  const [reproduzindo, setReproduzindo] = useState(false);
  const noFim = indiceAte >= meses.length - 1;
  const tocando = reproduzindo && !noFim;
  useEffect(() => {
    if (!tocando) return;
    const id = setTimeout(() => {
      irPara(indiceAte + 1);
      if (indiceAte + 2 >= meses.length) setReproduzindo(false);
    }, PASSO_REPRODUCAO_MS);
    return () => clearTimeout(id);
    // `irPara` é recriada a cada render; o tique depende só do mês atual e do estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocando, indiceAte, indiceDesde, meses.length]);
  const alternarReproducao = () => {
    if (tocando) return setReproduzindo(false);
    if (noFim) irPara(0);
    setReproduzindo(true);
  };
  // Mexer no controle à mão interrompe a reprodução.
  const aMao = (fn: () => void) => () => {
    setReproduzindo(false);
    fn();
  };

  const alternarIntervalo = () =>
    aoMudar({
      ate,
      desde: intervalo ? undefined : meses[Math.max(0, indiceAte - 2)],
    });

  const semDado = serie !== undefined && serie.primeiro_mes === null;
  const periodo = textoDoPeriodo(ate, desde);
  const botaoPasso = "size-9 px-0 max-md:size-11";

  return (
    <section
      aria-label="Linha do tempo"
      className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold" aria-live="polite">
          {periodo}
        </p>
        <div className="flex items-center gap-1">
          <Botao
            variante={intervalo ? "primario" : "secundario"}
            tamanho="pequeno"
            aria-pressed={intervalo}
            onClick={alternarIntervalo}
          >
            Intervalo
          </Botao>
          <Botao
            variante={comparando ? "primario" : "secundario"}
            tamanho="pequeno"
            aria-pressed={comparando}
            aria-label="Comparar com hoje"
            onClick={() => aoComparar(!comparando)}
          >
            <Columns2 /> {compacto ? "Comparar" : "Comparar com hoje"}
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="icone"
            className="size-8 max-md:size-11"
            aria-label="Desligar a linha do tempo"
            onClick={aoDesligar}
          >
            <X />
          </Botao>
        </div>
      </div>

      {semDado ? (
        <p className="text-texto-suave">
          Ainda não há dado com data para mostrar na linha do tempo.
        </p>
      ) : (
        <Histograma
          serie={serie}
          meses={meses}
          indiceAte={mostradoAte}
          indiceDesde={mostradoDesde}
          alto={compacto ? 24 : 36}
          aoEscolher={(i) => aMao(() => irPara(i))()}
        />
      )}

      <div className="flex items-center gap-1">
        <Botao
          variante="secundario"
          tamanho="icone"
          className={botaoPasso}
          aria-label="Mês anterior"
          disabled={indiceAte <= 0}
          onClick={aMao(() => irPara(indiceAte - 1))}
        >
          <ChevronLeft />
        </Botao>
        <Botao
          variante="primario"
          tamanho="icone"
          className={botaoPasso}
          aria-label={tocando ? "Pausar" : "Reproduzir"}
          onClick={alternarReproducao}
        >
          {tocando ? <Pause /> : <Play />}
        </Botao>
        <Botao
          variante="secundario"
          tamanho="icone"
          className={botaoPasso}
          aria-label="Próximo mês"
          disabled={noFim}
          onClick={aMao(() => irPara(indiceAte + 1))}
        >
          <ChevronRight />
        </Botao>
        <div className="flex min-w-0 flex-1 flex-col px-1">
          <input
            type="range"
            className="w-full accent-marca max-md:h-8"
            aria-label="Mês da linha do tempo"
            aria-valuetext={rotuloDoMes(meses[mostradoAte]!)}
            min={0}
            max={Math.max(meses.length - 1, 0)}
            step={1}
            value={mostradoAte}
            disabled={meses.length < 2}
            onChange={(e) => {
              const novo = Number(e.target.value);
              arrastar({
                ate: novo,
                // O começo do intervalo não passa do fim.
                desde: mostradoDesde === undefined ? undefined : Math.min(mostradoDesde, novo),
              });
            }}
          />
          {intervalo && mostradoDesde !== undefined && (
            <input
              type="range"
              className="w-full accent-info max-md:h-8"
              aria-label="Começo do intervalo"
              aria-valuetext={rotuloDoMes(meses[mostradoDesde]!)}
              min={0}
              max={Math.max(mostradoAte, 0)}
              step={1}
              value={mostradoDesde}
              onChange={(e) => arrastar({ desde: Number(e.target.value) })}
            />
          )}
          <div className="flex justify-between text-[11px] text-texto-suave">
            <span>{rotuloDoMes(meses[0]!)}</span>
            <span>{rotuloDoMes(meses[meses.length - 1]!)}</span>
          </div>
        </div>
      </div>

      {contagens && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="Contagens do período">
          {contagens.arvores !== null && (
            <li>
              {intervalo ? "Árvores cadastradas no período" : "Árvores na data"}:{" "}
              <strong>{numero(contagens.arvores)}</strong>
            </li>
          )}
          {contagens.ocorrencias_abertas !== null && (
            <li>
              Ocorrências abertas: <strong>{numero(contagens.ocorrencias_abertas)}</strong>
            </li>
          )}
          {contagens.alertas !== null && (
            <li>
              Alertas no período: <strong>{numero(contagens.alertas)}</strong>
            </li>
          )}
        </ul>
      )}
      {!compacto && (
        <p className="text-[11px] text-texto-suave">
          Árvores pela data de cadastro no iTree (não a do plantio) e a condição da última inspeção
          validada até a data.
        </p>
      )}
    </section>
  );
}

/** Árvores cadastradas (barras largas) e ocorrências registradas (barras finas) por mês; cada
 * série na própria escala. Clicar numa barra escolhe o mês. Decorativo: o controle deslizante é o
 * controle acessível. */
function Histograma({
  serie,
  meses,
  indiceAte,
  indiceDesde,
  alto,
  aoEscolher,
}: {
  serie: SerieTemporal | undefined;
  meses: string[];
  indiceAte: number;
  indiceDesde?: number;
  alto: number;
  aoEscolher: (indice: number) => void;
}) {
  const porMes = new Map((serie?.meses ?? []).map((m) => [m.mes, m]));
  const maior = (campo: "arvores" | "ocorrencias") =>
    Math.max(1, ...meses.map((m) => porMes.get(m)?.[campo] ?? 0));
  const maxArvores = maior("arvores");
  const maxOcorrencias = maior("ocorrencias");
  const largura = 10;
  const inicioSelecao = indiceDesde ?? indiceAte;
  return (
    <div className="flex flex-col gap-0.5">
      <svg
        data-testid="histograma-tempo"
        aria-hidden
        viewBox={`0 0 ${meses.length * largura} ${alto}`}
        preserveAspectRatio="none"
        className="w-full cursor-pointer"
        style={{ height: alto }}
      >
        <rect
          x={inicioSelecao * largura}
          y={0}
          width={(indiceAte - inicioSelecao + 1) * largura}
          height={alto}
          className="fill-marca-clara"
        />
        {meses.map((m, i) => {
          const dado = porMes.get(m);
          const a = ((dado?.arvores ?? 0) / maxArvores) * (alto - 2);
          const o = ((dado?.ocorrencias ?? 0) / maxOcorrencias) * (alto - 2);
          return (
            <g key={m} onClick={() => aoEscolher(i)}>
              <rect x={i * largura} y={0} width={largura} height={alto} fill="transparent" />
              {a > 0 && (
                <rect
                  x={i * largura + 1}
                  y={alto - a}
                  width={largura - 2}
                  height={a}
                  fill={CORES_CONDICAO.boa}
                  opacity={0.75}
                />
              )}
              {o > 0 && (
                <rect
                  x={i * largura + 3.5}
                  y={alto - o}
                  width={largura - 7}
                  height={o}
                  fill={CORES_PRIORIDADE.alta}
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-texto-suave">
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block size-2 rounded-[2px]"
            style={{ background: CORES_CONDICAO.boa }}
          />
          Árvores cadastradas por mês
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block size-2 rounded-[2px]"
            style={{ background: CORES_PRIORIDADE.alta }}
          />
          Ocorrências registradas por mês
        </span>
      </p>
    </div>
  );
}
