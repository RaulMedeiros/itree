import {
  ErroApi,
  baixarArquivo,
  useMapaSelecao,
  type CamadaSelecaoEnum,
  type CondicaoAparenteEnum,
} from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import { Link } from "@tanstack/react-router";
import {
  ClipboardPlus,
  Download,
  Pentagon,
  RectangleHorizontal,
  ScanEye,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import type { FormaArea, PoligonoGeoJson } from "../../mapa/desenho";
import { CORES_CONDICAO } from "../../mapa/simbologia";
import { Botao } from "../../ui/botao";
import { Carregando } from "../../ui/estados";
import { CriarTarefasDialogo } from "../tarefas/CriarTarefasDialogo";

const TAMANHO_PAGINA = 50;

const ORIENTACAO: Record<FormaArea, string> = {
  retangulo: "Arraste no mapa para desenhar um retângulo.",
  poligono:
    "Clique para marcar os vértices; duplo clique ou Enter fecha o polígono; Backspace desfaz o último vértice.",
};

/**
 * Ferramentas de seleção por área (RF-MAPA-022): liga o modo, escolhe a forma
 * e, para quem não usa o mouse, seleciona a área visível no mapa. O modo é
 * anunciado em uma região de status e Esc sai dele.
 */
export function BarraSelecaoArea({
  forma,
  ativoPainel,
  botao,
  aoAlternar,
  aoEscolherForma,
  aoUsarAreaVisivel,
}: {
  forma: FormaArea | null;
  /** Há uma área concluída (painel aberto). */
  ativoPainel: boolean;
  botao: Ref<HTMLButtonElement>;
  aoAlternar: () => void;
  aoEscolherForma: (forma: FormaArea) => void;
  aoUsarAreaVisivel: () => void;
}) {
  const ativo = forma !== null;
  return (
    <>
      <div
        role="toolbar"
        aria-label="Ferramentas do mapa"
        className="pointer-events-auto flex items-center gap-1 rounded-xl border border-borda bg-superficie/95 p-1 shadow-lg backdrop-blur"
      >
        <Botao
          ref={botao}
          tamanho="pequeno"
          variante={ativo || ativoPainel ? "primario" : "fantasma"}
          aria-pressed={ativo}
          onClick={aoAlternar}
        >
          <SquareDashedMousePointer aria-hidden /> Selecionar área
        </Botao>
        {ativo && (
          <>
            <Botao
              tamanho="pequeno"
              variante={forma === "retangulo" ? "secundario" : "fantasma"}
              aria-pressed={forma === "retangulo"}
              onClick={() => aoEscolherForma("retangulo")}
            >
              <RectangleHorizontal aria-hidden /> Retângulo
            </Botao>
            <Botao
              tamanho="pequeno"
              variante={forma === "poligono" ? "secundario" : "fantasma"}
              aria-pressed={forma === "poligono"}
              onClick={() => aoEscolherForma("poligono")}
            >
              <Pentagon aria-hidden /> Polígono
            </Botao>
            <Botao tamanho="pequeno" variante="fantasma" onClick={aoUsarAreaVisivel}>
              <ScanEye aria-hidden /> Usar área visível
            </Botao>
          </>
        )}
      </div>
      <div role="status" aria-live="polite">
        {forma && (
          <p className="pointer-events-auto rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm shadow">
            <strong>Selecionar área:</strong> {ORIENTACAO[forma]} Esc sai do modo.
          </p>
        )}
      </div>
    </>
  );
}

function Rotulo({ children }: { children: string }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-texto-suave uppercase">{children}</h3>
  );
}

/** Altura fixa de cada linha, para a caixa de rolagem mostrar linhas inteiras (nunca cortadas). */
const ALTURA_LINHA_PX = 52;
const LINHAS_VISIVEIS = 5;
// Linhas + 1 px de divisória entre elas + 2 px de borda da caixa.
const ALTURA_CAIXA_PX = ALTURA_LINHA_PX * LINHAS_VISIVEIS + (LINHAS_VISIVEIS - 1) + 2;

