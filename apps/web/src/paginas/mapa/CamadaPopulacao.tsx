import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";

import {
  INDICADORES_POPULACAO,
  coresDasClasses,
  formatarIndicadorPopulacao,
  ressalvaInventario,
  rotulosDasClasses,
  COR_SEM_DADO,
  CORES_POPULACAO,
  type IndicadorPopulacao,
} from "../../mapa/coropletica";
import {
  textoEstimativa,
  type BairroPopulacao,
  type DadosPopulacao,
  type IndicadorDaCamada,
} from "../../mapa/populacao";
import { Selo } from "../../ui/selo";
import { Selecao } from "../../ui/campos";
import { formatarData, formatarDataHora } from "../../util/formatos";

/** Controle do grupo Contexto: caixa da camada e seletor do indicador. Desligada por padrão. */
export function ControlePopulacao({
  escolhido,
  aoMudar,
  carregando,
  erro,
  amostra,
}: {
  escolhido: IndicadorPopulacao | undefined;
  aoMudar: (indicador: IndicadorPopulacao | undefined) => void;
  carregando: boolean;
  erro: boolean;
  amostra: React.ReactNode;
}) {
  const ativa = escolhido !== undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-marca"
          checked={ativa}
          onChange={(e) => aoMudar(e.target.checked ? "densidade" : undefined)}
        />
        <span className="flex w-4 justify-center" aria-hidden>
          {amostra}
        </span>
        População e renda por bairro
      </label>
      {ativa && (
        <Selecao
          aria-label="Indicador por bairro"
          value={escolhido}
          onChange={(e) => aoMudar(e.target.value as IndicadorPopulacao)}
        >
          {INDICADORES_POPULACAO.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id === "arvores_por_mil" ? `${i.rotulo} (provisório)` : i.rotulo}
            </option>
          ))}
        </Selecao>
      )}
      <p className="text-xs text-texto-suave">
        Densidade, árvores por 1.000 habitantes, rendimento do responsável e IDH. Fonte: IBGE (Censo
        2022) e SDE (IDH 2010).
      </p>
      {ativa && carregando && (
        <p role="status" className="text-xs text-texto-suave">
          Carregando população e renda…
        </p>
      )}
      {ativa && erro && (
        <p role="alert" className="text-xs text-perigo">
          Não foi possível carregar população e renda.
        </p>
      )}
    </div>
  );
}

