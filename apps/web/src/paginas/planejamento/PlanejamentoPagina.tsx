import { territoriosGeojson, usePlanejamentoCriterios } from "@itree/api-client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Copy, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Botao } from "../../ui/botao";
import { Carregando, Erro } from "../../ui/estados";
import { SeletorContagem } from "../../componentes/contagem";
import { contagemDaUrl, paramContagem } from "../../componentes/contagemUrl";
import { CabecalhoPagina } from "../../ui/pagina";
import { formatarDataHora } from "../../util/formatos";
import { ControlesPesos } from "./ControlesPesos";
import { MapaPrioridade, type BairroGeometria } from "./MapaPrioridade";
import { PainelBairro } from "./PainelBairro";
import { RankingPrioridade } from "./RankingPrioridade";
import {
  CENARIOS,
  IDS_CRITERIOS,
  baixarCsv,
  buscaDosPesos,
  cenarioAtivo,
  classesDePrioridade,
  criteriosAtivos,
  csvDoCenario,
  faixasDasClasses,
  fonteDoCriterio,
  ordenar,
  pesosDaBusca,
  pontuar,
  type Cenario,
  type CriterioId,
  type Pesos,
} from "./calculo";

interface ColecaoBairros {
  features: { id?: string | number; geometry: unknown }[];
}

/**
 * Planejamento "Onde plantar": cenário de priorização de bairros para plantio. Os critérios vêm da
 * API com percentis; os pesos são da pessoa, ficam na URL e a ponderação roda aqui, na hora.
 * Não é índice oficial (DP-14).
 */