/**
 * Lista rolável e paginada ("mostrar mais"), com link para o detalhe de cada item. Diz quantos
 * itens estão carregados na caixa em relação ao total da área, porque só as primeiras linhas
 * aparecem sem rolar.
 */
function Lista<T extends { id: string }>({
  rotulo,
  itens,
  total,
  linha,
}: {
  rotulo: string;
  itens: T[];
  /** Total da área na camada; passa de `itens.length` quando o servidor cortou a lista. */
  total: number;
  linha: (item: T) => React.ReactNode;
}) {
  const [mostrando, setMostrando] = useState(TAMANHO_PAGINA);
  const exibidos = Math.min(mostrando, itens.length);
  const restantes = itens.length - exibidos;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-texto-suave">
        Exibindo {exibidos.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}
        {exibidos > LINHAS_VISIVEIS && " (role a lista para ver as demais)"}
      </p>
      <ul
        aria-label={rotulo}
        style={{ maxHeight: ALTURA_CAIXA_PX }}
        className="divide-y divide-borda overflow-y-auto rounded-md border border-borda"
      >
        {itens.slice(0, mostrando).map((item) => (
          <li key={item.id} style={{ height: ALTURA_LINHA_PX }}>
            {linha(item)}
          </li>
        ))}
      </ul>
      {restantes > 0 && (
        <Botao
          tamanho="pequeno"
          variante="secundario"
          onClick={() => setMostrando((n) => n + TAMANHO_PAGINA)}
        >
          Mostrar mais ({restantes} {restantes === 1 ? "restante" : "restantes"})
        </Botao>
      )}
    </div>
  );
}

const classeLinha =
  "flex h-full flex-col justify-center px-2.5 text-sm hover:bg-neutro-clara focus-visible:outline-offset-[-2px]";

/**
 * Painel com o que há dentro da área desenhada: resumo, listas e as ações
 * "Criar tarefas" e "Exportar", que só aparecem para quem tem permissão.
 */