export function AmostraPopulacao() {
  return (
    <span aria-hidden className="inline-flex h-3 w-4 overflow-hidden rounded-[2px]">
      {CORES_POPULACAO.map((c) => (
        <span key={c} className="h-full flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

/** Legenda com as classes por quantis, a fonte e, no indicador de árvores, o selo provisório. */
export function LegendaPopulacao({
  indicador,
  carregado,
}: {
  indicador: IndicadorDaCamada | null;
  carregado: boolean;
}) {
  const [aberta, setAberta] = useState(true);
  const quebras = indicador?.quebras ?? [];
  const id = indicador?.id ?? "densidade";
  const rotulos = rotulosDasClasses(quebras, (v) =>
    id === "arvores_por_mil"
      ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
      : formatarIndicadorPopulacao(id, v),
  );
  const cores = coresDasClasses(quebras.length + 1);
  const rotulo = INDICADORES_POPULACAO.find((i) => i.id === id);
  return (
    <section
      aria-label="Legenda da população e renda"
      className="pointer-events-auto shrink-0 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
    >
      <button
        className="flex w-full items-center justify-between gap-4 font-semibold"
        aria-expanded={aberta}
        onClick={() => setAberta((a) => !a)}
      >
        {rotulo?.rotulo}
        {indicador?.provisorio && <Selo tom="atencao">Provisório</Selo>}
      </button>
      {aberta && (
        <div className="mt-2 flex max-w-64 flex-col gap-1.5">
          {!carregado && <p className="text-texto-suave">Carregando…</p>}
          {carregado && rotulos.length === 0 && (
            <p className="text-texto-suave">Poucos bairros com dado para formar classes.</p>
          )}
          <ul aria-label="Classes" className="flex flex-col gap-1">
            {rotulos.map((r, i) => (
              <li key={r} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-5 shrink-0 rounded-[2px] border border-black/20"
                  style={{ background: cores[i] }}
                />
                {r}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                data-testid="amostra-sem-dado-populacao"
                className="inline-block h-3 w-5 shrink-0 rounded-[2px] border border-black/20"
                style={{
                  background: `repeating-linear-gradient(135deg, ${COR_SEM_DADO} 0 2px, #ffffff 2px 5px)`,
                }}
              />
              Sem dado
            </li>
          </ul>
          <p className="text-texto-suave">
            Classes pela distribuição real dos bairros de Fortaleza (quintis): cada classe tem cerca
            de um quinto dos bairros.
          </p>
          {indicador?.proveniencia && (
            <p className="text-texto-suave">
              Fonte: {indicador.proveniencia.fonte}
              {indicador.proveniencia.data_referencia
                ? ` · dados de ${indicador.proveniencia.data_referencia.slice(0, 4)}`
                : ""}
              .
            </p>
          )}
          {id === "idh" && (
            <p className="text-texto-suave">
              Dado de 2010 (base no Censo 2010); não é atual e os limites de bairro da época
              diferem.
            </p>
          )}
          {id === "arvores_por_mil" && (
            <>
              <p className="text-texto-suave">{ressalvaInventario}</p>
              <p className="text-texto-suave">Provisório (DP-14); não é índice oficial.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-texto-suave">{rotulo}</dt>
      <dd className="text-right font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

/** Bairro clicado na camada: os quatro indicadores, a estimativa com o método e a proveniência. */
export function PainelPopulacaoBairro({
  bairro,
  escolhido,
  dados,
  aoFechar,
}: {
  bairro: BairroPopulacao;
  escolhido: IndicadorPopulacao;
  dados: DadosPopulacao | null;
  aoFechar: () => void;
}) {
  const indicador = dados?.indicadores.find((i) => i.id === escolhido) ?? null;
  const prov = indicador?.proveniencia ?? null;
  const fmt = (id: IndicadorPopulacao, v: number | null | undefined) =>
    v === null || v === undefined ? "sem dado" : formatarIndicadorPopulacao(id, Number(v));
  return (
    <aside
      aria-label="População e renda do bairro"
      className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] w-96 flex-col gap-2 overflow-y-auto rounded-xl border border-borda bg-superficie p-4 text-sm shadow-lg"
    >
      <button
        className="absolute top-3 right-3 rounded-full p-1 hover:bg-fundo"
        aria-label="Fechar detalhes"
        onClick={aoFechar}
      >
        <X className="size-4" />
      </button>
      <div className="pr-8">
        <p className="text-lg font-semibold">
          {bairro.id ? (
            <Link
              to="/bairros/$id"
              params={{ id: bairro.id }}
              className="text-marca-escura hover:underline"
            >
              {bairro.nome}
            </Link>
          ) : (
            bairro.nome
          )}
        </p>
        <p className="text-xs text-texto-suave">População e renda por bairro</p>
      </div>
      <dl className="flex flex-col gap-1">
        <Linha
          rotulo="População (Censo 2022)"
          valor={
            bairro.populacao
              ? `${Number(bairro.populacao).toLocaleString("pt-BR")} pessoas`
              : "sem dado"
          }
        />
        <Linha rotulo="Densidade" valor={fmt("densidade", bairro.densidade)} />
        <Linha
          rotulo="Árvores por 1.000 hab. (provisório)"
          valor={fmt("arvores_por_mil", bairro.arvores_por_mil)}
        />
        <Linha rotulo="Rendimento médio do responsável" valor={fmt("renda", bairro.renda)} />
        <Linha rotulo="IDH 2010" valor={fmt("idh", bairro.idh)} />
      </dl>
      {bairro.estimada ? (
        <p className="text-xs text-texto-suave">{textoEstimativa(bairro.estimada, dados)}</p>
      ) : null}
      {escolhido === "arvores_por_mil" && (
        <p className="text-xs text-atencao">{ressalvaInventario}</p>
      )}
      {escolhido === "idh" && (
        <p className="text-xs text-texto-suave">
          IDH de 2010 (SDE, base no Censo 2010): não é atual, e os limites de bairro da época
          diferem dos atuais.
        </p>
      )}
      {prov && (
        <div className="flex flex-col gap-1 border-t border-borda pt-2 text-xs text-texto-suave">
          <p>
            <span className="font-medium">Definição:</span> {prov.definicao}
          </p>
          {prov.metodo && (
            <p>
              <span className="font-medium">Método:</span> {prov.metodo}
            </p>
          )}
          <p>
            <span className="font-medium">Fonte:</span> {prov.fonte}
            {prov.versao ? ` (versão ${prov.versao})` : ""}
          </p>
          <p>
            <span className="font-medium">Licença:</span> {prov.licenca || "não informada"}
          </p>
          <p>
            <span className="font-medium">Data de referência:</span>{" "}
            {prov.data_referencia ? formatarData(prov.data_referencia) : "não informada"}
            {prov.ingerido_em ? ` · ingerido em ${formatarDataHora(prov.ingerido_em)}` : ""}
          </p>
        </div>
      )}
    </aside>
  );
}
