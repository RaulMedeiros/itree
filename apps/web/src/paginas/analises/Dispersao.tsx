import { Link } from "@tanstack/react-router";
import { marcas } from "./marcas";

export interface PontoDispersao {
  id: string;
  rotulo: string;
  x: number;
  y: number;
  populacao?: number | null;
  arvores?: number | null;
}

export interface DadosDispersao {
  x_rotulo: string;
  y_rotulo: string;
  pontos: PontoDispersao[];
  correlacao: { r: number | null; bairros: number; metodo: string };
}

const L = 640;
const A = 320;
const MARGEM = { e: 56, d: 36, t: 12, b: 40 };

const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Dispersão por bairro: cada ponto é um bairro. A correlação, quando mostrada, é só descrição (r e
 * número de bairros): não afirma causa nem é índice oficial. A tabela da análise traz os mesmos
 * dados para quem não enxerga o gráfico.
 */
export function Dispersao({ dados }: { dados: DadosDispersao }) {
  const { pontos, correlacao } = dados;
  if (pontos.length === 0) return null;
  const maxX = Math.max(...pontos.map((p) => p.x));
  const maxY = Math.max(...pontos.map((p) => p.y), 0.0001);
  const marcasX = marcas(maxX);
  const marcasY = marcas(maxY);
  const topoX = marcasX.at(-1) ?? maxX;
  const topoY = marcasY.at(-1) ?? maxY;
  const x = (v: number) => MARGEM.e + (v / topoX) * (L - MARGEM.e - MARGEM.d);
  const y = (v: number) => A - MARGEM.b - (v / topoY) * (A - MARGEM.b - MARGEM.t);
  const r = correlacao.r;
  return (
    <figure data-testid="dispersao" className="mb-4">
      <svg
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={`Dispersão de ${pontos.length} bairros: ${dados.y_rotulo} contra ${dados.x_rotulo}.`}
        className="h-auto w-full max-w-2xl"
      >
        {marcasY.map((v) => (
          <g key={`y${v}`}>
            <line x1={MARGEM.e} x2={L - MARGEM.d} y1={y(v)} y2={y(v)} className="stroke-borda" />
            <text
              x={MARGEM.e - 6}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-texto-suave text-[11px]"
            >
              {inteiro(v)}
            </text>
          </g>
        ))}
        {marcasX.map((v) => (
          <text
            key={`x${v}`}
            x={x(v)}
            y={A - MARGEM.b + 16}
            textAnchor="middle"
            className="fill-texto-suave text-[11px]"
          >
            {inteiro(v)}
          </text>
        ))}
        <text
          x={(L + MARGEM.e) / 2}
          y={A - 6}
          textAnchor="middle"
          className="fill-texto-suave text-[11px]"
        >
          {dados.x_rotulo}
        </text>
        <text
          transform={`translate(12 ${(A - MARGEM.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-texto-suave text-[11px]"
        >
          Árvores por 1.000 hab.
        </text>
        {pontos.map((p) => (
          <circle
            key={p.id}
            cx={x(p.x)}
            cy={y(p.y)}
            r={4}
            className="fill-marca stroke-superficie"
            fillOpacity={0.75}
            strokeWidth={1}
          >
            <title>{`${p.rotulo}: R$ ${Math.round(p.x).toLocaleString("pt-BR")} · ${inteiro(p.y)} árvores por 1.000 hab.`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 text-xs text-texto-suave">
        {r === null
          ? `${correlacao.bairros} bairros com os dois valores; poucos dados para descrever uma correlação.`
          : `Descrição, não afirmação de causa: r = ${r.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} entre ${correlacao.bairros} bairros (correlação de Pearson). `}
        {correlacao.metodo}{" "}
        <Link to="/bairros" className="text-marca-escura hover:underline">
          Ver os bairros
        </Link>
      </figcaption>
    </figure>
  );
}
