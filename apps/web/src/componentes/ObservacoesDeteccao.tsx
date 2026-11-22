import { useArvoresObservacoes, type Arvore, type Observacao } from "@itree/api-client";
import { Link } from "@tanstack/react-router";

import { Carregando, Erro } from "../ui/estados";
import { formatarData } from "../util/formatos";
import { SeloConfianca, SeloOrigemDeteccao, SelosDeteccao } from "./selosDeteccao";

const ROTULO_MEDIDA: Record<string, string> = {
  altura: "Altura",
  diametro_copa: "Copa",
  dap: "DAP",
};

function resumoDosValores(o: Observacao): string[] {
  const v = o.valores as {
    especies?: { nome_cientifico: string; probabilidade: number | null }[];
    medidas?: Record<string, { valor: number; unidade: string }>;
    contexto?: string;
    interferencias?: string[];
    sinais?: string[];
  };
  const linhas: string[] = [];
  if (v.especies?.length)
    linhas.push(`Espécie sugerida: ${v.especies.map((e) => e.nome_cientifico).join(", ")}`);
  const medidas = Object.entries(v.medidas ?? {}).map(
    ([k, m]) => `${ROTULO_MEDIDA[k] ?? k} ≈ ${m.valor.toLocaleString("pt-BR")} ${m.unidade}`,
  );
  if (medidas.length) linhas.push(`Medidas estimadas: ${medidas.join(", ")}`);
  if (v.interferencias?.length) linhas.push(`Interferências: ${v.interferencias.join(", ")}`);
  if (v.sinais?.length) linhas.push(`Sinais aparentes: ${v.sinais.join(", ")}`);
  return linhas;
}

/**
 * Selos e proveniência da detecção automática na ficha: origem, estado de revisão, última vez
 * vista e as passagens (observações) que a árvore já teve.
 */
export function SecaoDeteccao({ arvore }: { arvore: Arvore }) {
  const consulta = useArvoresObservacoes(arvore.id, { query: { enabled: !!arvore.deteccao } });
  if (!arvore.deteccao) return null;
  return (
    <section
      aria-label="Detecção automática"
      className="rounded-lg border border-borda bg-superficie p-4"
    >
      <h2 className="mb-3 font-semibold">Detecção automática</h2>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <SelosDeteccao arvore={arvore} tamanho="md" />
      </div>
      <p className="mb-3 text-sm text-texto-suave">
        {arvore.confirmada
          ? `Confirmada${arvore.confirmada_em ? ` em ${formatarData(arvore.confirmada_em)}` : ""} por inspeção ou revisão humana.`
          : "Entrou no inventário por detecção automática e ainda não foi confirmada por inspeção de campo nem revisão humana."}
        {arvore.ultima_vez_vista_em &&
          ` Vista pela última vez em ${formatarData(arvore.ultima_vez_vista_em)}.`}
      </p>
      {consulta.isPending ? (
        <Carregando linhas={2} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <ul className="flex flex-col gap-2">
          {consulta.data.data.map((o) => (
            <li key={o.id} className="rounded-md border border-borda p-2.5 text-sm">
              <p className="flex flex-wrap items-center gap-1.5">
                <SeloOrigemDeteccao sensor={o.sensor} />
                <SeloConfianca faixa={o.faixa_confianca} />
                <span className="text-texto-suave">
                  {formatarData(o.capturada_em)} · ±{o.incerteza_m.toLocaleString("pt-BR")} m ·{" "}
                  {o.resultado === "criou" ? "criou a árvore" : "juntou-se à árvore"}
                </span>
              </p>
              <ul className="mt-1 text-xs text-texto-suave">
                {resumoDosValores(o).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-texto-suave">
                Lote{" "}
                <Link
                  to="/inventario/deteccoes/$id"
                  params={{ id: o.lote_id }}
                  className="text-marca-escura hover:underline"
                >
                  {o.lote_projeto}
                </Link>{" "}
                · modelo {o.lote_versao_modelo}
              </p>
            </li>
          ))}
          {consulta.data.data.length === 0 && (
            <li className="text-sm text-texto-suave">Sem observações registradas.</li>
          )}
        </ul>
      )}
      <p className="mt-3 text-xs text-texto-suave">
        As faixas de confiança (baixa, média, alta) vêm dos limiares do servidor e ainda não foram
        calibradas: não medem a saúde da árvore.
      </p>
    </section>
  );
}