export function PainelSelecaoArea({
  area,
  filtros,
  camadas,
  aoFechar,
}: {
  area: PoligonoGeoJson;
  filtros: Record<string, string>;
  camadas: CamadaSelecaoEnum[];
  aoFechar: () => void;
}) {
  const consulta = useMapaSelecao<ErroApi>();
  const { mutate } = consulta;
  const titulo = useRef<HTMLHeadingElement>(null);
  const podeCriarTarefas = usePermissao("tarefas.editar");
  const podeExportarArvores = usePermissao("relatorios.exportar", "inventario.ler");
  const podeExportarOcorrencias = usePermissao("relatorios.exportar", "ocorrencias.ler");
  const [criando, setCriando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // Consulta de novo quando a área ou os filtros do mapa mudam.
  const chave = JSON.stringify({ area, filtros, camadas });
  useEffect(() => {
    if (camadas.length) mutate({ data: { geometria: area, filtros, camadas } });
    // `chave` resume area, filtros e camadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, mutate]);

  // Teclado: o foco vai para o painel ao abrir.
  useEffect(() => titulo.current?.focus(), []);

  const aoTeclar = (e: KeyboardEvent) => {
    // Com o diálogo aberto, o Esc é dele (o evento sobe pelo portal).
    if (e.key === "Escape" && !criando) {
      e.stopPropagation();
      aoFechar();
    }
  };

  const baixar = async (conjunto: CamadaSelecaoEnum, formato: "csv" | "geojson") => {
    setBaixando(`${conjunto}-${formato}`);
    setErroArquivo(null);
    try {
      await baixarArquivo(
        "/api/v1/mapa/selecao/exportar",
        {},
        {
          corpo: { geometria: area, filtros, conjunto, formato },
        },
      );
    } catch (e) {
      setErroArquivo(e instanceof ErroApi ? e.message : "Falha ao gerar o arquivo.");
    } finally {
      setBaixando(null);
    }
  };

  const dados = consulta.data?.data;
  const arvores = dados?.arvores;
  const ocorrencias = dados?.ocorrencias;
  const excedeLote = !!dados && !!arvores && arvores.total > dados.limite_tarefas_em_lote;

  return (
    <aside
      aria-label="Seleção por área"
      onKeyDown={aoTeclar}
      className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] w-96 flex-col gap-3 overflow-y-auto rounded-xl border border-borda bg-superficie p-4 text-sm shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 ref={titulo} tabIndex={-1} className="text-base font-semibold outline-none">
          Seleção por área
        </h2>
        <button
          className="rounded-full p-1 hover:bg-fundo"
          aria-label="Fechar seleção por área"
          onClick={aoFechar}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {camadas.length === 0 && (
        <p role="note" className="text-texto-suave">
          Ative a camada de árvores ou de ocorrências para ver o que há na área.
        </p>
      )}
      {consulta.isError && (
        <p role="alert" className="text-perigo">
          {consulta.error.errosDeCampo.geometria?.[0] ??
            consulta.error.errosDeCampo.camadas?.[0] ??
            consulta.error.message}
        </p>
      )}
      {camadas.length > 0 && !dados && !consulta.isError && (
        <Carregando linhas={3} rotulo="Buscando itens na área…" />
      )}

      {dados && (
        <>
          <div role="status" className="flex flex-col gap-1">
            <p>
              {arvores && (
                <>
                  <strong>{arvores.total.toLocaleString("pt-BR")}</strong>{" "}
                  {arvores.total === 1 ? "árvore" : "árvores"}
                </>
              )}
              {arvores && ocorrencias && " e "}
              {ocorrencias && (
                <>
                  <strong>{ocorrencias.total.toLocaleString("pt-BR")}</strong>{" "}
                  {ocorrencias.total === 1 ? "ocorrência" : "ocorrências"}
                </>
              )}{" "}
              na área de {dados.area_km2.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km².
            </p>
            <p className="text-xs text-texto-suave">
              Respeita o seu escopo territorial e os filtros ativos do mapa.
            </p>
          </div>

          {(arvores?.truncado || ocorrencias?.truncado) && (
            <p role="note" className="rounded-md bg-atencao/10 px-2.5 py-1.5 text-atencao">
              A lista mostra os primeiros {dados.limite_itens.toLocaleString("pt-BR")} itens de cada
              camada. O resumo e as exportações cobrem a seleção inteira; para listar tudo, desenhe
              uma área menor.
            </p>
          )}

          {arvores && (
            <section className="flex flex-col gap-2" aria-label="Árvores na área">
              <Rotulo>Árvores por condição aparente</Rotulo>
              {arvores.total === 0 ? (
                <p className="text-texto-suave">Nenhuma árvore na área.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1">
                    {Object.entries(arvores.por_condicao).map(([c, n]) => (
                      <li key={c} className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block size-3 rounded-full border border-black/20"
                          style={{
                            background: CORES_CONDICAO[c as CondicaoAparenteEnum] ?? "#a3ada7",
                          }}
                        />
                        {ROTULOS_CONDICAO[c as CondicaoAparenteEnum] ?? c}: <strong>{n}</strong>
                      </li>
                    ))}
                  </ul>
                  <Lista
                    rotulo="Árvores na área"
                    itens={arvores.itens}
                    total={arvores.total}
                    linha={(a) => (
                      <Link
                        to="/inventario/arvores/$id"
                        params={{ id: a.id }}
                        className={classeLinha}
                      >
                        <span>
                          <span className="font-mono font-medium">{a.codigo}</span>
                          {" · "}
                          {ROTULOS_CONDICAO[a.condicao as CondicaoAparenteEnum] ?? a.condicao}
                        </span>
                        <span className="truncate text-xs text-texto-suave">
                          {[a.especie || "Espécie não identificada", a.endereco]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    )}
                  />
                </>
              )}
            </section>
          )}

          {ocorrencias && (
            <section className="flex flex-col gap-2" aria-label="Ocorrências na área">
              <Rotulo>Ocorrências</Rotulo>
              {ocorrencias.total === 0 ? (
                <p className="text-texto-suave">Nenhuma ocorrência na área.</p>
              ) : (
                <Lista
                  rotulo="Ocorrências na área"
                  itens={ocorrencias.itens}
                  total={ocorrencias.total}
                  linha={(o) => (
                    <Link to="/ocorrencias/$id" params={{ id: o.id }} className={classeLinha}>
                      <span>
                        <span className="font-mono font-medium">{o.codigo}</span>
                        {" · "}
                        {o.tipo}
                      </span>
                      <span className="text-xs text-texto-suave">
                        {o.estado.replaceAll("_", " ")}
                        {o.prioridade ? ` · prioridade ${o.prioridade}` : ""}
                        {o.risco_confirmado ? " · risco confirmado" : ""}
                      </span>
                    </Link>
                  )}
                />
              )}
            </section>
          )}

          {((podeCriarTarefas && arvores && arvores.total > 0) ||
            (podeExportarArvores && arvores && arvores.total > 0) ||
            (podeExportarOcorrencias && ocorrencias && ocorrencias.total > 0)) && (
            <section className="flex flex-col gap-2 border-t border-borda pt-3" aria-label="Ações">
              {podeCriarTarefas && arvores && arvores.total > 0 && (
                <div className="flex flex-col gap-1">
                  <Botao disabled={excedeLote} onClick={() => setCriando(true)}>
                    <ClipboardPlus aria-hidden /> Criar tarefas ({arvores.total}{" "}
                    {arvores.total === 1 ? "árvore" : "árvores"})
                  </Botao>
                  {excedeLote && (
                    <p className="text-xs text-texto-suave">
                      O limite é de {dados.limite_tarefas_em_lote.toLocaleString("pt-BR")} árvores
                      por lote. Desenhe uma área menor ou filtre o mapa.
                    </p>
                  )}
                </div>
              )}
              {(
                [
                  ["arvores", "Árvores", podeExportarArvores && arvores && arvores.total > 0],
                  [
                    "ocorrencias",
                    "Ocorrências",
                    podeExportarOcorrencias && ocorrencias && ocorrencias.total > 0,
                  ],
                ] as const
              )
                .filter(([, , permitido]) => permitido)
                .map(([conjunto, nome]) => (
                  <div key={conjunto} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-texto-suave">
                      Exportar {nome.toLowerCase()}
                    </span>
                    {(["csv", "geojson"] as const).map((formato) => (
                      <Botao
                        key={formato}
                        tamanho="pequeno"
                        variante="secundario"
                        disabled={baixando !== null}
                        aria-label={`Exportar ${nome.toLowerCase()} da seleção em ${formato === "csv" ? "CSV" : "GeoJSON"}`}
                        onClick={() => void baixar(conjunto, formato)}
                      >
                        <Download aria-hidden /> {formato === "csv" ? "CSV" : "GeoJSON"}
                      </Botao>
                    ))}
                  </div>
                ))}
              {baixando && (
                <p role="status" className="text-xs text-texto-suave">
                  Gerando arquivo…
                </p>
              )}
              {erroArquivo && (
                <p role="alert" className="text-perigo">
                  {erroArquivo}
                </p>
              )}
            </section>
          )}
        </>
      )}

      {criando && arvores && (
        <CriarTarefasDialogo
          alvo={{ tipo: "selecao", arvoreIds: arvores.itens.map((a) => a.id) }}
          aoFechar={() => setCriando(false)}
        />
      )}
    </aside>
  );
}
