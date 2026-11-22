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
  FONTE_REGRA_3_30_300,
  type GrupoIndicador,
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
import { PainelDetalhe } from "../../mapa/PainelDetalhe";

const GRUPOS: GrupoIndicador[] = ["Censo e IDH", "Imóveis (SEFIN)", "Regra 3-30-300"];

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
          {GRUPOS.map((grupo) => (
            <optgroup key={grupo} label={grupo}>
              {INDICADORES_POPULACAO.filter((i) => i.grupo === grupo).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id === "arvores_por_mil" ? `${i.rotulo} (inventário parcial)` : i.rotulo}
                </option>
              ))}
            </optgroup>
          ))}
        </Selecao>
      )}
      <p className="text-xs text-texto-suave">
        Densidade, rendimento, IDH, IPTU e áreas edificadas (SEFIN) e a regra 3-30-300. Fonte: IBGE
        (Censo 2022), SDE (IDH 2010) e SEFIN.
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
              <p className="text-texto-suave">
                Indicador complementar à regra 3-30-300 (DP-14 decidida); não é índice oficial.
              </p>
            </>
          )}
          {(id === "regra_3" || id === "regra_30" || id === "regra_300") && (
            <>
              <p className="text-texto-suave">Método: {FONTE_REGRA_3_30_300}</p>
              {id !== "regra_30" ? (
                <p className="text-texto-suave">
                  Percentual das edificações do bairro (distância em linha reta).{" "}
                  {ressalvaInventario}
                </p>
              ) : (
                <p className="text-texto-suave">
                  Vegetação (NDVI de 10 m), não só copa de árvore. Sem dado onde o NDVI não cobre.
                </p>
              )}
            </>
          )}
          {(id === "iptu_medio" || id === "iptu_inscricoes") && (
            <p className="text-texto-suave">
              IPTU lançado em 2024: não é renda nem valor de mercado.
            </p>
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
    <PainelDetalhe rotulo="População e renda do bairro" className="gap-2 text-sm">
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
          rotulo="Árvores por 1.000 hab. (inventário parcial)"
          valor={fmt("arvores_por_mil", bairro.arvores_por_mil)}
        />
        <Linha rotulo="Rendimento médio do responsável" valor={fmt("renda", bairro.renda)} />
        <Linha rotulo="IDH 2010" valor={fmt("idh", bairro.idh)} />
        <Linha
          rotulo="IPTU médio por inscrição (2024)"
          valor={fmt("iptu_medio", bairro.iptu_medio)}
        />
        <Linha rotulo="Regra 3-30-300: 3" valor={fmt("regra_3", bairro.r3)} />
        <Linha rotulo="Regra 3-30-300: 30" valor={fmt("regra_30", bairro.r30)} />
        <Linha rotulo="Regra 3-30-300: 300" valor={fmt("regra_300", bairro.r300)} />
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
    </PainelDetalhe>
  );
}
