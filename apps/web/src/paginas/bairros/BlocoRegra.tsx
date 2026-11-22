import type { Ficha } from "@itree/api-client";

import { Recolhivel } from "../../ui/recolhivel";
import { Selo } from "../../ui/selo";
import { formatarData } from "../../util/formatos";

type Bloco = Ficha["regra_3_30_300"];
type Parte = Bloco["partes"][number];

const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Medidor de uma parte: trilha de 0 a 100%, traço na meta e ponto no valor do bairro. */
function Medidor({ parte, cidade }: { parte: Parte; cidade: string }) {
  const valor = parte.valor;
  const selo =
    parte.atende === null ? (
      <Selo tom="neutro">Sem dado</Selo>
    ) : parte.atende ? (
      <Selo tom="sucesso">Atende</Selo>
    ) : (
      <Selo tom="atencao">Não atende</Selo>
    );
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border border-borda p-3"
      data-testid={`regra-parte-${parte.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl leading-none font-semibold tabular-nums">{parte.id}</p>
          <p className="mt-1 text-sm font-medium">{parte.nome}</p>
        </div>
        {selo}
      </div>
      <p className="text-xl font-semibold tabular-nums">{valor === null ? "—" : pct(valor)}</p>
      <div
        role="img"
        aria-label={
          valor === null
            ? `${parte.nome}: sem dado. Meta: ${pct(parte.meta_pct)}.`
            : `${parte.nome}: ${pct(valor)}. Meta: ${pct(parte.meta_pct)}. ${cidade}: ${
                parte.cidade === null || parte.cidade === undefined ? "sem dado" : pct(parte.cidade)
              }.`
        }
        className="relative h-1.5 rounded-full bg-neutro-clara"
      >
        {valor !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-marca"
            style={{ width: `${Math.min(100, Math.max(0, valor))}%` }}
          />
        )}
        <span
          aria-hidden
          className="absolute -top-1 h-3.5 w-0.5 rounded bg-texto"
          style={{ left: `${Math.min(100, parte.meta_pct)}%` }}
        />
      </div>
      <p className="text-xs text-texto-suave">
        Meta: {parte.meta} ({pct(parte.meta_pct)} {parte.unidade.replace("% ", "")})
      </p>
      <p className="text-xs text-texto-suave">
        {cidade}:{" "}
        <strong className="tabular-nums">
          {parte.cidade === null || parte.cidade === undefined ? "sem dado" : pct(parte.cidade)}
        </strong>
        {parte.denominador
          ? ` · ${(parte.numerador ?? 0).toLocaleString("pt-BR")} de ${parte.denominador.toLocaleString("pt-BR")}`
          : ""}
      </p>
      {parte.nota && <p className="text-xs text-texto-suave">{parte.nota}</p>}
    </li>
  );
}

/** Bloco "3-30-300" da ficha do bairro: três medidores, a base declarada e "Como é calculado". */
export function BlocoRegra({
  bloco,
  contagem,
  aoMudarContagem,
}: {
  bloco: Bloco;
  contagem: "todas" | "confirmadas";
  aoMudarContagem: (c: "todas" | "confirmadas") => void;
}) {
  return (
    <section
      aria-label="Regra 3-30-300"
      className="evitar-quebra mb-6 rounded-xl border border-borda bg-superficie p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">3-30-300</h2>
        <label className="flex items-center gap-2 text-sm print:hidden">
          Árvores contadas
          <select
            aria-label="Árvores contadas na regra 3-30-300"
            className="rounded-md border border-borda bg-superficie px-2 py-1"
            value={contagem}
            onChange={(e) => aoMudarContagem(e.target.value as "todas" | "confirmadas")}
          >
            <option value="todas">Todas as válidas</option>
            <option value="confirmadas">Só espécie confirmada</option>
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-texto-suave">{bloco.regra}</p>
      <ul className="mt-3 grid gap-3 md:grid-cols-3">
        {bloco.partes.map((p) => (
          <Medidor key={p.id} parte={p} cidade={bloco.rotulo_cidade} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-texto-suave">
        Base do cálculo: {bloco.base_texto}
        {bloco.edificacoes ? ` (${bloco.edificacoes.toLocaleString("pt-BR")} no bairro)` : ""}.
        {bloco.calculado_em ? ` Calculado em ${formatarData(bloco.data)}.` : ""} {bloco.ressalva}
      </p>
      <p className="mt-1 text-xs text-texto-suave">Método: {bloco.fonte_metodo}</p>
      <Recolhivel
        titulo="Como é calculado"
        className="mt-1 text-xs text-texto-suave print:hidden"
        classeCorpo="flex flex-col gap-1"
      >
        {bloco.partes.map((p) => (
          <p key={p.id}>
            <strong>{p.id}:</strong> {p.definicao}
          </p>
        ))}
        <p>{bloco.metodo}</p>
        <a
          href={bloco.fonte_url}
          target="_blank"
          rel="noreferrer"
          className="text-marca-escura hover:underline"
        >
          Abrir a fonte do método
        </a>
      </Recolhivel>
    </section>
  );
}

/** Zonas do macrozoneamento que tocam o bairro (só leitura). */
export function BlocoMacrozoneamento({ bloco }: { bloco: NonNullable<Ficha["macrozoneamento"]> }) {
  return (
    <section
      aria-label="Macrozoneamento"
      className="evitar-quebra mb-6 rounded-xl border border-borda bg-superficie p-4"
    >
      <h2 className="text-lg font-semibold">Macrozoneamento</h2>
      <p className="mt-1 text-sm">
        Zona predominante: <strong>{bloco.predominante}</strong>
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {bloco.zonas.map((z) => (
          <li key={z.nome} className="flex justify-between gap-3">
            <span>
              {z.nome}
              {z.sigla ? ` (${z.sigla})` : ""}
            </span>
            <span className="tabular-nums">{pct(z.pct)} da área</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-texto-suave">
        Fonte: {bloco.fonte} · {bloco.licenca} · dados de {formatarData(bloco.data_referencia)}.
      </p>
    </section>
  );
}
