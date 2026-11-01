import {
  mapaAlertas,
  territoriosGeojson,
  useArvoresObter,
  useMapaCamadas,
  useOcorrenciasObter,
  EstadoOcorrenciaEnum,
  type EstadoEspecieEnum,
  type OrigemLocalizacaoEnum,
} from "@itree/api-client";
import {
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ORIGEM_LOCALIZACAO,
  ROTULOS_TIPO_TERRITORIO,
} from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  GeoJSONSource,
  Map as MapaMapLibre,
  MapLayerMouseEvent,
  VectorTileSource,
} from "maplibre-gl";
import { Layers, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import {
  SeloEspecie,
  SeloEstadoOcorrencia,
  SeloLocalizacao,
  SeloPrioridade,
  nomeEspecie,
} from "../../componentes/selos";
import { config } from "../../config";
import { Mapa } from "../../mapa/Mapa";
import { urlApi } from "../../mapa/url";
import { COR_ARVORE, CORES_PRIORIDADE, corPorPrioridade, type TipoBase } from "../../mapa/estilo";
import { Botao } from "../../ui/botao";
import { Selecao } from "../../ui/campos";
import { useTituloDocumento } from "../../util/titulo";
import { Carregando } from "../../ui/estados";
import { formatarData, formatarDataHora } from "../../util/formatos";

export interface BuscaMapa {
  lon?: number;
  lat?: number;
  zoom?: number;
  base?: TipoBase;
  camada?: "arvores" | "ocorrencias";
  arvores?: "0";
  ocorrencias?: "0";
  bairros?: "0";
  tarefas?: "1";
  alertas?: "1";
  sem_inspecao_dias?: number;
  especie_estado?: EstadoEspecieEnum;
  localizacao_origem?: OrigemLocalizacaoEnum;
  estado?: "abertas" | "todas";
  selecao?: string;
}

function urlTiles(
  camada: "arvores" | "ocorrencias" | "tarefas",
  filtros: Record<string, string | undefined>,
) {
  const qs = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v) as [string, string][],
  ).toString();
  return urlApi(`/api/v1/mapa/tiles/${camada}/{z}/{x}/{y}${qs ? `?${qs}` : ""}`);
}