export function PlanejamentoPagina() {
  const busca = useSearch({ from: "/autenticado/planejamento" });
  const navegar = useNavigate();
  const criteriosQ = usePlanejamentoCriterios(paramContagem(busca.contagem));
  const geometriasQ = useQuery({
    queryKey: ["planejamento-geometrias"],
    queryFn: () => territoriosGeojson({ tipo: "bairro", precisao: 4 }),
    staleTime: 10 * 60_000,
  });
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);

  const dados = criteriosQ.data?.data;
  const criterios = useMemo(() => dados?.criterios ?? [], [dados]);
  const bairros = useMemo(() => dados?.bairros ?? [], [dados]);
  const pesos = useMemo(() => pesosDaBusca(busca as Record<string, number | undefined>), [busca]);
  const calorDisponivel = criterios.find((c) => c.id === "ilha_calor")?.disponivel ?? false;

  const linhas = useMemo(() => pontuar(bairros, criterios, pesos), [bairros, criterios, pesos]);
  const ordenadas = useMemo(() => ordenar(linhas), [linhas]);
  const classes = useMemo(() => classesDePrioridade(ordenadas), [ordenadas]);
  const faixas = useMemo(() => faixasDasClasses(ordenadas, classes), [ordenadas, classes]);
  const ativos = criteriosAtivos(criterios, pesos);
  const geometrias: BairroGeometria[] = useMemo(
    () =>
      ((geometriasQ.data?.data as unknown as ColecaoBairros | undefined)?.features ?? []).map(
        (f) => ({ id: String(f.id), geometry: f.geometry }),
      ),
    [geometriasQ.data],
  );

  const mudar = (novos: Pesos | null, extra: { bairro?: string | undefined } | null = null) =>
    void navegar({
      to: "/planejamento",
      // Chaves sem valor saem da URL (o roteador não remove uma chave que vem como `undefined`).
      search: (anterior) =>
        Object.fromEntries(
          Object.entries({
            ...anterior,
            ...(novos ? buscaDosPesos(novos) : {}),
            ...(extra ?? {}),
          }).filter(([, v]) => v !== undefined),
        ),
      replace: true,
    });

  const aplicarCenario = (c: Cenario) => {
    const alvo = c.pesos(calorDisponivel);
    // Sem os dados de calor, o peso fica no padrão (e fora da URL): o critério é ignorado.
    mudar({ ...alvo, ilha_calor: calorDisponivel ? alvo.ilha_calor : pesosDaBusca({}).ilha_calor });
  };
  const selecionar = (id: string | undefined) => mudar(null, { bairro: id });

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiado(true);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 3000);
    } catch {
      window.prompt("Copie o link do cenário:", window.location.href);
    }
  };

  const exportar = () => {
    if (!dados) return;
    baixarCsv(
      csvDoCenario(ordenadas, bairros, criterios, pesos, formatarDataHora(dados.gerado_em) ?? ""),
      "itree-onde-plantar.csv",
    );
  };

  const ativoId = cenarioAtivo(pesos, criterios);
  const selecionadoId = busca.bairro;
  const bairroSelecionado = bairros.find((b) => b.id === selecionadoId);
  const posicaoSelecionado = ordenadas.findIndex((l) => l.id === selecionadoId);

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Onde plantar"
        descricao="Cenário de priorização — não é índice oficial (DP-14)"
        acoes={
          <>
            <SeletorContagem
              valor={contagemDaUrl(busca.contagem)}
              aoMudar={(c) =>
                void navegar({
                  to: "/planejamento",
                  search: (anterior) => ({
                    ...anterior,
                    contagem: c === "todas" ? undefined : c,
                  }),
                  replace: true,
                })
              }
            />
            <Botao variante="secundario" onClick={() => void copiarLink()}>
              {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
              Copiar link do cenário
            </Botao>
            <Botao variante="secundario" onClick={exportar} disabled={!dados}>
              <Download aria-hidden /> Exportar CSV
            </Botao>
          </>
        }
      />
      <p role="status" className="sr-only">
        {copiado ? "Link do cenário copiado." : ""}
      </p>

      {criteriosQ.isPending ? (
        <Carregando linhas={6} rotulo="Carregando os critérios…" />
      ) : criteriosQ.isError || !dados ? (
        <Erro erro={criteriosQ.error} aoTentarNovamente={() => void criteriosQ.refetch()} />
      ) : (
        <>
          <p className="mb-4 max-w-4xl text-sm text-texto-suave">
            Cada critério vira um percentil entre os bairros de Fortaleza, de 0 a 1, na direção em
            que pede plantio (1 é o bairro que mais precisa). A pontuação é a média ponderada dos
            percentis dos critérios com peso maior que zero; bairro sem dado num critério fica sem
            ele na média e é marcado. As classes do mapa dividem o ranking em quintos. É uma
            ferramenta para comparar cenários, não uma indicação oficial de onde plantar.
          </p>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="flex flex-col gap-4">
              <section
                aria-label="Cenário e pesos"
                className="rounded-xl border border-borda bg-superficie p-4"
              >
                <h2 className="font-semibold">Cenário</h2>
                <div
                  className="mt-2 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Cenários prontos"
                >
                  {CENARIOS.map((c) => (
                    <Botao
                      key={c.id}
                      variante={ativoId === c.id ? "primario" : "secundario"}
                      tamanho="pequeno"
                      aria-pressed={ativoId === c.id}
                      title={c.descricao}
                      onClick={() => aplicarCenario(c)}
                    >
                      {c.rotulo}
                    </Botao>
                  ))}
                </div>
                <p className="mt-2 text-xs text-texto-suave">
                  {ativoId
                    ? CENARIOS.find((c) => c.id === ativoId)?.descricao
                    : "Cenário personalizado: ajuste os pesos de 0 a 5 abaixo."}
                </p>
                <h3 className="mt-4 mb-2 text-sm font-semibold">Peso de cada critério (0 a 5)</h3>
                <ControlesPesos
                  criterios={criterios}
                  pesos={pesos}
                  aoMudar={(id: CriterioId, peso) => mudar({ ...pesos, [id]: peso })}
                />
              </section>
              <RankingPrioridade
                ordenadas={ordenadas}
                ativos={ativos}
                criterios={criterios}
                selecionado={selecionadoId}
                aoSelecionar={selecionar}
              />
            </div>

            <div className="flex flex-col gap-4">
              <MapaPrioridade
                geometrias={geometrias}
                linhas={linhas}
                classes={classes}
                faixas={faixas}
                selecionado={selecionadoId}
                aoSelecionar={selecionar}
              />
              {bairroSelecionado ? (
                <PainelBairro
                  bairro={bairroSelecionado}
                  linha={linhas.find((l) => l.id === selecionadoId)}
                  posicao={posicaoSelecionado >= 0 ? posicaoSelecionado + 1 : null}
                  criterios={criterios}
                  pesos={pesos}
                  aoFechar={() => selecionar(undefined)}
                />
              ) : (
                <p className="rounded-xl border border-dashed border-borda px-4 py-6 text-center text-sm text-texto-suave">
                  Clique em um bairro no mapa ou no ranking para ver os valores de cada critério.
                </p>
              )}
            </div>
          </div>

          <section aria-label="Fontes dos critérios" className="mt-6 text-sm">
            <h2 className="mb-1 font-semibold">Fontes dos critérios</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-texto-suave">
              {IDS_CRITERIOS.map((id) => {
                const c = criterios.find((x) => x.id === id);
                if (!c) return null;
                return (
                  <li key={id}>
                    <span className="font-medium text-texto">{c.nome}:</span>{" "}
                    {c.disponivel ? fonteDoCriterio(c) : c.motivo_indisponivel}
                  </li>
                );
              })}
              <li>
                O IDH 2010 não entra como critério, por ser antigo; está na ficha de cada bairro.
              </li>
            </ul>
            <p className="mt-2 text-xs text-texto-suave">
              Dados gerados em {formatarDataHora(dados.gerado_em)}. Os percentis usam todos os
              bairros de Fortaleza com dado; o seu escopo só limita os bairros mostrados.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
