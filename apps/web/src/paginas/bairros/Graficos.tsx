import type { FichaGrafico, FichaSerieMensal } from "@itree/api-client";

import { CORES_CONDICAO } from "../../mapa/simbologia";
import { Selo } from "../../ui/selo";
import { GraficoMensal } from "../visao-geral/graficos";
import { mesEmAndamento } from "../visao-geral/mes";

const inteiro = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

interface ItemBarra {
  rotulo: string;
  valor: number;
  cor: string;
}

/** Barras horizontais em HTML: o rótulo e o número ficam em texto, a cor só reforça. */
function Barras({ itens, rotulo }: { itens: ItemBarra[]; rotulo: string }) {
  const total = itens.reduce((soma, i) => soma + i.valor, 0);
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul aria-label={rotulo} className="flex flex-col gap-2">
      {itens.map((i) => (
        <li
          key={i.rotulo}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-sm"
        >
          <span className="truncate" title={i.rotulo}>
            {i.rotulo}
          </span>
          <span className="h-2.5 rounded bg-neutro-clara" aria-hidden>
            <span
              className="block h-2.5 rounded"
              style={{ width: `${(i.valor / maximo) * 100}%`, background: i.cor }}
            />
          </span>
          <span className="text-right tabular-nums">
            {inteiro.format(i.valor)}
            <span className="ml-1 text-xs text-texto-suave">
              {total ? `${pct.format((100 * i.valor) / total)}%` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Quadro({
  titulo,
  definicao,
  fonte,
  children,
}: {
  titulo: string;
  definicao: string;
  fonte: string;
  children: React.ReactNode;
}) {
  return (
    <section className="evitar-quebra rounded-xl border border-borda bg-superficie p-4">
      <h2 className="font-semibold">{titulo}</h2>
      <div className="mt-3">{children}</div>
      <p className="mt-3 text-xs text-texto-suave">{definicao}</p>
      <p className="mt-1 text-xs text-texto-suave">Fonte: {fonte}</p>
    </section>
  );
}

/** Composição por espécie: as 8 confirmadas mais frequentes, "Outras" e as não confirmadas. */
export function GraficoEspecies({ grafico, validas }: { grafico: FichaGrafico; validas: number }) {
  const confirmadas = grafico.total_confirmadas ?? 0;
  const itens: ItemBarra[] = grafico.itens.map((i) => ({
    rotulo: i.rotulo,
    valor: i.valor,
    cor: i.id === "outras" ? "#7c8a83" : "#1f6b45",
  }));
  const naoConfirmadas = Math.max(0, validas - confirmadas);
  return (
    <Quadro titulo={grafico.titulo} definicao={grafico.definicao} fonte={grafico.fonte}>
      {itens.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Nenhuma árvore com espécie confirmada neste bairro.
        </p>
      ) : (
        <Barras itens={itens} rotulo="Árvores por espécie confirmada" />
      )}
      {naoConfirmadas > 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-texto-suave">
          <Selo>Sem espécie confirmada</Selo>
          {inteiro.format(naoConfirmadas)} de {inteiro.format(validas)} árvores válidas
        </p>
      )}
    </Quadro>
  );
}

/** Distribuição da condição aparente, com as mesmas cores do mapa. */
export function GraficoCondicao({ grafico }: { grafico: FichaGrafico }) {
  const itens: ItemBarra[] = grafico.itens.map((i) => ({
    rotulo: i.rotulo,
    valor: i.valor,
    cor: CORES_CONDICAO[(i.id === "sem" ? "nao_avaliada" : i.id) as keyof typeof CORES_CONDICAO],
  }));
  return (
    <Quadro titulo={grafico.titulo} definicao={grafico.definicao} fonte={grafico.fonte}>
      {itens.length === 0 ? (
        <p className="text-sm text-texto-suave">Nenhuma árvore válida neste bairro.</p>
      ) : (
        <Barras itens={itens} rotulo="Árvores por condição aparente" />
      )}
    </Quadro>
  );
}

/** Ocorrências registradas por mês, nos 12 últimos meses (o gráfico mensal da visão geral). */
export function GraficoOcorrenciasMensal({
  serie,
  geradoEm,
}: {
  serie: FichaSerieMensal;
  geradoEm: string;
}) {
  const total = serie.valores.reduce((soma, v) => soma + v, 0);
  return (
    <Quadro titulo={serie.titulo} definicao={serie.definicao} fonte={serie.fonte}>
      {total === 0 ? (
        <p className="text-sm text-texto-suave">
          Nenhuma ocorrência registrada neste bairro nos últimos 12 meses.
        </p>
      ) : (
        <GraficoMensal
          meses={serie.meses}
          series={[
            { id: "ocorrencias", rotulo: "Ocorrências registradas", valores: serie.valores },
          ]}
          parcial={mesEmAndamento(serie.meses, geradoEm)}
        />
      )}
    </Quadro>
  );
}