export function MapaPagina() {
  const busca = useSearch({ from: "/autenticado/mapa" });
  const navegar = useNavigate({ from: "/mapa" });
  const podeOcorrencias = usePermissao("ocorrencias.ler");
  const podeTarefas = usePermissao("tarefas.ler");
  const podeAlertas = usePermissao("alertas.ler");
  const camadas = useMapaCamadas();
  const mapa = useRef<MapaMapLibre | null>(null);
  const [pronto, setPronto] = useState(false);
  useTituloDocumento("Mapa");
  const [painel, setPainel] = useState(true);
  // Ao ocultar/mostrar o painel, o botão que o usuário acionou desaparece:
  // o foco vai para o botão equivalente, em vez de cair no início da página.
  const botaoMostrar = useRef<HTMLButtonElement>(null);
  const botaoOcultar = useRef<HTMLButtonElement>(null);
  const alternouPainel = useRef(false);
  useEffect(() => {
    if (!alternouPainel.current) return;
    alternouPainel.current = false;
    (painel ? botaoOcultar : botaoMostrar).current?.focus();
  }, [painel]);
  const alternarPainel = (aberto: boolean) => {
    alternouPainel.current = true;
    setPainel(aberto);
  };
  const [dica, setDica] = useState<{ x: number; y: number; texto: string } | null>(null);

  const base: TipoBase = busca.base ?? "ruas";
  const mostrarArvores = busca.arvores !== "0";
  const mostrarOcorrencias = podeOcorrencias && busca.ocorrencias !== "0";
  const mostrarBairros = busca.bairros !== "0";
  const mostrarTarefas = podeTarefas && busca.tarefas === "1";
  const mostrarAlertas = podeAlertas && busca.alertas === "1";
  const filtrosArvores = {
    especie_estado: busca.especie_estado,
    localizacao_origem: busca.localizacao_origem,
    sem_inspecao_dias: busca.sem_inspecao_dias ? String(busca.sem_inspecao_dias) : undefined,
  };
  const filtrosOcorrencias = { estado: busca.estado ?? "abertas" };
  const [tipoSelecao, idSelecao] = (busca.selecao ?? "").split(":") as [
    "arvore" | "ocorrencia" | "",
    string,
  ];

  const atualizarBusca = (parcial: Partial<BuscaMapa>) =>
    void navegar({ search: (s: BuscaMapa) => ({ ...s, ...parcial }), replace: true });

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    m.addSource("bairros", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "bairros-preenchimento",
      type: "fill",
      source: "bairros",
      paint: { "fill-color": "#1f6b45", "fill-opacity": 0.04 },
    });
    m.addLayer({
      id: "bairros-contorno",
      type: "line",
      source: "bairros",
      paint: { "line-color": "#16502f", "line-width": 1, "line-opacity": 0.6 },
    });

    m.addSource("arvores", {
      type: "vector",
      tiles: [urlTiles("arvores", filtrosArvores)],
      minzoom: 0,
      maxzoom: 22,
    });
    m.addLayer({
      id: "arvores-grupos",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: [">", ["get", "quantidade"], 1],
      paint: {
        "circle-color": COR_ARVORE,
        "circle-opacity": 0.75,
        "circle-radius": ["interpolate", ["linear"], ["get", "quantidade"], 2, 7, 50, 13, 1000, 24],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
    // Símbolos distintos por origem da localização (RN-MAPA-002).
    m.addLayer({
      id: "arvores-pontos",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: ["==", ["get", "quantidade"], 1],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 18, 7],
        "circle-color": [
          "match",
          ["get", "localizacao_origem"],
          "gps_campo",
          COR_ARVORE,
          "importada",
          "#ffffff",
          "estimada_web",
          "#e8b04a",
          "#cfd6cc",
        ],
        "circle-stroke-color": COR_ARVORE,
        "circle-stroke-width": ["match", ["get", "localizacao_origem"], "importada", 2, 1],
      },
    });

    if (podeOcorrencias) {
      m.addSource("ocorrencias", {
        type: "vector",
        tiles: [urlTiles("ocorrencias", filtrosOcorrencias)],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "ocorrencias-pontos",
        type: "circle",
        source: "ocorrencias",
        "source-layer": "ocorrencias",
        paint: {
          "circle-radius": [
            "case",
            [">", ["get", "quantidade"], 1],
            ["interpolate", ["linear"], ["get", "quantidade"], 2, 8, 100, 18],
            6,
          ],
          "circle-color": ["case", [">", ["get", "quantidade"], 1], "#c08400", corPorPrioridade],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "risco_confirmado"], true],
            "#7a1a14",
            "#ffffff",
          ],
          "circle-stroke-width": ["case", ["==", ["get", "risco_confirmado"], true], 3, 1.5],
        },
      });
    }
    if (podeTarefas) {
      m.addSource("tarefas", {
        type: "vector",
        tiles: [urlTiles("tarefas", {})],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "tarefas-pontos",
        type: "circle",
        source: "tarefas",
        "source-layer": "tarefas",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 9,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ["case", ["==", ["get", "atrasada"], true], "#b3261e", "#1d5fa8"],
          "circle-stroke-width": 2.5,
        },
      });
    }
    if (podeAlertas) {
      m.addSource("alertas", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "alertas-area",
        type: "fill",
        source: "alertas",
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { visibility: "none" },
        paint: { "fill-color": "#d9480f", "fill-opacity": 0.2 },
      });
      m.addLayer({
        id: "alertas-borda",
        type: "line",
        source: "alertas",
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { visibility: "none" },
        paint: { "line-color": "#d9480f", "line-width": 1.5, "line-dasharray": [2, 1] },
      });
      m.addLayer({
        id: "alertas-pontos",
        type: "circle",
        source: "alertas",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#d9480f",
          "circle-stroke-width": 2.5,
        },
      });
    }
    m.addLayer({
      id: "selecao",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: ["==", ["get", "id"], ""],
      paint: {
        "circle-radius": 12,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#1d5fa8",
        "circle-stroke-width": 3,
      },
    });

    const interativas = [
      "arvores-grupos",
      "arvores-pontos",
      ...(podeOcorrencias ? ["ocorrencias-pontos"] : []),
    ];
    for (const camada of interativas) {
      m.on("mouseenter", camada, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", camada, () => {
        m.getCanvas().style.cursor = "";
        setDica(null);
      });
      m.on("mousemove", camada, (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties ?? {};
        const quantidade = Number(p.quantidade ?? 1);
        const texto =
          quantidade > 1
            ? `${quantidade} ${camada.startsWith("arvores") ? "árvores" : "ocorrências"} — clique para aproximar`
            : camada.startsWith("arvores")
              ? `ARV-${String(p.numero).padStart(6, "0")}${p.especie ? ` · ${p.especie}` : ""}`
              : `OCO-${String(p.numero).padStart(6, "0")} · ${p.tipo}`;
        setDica({ x: e.point.x, y: e.point.y, texto });
      });
      m.on("click", camada, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        if (Number(p.quantidade ?? 1) > 1) {
          m.easeTo({ center: e.lngLat, zoom: Math.min(m.getZoom() + 2.5, 18) });
          return;
        }
        atualizarBusca({
          selecao: `${camada.startsWith("arvores") ? "arvore" : "ocorrencia"}:${p.id}`,
        });
      });
    }
    m.on("moveend", () => {
      const c = m.getCenter();
      atualizarBusca({
        lon: +c.lng.toFixed(5),
        lat: +c.lat.toFixed(5),
        zoom: +m.getZoom().toFixed(1),
      });
    });
    setPronto(true);
  };

  // Alertas ambientais em aberto (geometria como recebida da fonte).
  useEffect(() => {
    if (!pronto || !mostrarAlertas) return;
    void mapaAlertas().then(({ data }) => {
      (mapa.current?.getSource("alertas") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
  }, [pronto, mostrarAlertas]);

  // Limites dos bairros (contexto territorial).
  useEffect(() => {
    if (!pronto) return;
    void territoriosGeojson({ tipo: "bairro", precisao: 5 }).then(({ data }) => {
      (mapa.current?.getSource("bairros") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
  }, [pronto]);

  // Enquadra o escopo do usuário ao abrir sem posição na URL.
  const limites = camadas.data?.data.limites_escopo;
  useEffect(() => {
    if (!pronto || busca.lon !== undefined || !limites) return;
    mapa.current?.fitBounds(limites as [number, number, number, number], {
      padding: 40,
      duration: 0,
    });
    // Só na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, limites]);

  // Filtros → URLs dos tiles.
  const chaveArvores = JSON.stringify(filtrosArvores);
  const chaveOcorrencias = JSON.stringify(filtrosOcorrencias);
  useEffect(() => {
    if (!pronto) return;
    (mapa.current?.getSource("arvores") as VectorTileSource | undefined)?.setTiles([
      urlTiles("arvores", JSON.parse(chaveArvores)),
    ]);
  }, [pronto, chaveArvores]);
  useEffect(() => {
    if (!pronto) return;
    (mapa.current?.getSource("ocorrencias") as VectorTileSource | undefined)?.setTiles([
      urlTiles("ocorrencias", JSON.parse(chaveOcorrencias)),
    ]);
  }, [pronto, chaveOcorrencias]);

  // Visibilidade das camadas.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    for (const id of ["arvores-grupos", "arvores-pontos"])
      m.setLayoutProperty(id, "visibility", vis(mostrarArvores));
    if (m.getLayer("ocorrencias-pontos"))
      m.setLayoutProperty("ocorrencias-pontos", "visibility", vis(mostrarOcorrencias));
    for (const id of ["alertas-area", "alertas-borda", "alertas-pontos"])
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(mostrarAlertas));
    if (m.getLayer("tarefas-pontos"))
      m.setLayoutProperty("tarefas-pontos", "visibility", vis(mostrarTarefas));
    for (const id of ["bairros-preenchimento", "bairros-contorno"])
      m.setLayoutProperty(id, "visibility", vis(mostrarBairros));
  }, [pronto, mostrarArvores, mostrarOcorrencias, mostrarBairros, mostrarTarefas, mostrarAlertas]);

  useEffect(() => {
    if (!pronto) return;
    mapa.current?.setFilter("selecao", [
      "==",
      ["get", "id"],
      tipoSelecao === "arvore" ? idSelecao : "",
    ]);
  }, [pronto, tipoSelecao, idSelecao]);

  const satelite = config.mapaSatelite;
  const info = camadas.data?.data;

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)]">
      {painel && (
        <aside
          aria-label="Camadas e filtros"
          className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-borda bg-superficie p-4 text-sm"
        >
          <div className="flex items-center justify-between">
            <h1 className="font-semibold">Mapa</h1>
            <button
              ref={botaoOcultar}
              className="rounded p-1 hover:bg-fundo"
              aria-label="Ocultar painel"
              onClick={() => alternarPainel(false)}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <nav aria-label="Mesmos dados em lista" className="flex flex-col gap-1 text-sm">
            <p className="text-xs text-texto-suave">
              Os pontos do mapa também podem ser consultados em lista, com os filtros abaixo:
            </p>
            <Link
              to="/inventario/arvores"
              search={{
                especie_estado: busca.especie_estado,
                localizacao_origem: busca.localizacao_origem,
                sem_inspecao_dias: busca.sem_inspecao_dias,
              }}
              className="text-marca underline"
            >
              Ver árvores em lista
            </Link>
            {podeOcorrencias && (
              <Link
                to="/ocorrencias"
                search={{
                  // A lista usa "abertas" ou os estados separados por vírgula ("Todas").
                  estado:
                    busca.estado === "todas"
                      ? Object.values(EstadoOcorrenciaEnum).join(",")
                      : "abertas",
                }}
                className="text-marca underline"
              >
                Ver ocorrências em lista
              </Link>
            )}
          </nav>

          <fieldset>
            <legend className="mb-1.5 font-medium">Mapa base</legend>
            <div className="flex gap-1">
              {(["ruas", "satelite"] as const).map((b) => (
                <Botao
                  key={b}
                  tamanho="pequeno"
                  variante={base === b ? "primario" : "secundario"}
                  aria-pressed={base === b}
                  disabled={b === "satelite" && !satelite}
                  onClick={() => atualizarBusca({ base: b })}
                >
                  {b === "ruas" ? "Ruas" : "Satélite"}
                </Botao>
              ))}
            </div>
            {!satelite && (
              <p className="mt-1.5 text-xs text-texto-suave">
                Imagem de satélite não configurada: o provedor ainda é decisão pendente (DP-07).
              </p>
            )}
            {base === "satelite" && satelite && (
              <p className="mt-1.5 text-xs text-texto-suave">
                Data da imagem:{" "}
                {satelite.data ? formatarData(satelite.data) : "não informada pelo provedor"}.
              </p>
            )}
            {base === "ruas" && config.mapaRuas && (
              <p className="mt-1.5 text-xs text-texto-suave">{config.mapaRuas.atribuicao}</p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 font-medium">Camadas</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-marca"
                checked={mostrarArvores}
                onChange={(e) => atualizarBusca({ arvores: e.target.checked ? undefined : "0" })}
              />
              Árvores
              {info?.arvores && (
                <span className="ml-auto text-xs text-texto-suave">
                  {Number(info.arvores.total).toLocaleString("pt-BR")}
                </span>
              )}
            </label>
            {podeOcorrencias && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-marca"
                  checked={mostrarOcorrencias}
                  onChange={(e) =>
                    atualizarBusca({ ocorrencias: e.target.checked ? undefined : "0" })
                  }
                />
                Ocorrências
                {info?.ocorrencias && (
                  <span className="ml-auto text-xs text-texto-suave">
                    {Number(info.ocorrencias.abertas)} abertas
                  </span>
                )}
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-marca"
                checked={mostrarBairros}
                onChange={(e) => atualizarBusca({ bairros: e.target.checked ? undefined : "0" })}
              />
              Limites de bairros
            </label>
            {podeTarefas && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-marca"
                  checked={mostrarTarefas}
                  onChange={(e) => atualizarBusca({ tarefas: e.target.checked ? "1" : undefined })}
                />
                Tarefas em aberto
              </label>
            )}
            {podeAlertas && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-marca"
                  checked={mostrarAlertas}
                  onChange={(e) => atualizarBusca({ alertas: e.target.checked ? "1" : undefined })}
                />
                Alertas ambientais (sinais externos)
              </label>
            )}
          </fieldset>

          {mostrarArvores && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">Filtros de árvores</legend>
              <Selecao
                aria-label="Identificação da espécie"
                value={busca.especie_estado ?? ""}
                onChange={(e) =>
                  atualizarBusca({
                    especie_estado: (e.target.value || undefined) as EstadoEspecieEnum,
                  })
                }
              >
                <option value="">Qualquer identificação</option>
                {Object.entries(ROTULOS_ESTADO_ESPECIE).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Selecao>
              <Selecao
                aria-label="Inspeção"
                value={busca.sem_inspecao_dias ? String(busca.sem_inspecao_dias) : ""}
                onChange={(e) =>
                  atualizarBusca({
                    sem_inspecao_dias: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              >
                <option value="">Qualquer data de inspeção</option>
                <option value="365">Sem inspeção há 1 ano</option>
                <option value="730">Sem inspeção há 2 anos</option>
              </Selecao>
              <Selecao
                aria-label="Origem da localização"
                value={busca.localizacao_origem ?? ""}
                onChange={(e) =>
                  atualizarBusca({
                    localizacao_origem: (e.target.value || undefined) as OrigemLocalizacaoEnum,
                  })
                }
              >
                <option value="">Qualquer origem de localização</option>
                {Object.entries(ROTULOS_ORIGEM_LOCALIZACAO).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </fieldset>
          )}
          {mostrarOcorrencias && (
            <fieldset>
              <legend className="mb-1 font-medium">Filtros de ocorrências</legend>
              <Selecao
                aria-label="Estado das ocorrências"
                value={busca.estado ?? "abertas"}
                onChange={(e) => atualizarBusca({ estado: e.target.value as BuscaMapa["estado"] })}
              >
                <option value="abertas">Em aberto</option>
                <option value="todas">Todas</option>
              </Selecao>
            </fieldset>
          )}

          <section aria-label="Legenda">
            <h2 className="mb-1.5 font-medium">Legenda</h2>
            <ul className="flex flex-col gap-1.5 text-xs">
              {[
                ["GPS de campo", COR_ARVORE, COR_ARVORE, 1],
                ["Importada", "#ffffff", COR_ARVORE, 2],
                ["Estimada (web)", "#e8b04a", COR_ARVORE, 1],
                ["Outra origem", "#cfd6cc", COR_ARVORE, 1],
              ].map(([r, f, b, w]) => (
                <li key={r as string} className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ background: f as string, border: `${w}px solid ${b}` }}
                  />{" "}
                  Árvore — localização {String(r).toLowerCase()}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span
                  className="inline-block size-4 rounded-full opacity-75"
                  style={{ background: COR_ARVORE }}
                />{" "}
                Agrupamento (tamanho = quantidade)
              </li>
              {podeOcorrencias &&
                Object.entries({
                  urgente: "Urgente",
                  alta: "Alta",
                  media: "Média",
                  baixa: "Baixa",
                  "": "Sem prioridade",
                }).map(([k, r]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full border border-white"
                      style={{ background: CORES_PRIORIDADE[k] }}
                    />{" "}
                    Ocorrência — {r.toLowerCase()}
                  </li>
                ))}
              {podeOcorrencias && (
                <li className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ border: "3px solid #7a1a14" }}
                  />{" "}
                  Risco confirmado
                </li>
              )}
              {podeAlertas && (
                <li className="flex items-center gap-2">
                  <span className="inline-block size-3" style={{ border: "2px dashed #d9480f" }} />{" "}
                  Alerta ambiental (não é confirmação de infração)
                </li>
              )}
              {podeTarefas && (
                <li className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ border: "2.5px solid #1d5fa8" }}
                  />{" "}
                  Tarefa em aberto (contorno vermelho: atrasada)
                </li>
              )}
            </ul>
          </section>

          <section aria-label="Fontes das camadas" className="text-xs text-texto-suave">
            <h2 className="mb-1 font-medium text-texto">Fontes</h2>
            {info?.territorios.length ? (
              info.territorios.map((t) => (
                <p key={String(t.tipo)}>
                  {ROTULOS_TIPO_TERRITORIO[t.tipo as keyof typeof ROTULOS_TIPO_TERRITORIO] ??
                    String(t.tipo)}
                  : {(t.fontes as string[]).join(", ")} · ingerido em{" "}
                  {formatarDataHora(String(t.ingerido_em))}
                  {t.data_referencia_mais_antiga
                    ? ` · dados de ${formatarData(String(t.data_referencia_mais_antiga))}`
                    : " · data dos dados não informada"}
                </p>
              ))
            ) : (
              <p>Nenhuma camada territorial importada.</p>
            )}
            {info?.arvores && Number(info.arvores.sem_localizacao) > 0 && (
              <p className="mt-1 text-atencao">
                {Number(info.arvores.sem_localizacao)} árvores sem localização não aparecem no mapa.
              </p>
            )}
          </section>
        </aside>
      )}

      <Mapa
        base={base}
        rotulo="Mapa de árvores e ocorrências"
        className="flex-1"
        centro={
          busca.lon !== undefined && busca.lat !== undefined ? [busca.lon, busca.lat] : undefined
        }
        zoom={busca.zoom}
        aoCarregar={aoCarregar}
      >
        {!painel && (
          <Botao
            ref={botaoMostrar}
            variante="secundario"
            className="absolute top-3 left-3 shadow"
            onClick={() => alternarPainel(true)}
          >
            <Layers /> Camadas
          </Botao>
        )}
        {dica && (
          <div
            className="pointer-events-none absolute z-10 rounded bg-texto px-2 py-1 text-xs text-white"
            style={{ left: dica.x + 12, top: dica.y + 12 }}
          >
            {dica.texto}
          </div>
        )}
        {tipoSelecao && idSelecao && (
          <PainelContextual
            tipo={tipoSelecao}
            id={idSelecao}
            aoFechar={() => atualizarBusca({ selecao: undefined })}
          />
        )}
      </Mapa>
    </div>
  );
}

function PainelContextual({
  tipo,
  id,
  aoFechar,
}: {
  tipo: "arvore" | "ocorrencia";
  id: string;
  aoFechar: () => void;
}) {
  return (
    <aside
      aria-label="Detalhes da seleção"
      className="absolute top-3 right-3 bottom-3 z-10 flex w-96 flex-col overflow-y-auto rounded-lg border border-borda bg-superficie p-4 shadow-lg"
    >
      <button
        className="absolute top-3 right-3 rounded p-1 hover:bg-fundo"
        aria-label="Fechar detalhes"
        onClick={aoFechar}
      >
        <X className="size-4" />
      </button>
      {tipo === "arvore" ? <ResumoArvore id={id} /> : <ResumoOcorrencia id={id} />}
    </aside>
  );
}

function ResumoArvore({ id }: { id: string }) {
  const consulta = useArvoresObter(id);
  if (consulta.isPending) return <Carregando linhas={4} />;
  if (consulta.isError)
    return <p className="text-sm text-perigo">Não foi possível carregar a árvore.</p>;
  const a = consulta.data.data;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="font-mono text-lg font-semibold">{a.codigo}</p>
        <p className={a.especie ? "italic" : "text-texto-suave"}>{nomeEspecie(a)}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <SeloEspecie estado={a.especie_estado ?? "nao_identificada"} />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-texto-suave uppercase">Localização</p>
        <SeloLocalizacao origem={a.localizacao_origem ?? ""} precisao={a.precisao_m} />
        {!a.precisao_m && (
          <p className="text-xs text-texto-suave">Precisão não informada pela origem.</p>
        )}
        <p className="mt-1">{[a.endereco, a.bairro?.nome].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-texto-suave uppercase">Medidas mais recentes</p>
        {a.medidas_atuais.length ? (
          a.medidas_atuais.map((m) => (
            <p key={m.id}>
              {m.tipo === "dap" ? "DAP" : m.tipo === "altura" ? "Altura" : m.tipo}:{" "}
              {m.origem === "estimado" ? "≈ " : ""}
              {Number(m.valor).toLocaleString("pt-BR")} {m.unidade}{" "}
              <span className="text-xs text-texto-suave">({m.origem})</span>
            </p>
          ))
        ) : (
          <p className="text-texto-suave">Nenhuma</p>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-texto-suave uppercase">Condição aparente</p>
        <p className="text-texto-suave">Sem avaliação registrada.</p>
      </div>
      <p>Ocorrências abertas: {a.ocorrencias_abertas ?? 0}</p>
      <Botao asChild>
        <Link to="/inventario/arvores/$id" params={{ id: a.id }}>
          Abrir cadastro completo
        </Link>
      </Botao>
    </div>
  );
}

function ResumoOcorrencia({ id }: { id: string }) {
  const consulta = useOcorrenciasObter(id);
  if (consulta.isPending) return <Carregando linhas={4} />;
  if (consulta.isError)
    return <p className="text-sm text-perigo">Não foi possível carregar a ocorrência.</p>;
  const o = consulta.data.data;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="font-mono text-lg font-semibold">{o.codigo}</p>
        <p className="font-medium">{o.tipo.nome}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <SeloEstadoOcorrencia estado={o.estado} />
          <SeloPrioridade prioridade={o.prioridade} />
        </div>
      </div>
      <p className="whitespace-pre-wrap">{o.descricao}</p>
      {o.condicao_aparente && (
        <div>
          <p className="text-xs font-medium text-texto-suave uppercase">Condição aparente</p>
          <p>{o.condicao_aparente}</p>
        </div>
      )}
      <p className="text-xs text-texto-suave">Registrada em {formatarDataHora(o.criado_em)}</p>
      <Botao asChild>
        <Link to="/ocorrencias/$id" params={{ id: o.id }}>
          Abrir ocorrência
        </Link>
      </Botao>
    </div>
  );
}
