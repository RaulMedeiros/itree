import {
  mapaAlertas,
  territoriosGeojson,
  useArvoresObter,
  useEvidenciasListar,
  useMapaCamadas,
  useOcorrenciasObter,
  EstadoOcorrenciaEnum,
  type CondicaoAparenteEnum,
  type EstadoEspecieEnum,
  type OrigemLocalizacaoEnum,
} from "@itree/api-client";
import {
  ROTULOS_CONDICAO,
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ORIGEM_LOCALIZACAO,
  ROTULOS_TIPO_TERRITORIO,
} from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  GeoJSONSource,
  Map as MapaMapLibre,
  MapLayerMouseEvent,
  Marker,
  VectorTileSource,
} from "maplibre-gl";
import { ChevronDown, Layers, List, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
import { maplibregl } from "../../mapa/maplibre";
import { urlApi } from "../../mapa/url";
import type { TipoBase } from "../../mapa/estilo";
import {
  COR_ALERTA,
  COR_SELECAO,
  COR_TAREFA,
  COR_TAREFA_ATRASADA,
  CORES_CONDICAO,
  CORES_ORIGEM,
  CORES_PRIORIDADE,
  aoFaltarImagem,
  iconeGrupo,
  pinturaArvores,
  registrarIcones,
  type ModoCor,
} from "../../mapa/simbologia";
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
  condicao_aparente?: "boa" | "regular" | "ruim" | "morta" | "sem";
  estado?: "abertas" | "todas";
  cor?: "origem";
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

const ZOOM_ROTULOS = 12.5;

const ID_OCORRENCIA: unknown = [
  "case",
  ["==", ["get", "risco_confirmado"], true],
  ["concat", "oco-", ["get", "prioridade"], "-risco"],
  ["concat", "oco-", ["get", "prioridade"]],
];

export function MapaPagina() {
  const busca = useSearch({ from: "/autenticado/mapa" });
  const navegar = useNavigate({ from: "/mapa" });
  const podeOcorrencias = usePermissao("ocorrencias.ler");
  const podeTarefas = usePermissao("tarefas.ler");
  const podeAlertas = usePermissao("alertas.ler");
  const camadas = useMapaCamadas();
  const mapa = useRef<MapaMapLibre | null>(null);
  const rotulos = useRef<Marker[]>([]);
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
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);

  const base: TipoBase = busca.base ?? "ruas";
  const modoCor: ModoCor = busca.cor === "origem" ? "origem" : "condicao";
  const mostrarArvores = busca.arvores !== "0";
  const mostrarOcorrencias = podeOcorrencias && busca.ocorrencias !== "0";
  const mostrarBairros = busca.bairros !== "0";
  const mostrarTarefas = podeTarefas && busca.tarefas === "1";
  const mostrarAlertas = podeAlertas && busca.alertas === "1";
  const filtrosArvores = {
    especie_estado: busca.especie_estado,
    localizacao_origem: busca.localizacao_origem,
    condicao_aparente: busca.condicao_aparente,
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
    registrarIcones(m);
    m.on("styleimagemissing", (e) => aoFaltarImagem(m, e.id));

    m.addSource("bairros", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "bairros-preenchimento",
      type: "fill",
      source: "bairros",
      paint: { "fill-color": "#2b8a3e", "fill-opacity": 0.05 },
    });
    m.addLayer({
      id: "bairros-contorno",
      type: "line",
      source: "bairros",
      paint: {
        "line-color": "#2b5f45",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2],
        "line-opacity": 0.75,
      },
    });

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
        paint: { "fill-pattern": "hachura-alerta", "fill-opacity": 0.6 },
      });
      m.addLayer({
        id: "alertas-borda",
        type: "line",
        source: "alertas",
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { visibility: "none" },
        paint: { "line-color": COR_ALERTA, "line-width": 2, "line-dasharray": [3, 1.5] },
      });
    }

    m.addSource("arvores", {
      type: "vector",
      tiles: [urlTiles("arvores", filtrosArvores)],
      minzoom: 0,
      maxzoom: 22,
    });
    // Cor = condição aparente (ou origem); contorno = origem da localização (RN-MAPA-002).
    m.addLayer({
      id: "arvores-pontos",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: ["==", ["get", "quantidade"], 1],
      paint: pinturaArvores(modoCor) as never,
    });
    m.addLayer({
      id: "arvores-grupos",
      type: "symbol",
      source: "arvores",
      "source-layer": "arvores",
      filter: [">", ["get", "quantidade"], 1],
      layout: { "icon-image": iconeGrupo("arvores"), "icon-allow-overlap": true },
    });

    if (podeTarefas) {
      m.addSource("tarefas", {
        type: "vector",
        tiles: [urlTiles("tarefas", {})],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "tarefas-pontos",
        type: "symbol",
        source: "tarefas",
        "source-layer": "tarefas",
        layout: {
          visibility: "none",
          "icon-image": ["case", ["==", ["get", "atrasada"], true], "tarefa-atrasada", "tarefa"],
          "icon-allow-overlap": true,
          // Ao lado da árvore, sem escondê-la.
          "icon-anchor": "bottom-left",
          "icon-offset": [3, -3],
        },
      });
    }

    if (podeOcorrencias) {
      m.addSource("ocorrencias", {
        type: "vector",
        tiles: [urlTiles("ocorrencias", filtrosOcorrencias)],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "ocorrencias-grupos",
        type: "symbol",
        source: "ocorrencias",
        "source-layer": "ocorrencias",
        filter: [">", ["get", "quantidade"], 1],
        layout: { "icon-image": iconeGrupo("ocorrencias"), "icon-allow-overlap": true },
      });
      m.addLayer({
        id: "ocorrencias-pontos",
        type: "symbol",
        source: "ocorrencias",
        "source-layer": "ocorrencias",
        filter: ["==", ["get", "quantidade"], 1],
        layout: {
          "icon-image": ID_OCORRENCIA as never,
          "icon-allow-overlap": true,
          "icon-anchor": "bottom",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.75, 16, 1, 18, 1.2],
        },
      });
    }

    if (podeAlertas) {
      m.addLayer({
        id: "alertas-pontos",
        type: "symbol",
        source: "alertas",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { visibility: "none", "icon-image": "alerta", "icon-allow-overlap": true },
      });
    }

    m.addLayer({
      id: "selecao",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: ["==", ["get", "id"], ""],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 9, 18, 16],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": COR_SELECAO,
        "circle-stroke-width": 3,
      },
    });

    const interativas = [
      "arvores-grupos",
      "arvores-pontos",
      ...(podeOcorrencias ? ["ocorrencias-grupos", "ocorrencias-pontos"] : []),
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
        const ehArvore = camada.startsWith("arvores");
        const texto =
          quantidade > 1
            ? `${quantidade} ${ehArvore ? "árvores" : "ocorrências"} — clique para aproximar`
            : ehArvore
              ? `ARV-${String(p.numero).padStart(6, "0")}${p.especie ? ` · ${p.especie}` : ""} · ${
                  ROTULOS_CONDICAO[(p.condicao ?? "nao_avaliada") as CondicaoAparenteEnum] ??
                  "Não avaliada"
                }`
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
    // Coordenada sob o cursor (RF-MAPA-012).
    m.on("mousemove", (e) => setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    m.on("mouseout", () => setCursor(null));
    // Nomes dos bairros só quando há espaço para lê-los.
    m.on("zoomend", () => {
      const visivel = m.getZoom() >= ZOOM_ROTULOS;
      for (const r of rotulos.current) r.getElement().hidden = !visivel;
    });
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

  // Limites e nomes dos bairros (contexto territorial).
  useEffect(() => {
    if (!pronto) return;
    void territoriosGeojson({ tipo: "bairro", precisao: 5 }).then(({ data }) => {
      const m = mapa.current;
      if (!m) return;
      (m.getSource("bairros") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
      for (const r of rotulos.current) r.remove();
      const feicoes = (data as { features?: { properties: { nome: string; rotulo?: number[] } }[] })
        .features;
      rotulos.current = (feicoes ?? [])
        .filter((f) => f.properties.rotulo?.length === 2)
        .map((f) => {
          const el = document.createElement("div");
          el.className = "rotulo-bairro";
          el.textContent = f.properties.nome;
          el.setAttribute("aria-hidden", "true");
          el.hidden = m.getZoom() < ZOOM_ROTULOS;
          return new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat(f.properties.rotulo as [number, number])
            .addTo(m);
        });
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

  // Modo de cor das árvores.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const pintura = pinturaArvores(modoCor);
    for (const [k, v] of Object.entries(pintura))
      m.setPaintProperty("arvores-pontos", k as never, v as never);
  }, [pronto, modoCor]);

  // Visibilidade das camadas.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    const definir = (ids: string[], v: boolean) => {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(v));
    };
    definir(["arvores-grupos", "arvores-pontos"], mostrarArvores);
    definir(["ocorrencias-grupos", "ocorrencias-pontos"], mostrarOcorrencias);
    definir(["alertas-area", "alertas-borda", "alertas-pontos"], mostrarAlertas);
    definir(["tarefas-pontos"], mostrarTarefas);
    definir(["bairros-preenchimento", "bairros-contorno"], mostrarBairros);
    for (const r of rotulos.current) r.getElement().style.display = mostrarBairros ? "" : "none";
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
    <div className="-m-6 h-[calc(100vh-3.5rem)]">
      <Mapa
        base={base}
        rotulo="Mapa de árvores e ocorrências"
        className="h-full w-full"
        centro={
          busca.lon !== undefined && busca.lat !== undefined ? [busca.lon, busca.lat] : undefined
        }
        zoom={busca.zoom}
        aoCarregar={aoCarregar}
      >
        {/* Coluna esquerda: painel (encolhe e rola) e legenda, sem se sobrepor. */}
        <div className="pointer-events-none absolute top-3 bottom-9 left-3 z-10 flex w-80 flex-col gap-2">
          {painel ? (
            <aside
              aria-label="Camadas e filtros"
              className="pointer-events-auto flex min-h-0 shrink flex-col overflow-hidden rounded-xl border border-borda bg-superficie/95 text-sm shadow-lg backdrop-blur"
            >
              <div className="flex items-center justify-between border-b border-borda px-4 py-3">
                <h1 className="flex items-center gap-2 font-semibold">
                  <Layers className="size-4 text-marca" aria-hidden /> Camadas e filtros
                </h1>
                <button
                  ref={botaoOcultar}
                  className="rounded p-1 hover:bg-fundo"
                  aria-label="Ocultar painel"
                  onClick={() => alternarPainel(false)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="flex flex-col gap-1 overflow-y-auto px-4 py-2">
                <Grupo titulo="Operacionais" aberto>
                  <Camada
                    rotulo="Árvores"
                    marcador={<Bolinha cor={CORES_CONDICAO.boa} />}
                    ativa={mostrarArvores}
                    contagem={
                      info?.arvores ? Number(info.arvores.total).toLocaleString("pt-BR") : undefined
                    }
                    aoMudar={(v) => atualizarBusca({ arvores: v ? undefined : "0" })}
                  />
                  {podeOcorrencias && (
                    <Camada
                      rotulo="Ocorrências"
                      marcador={<Triangulo cor={CORES_PRIORIDADE.alta!} />}
                      ativa={mostrarOcorrencias}
                      contagem={
                        info?.ocorrencias
                          ? `${Number(info.ocorrencias.abertas)} abertas`
                          : undefined
                      }
                      aoMudar={(v) => atualizarBusca({ ocorrencias: v ? undefined : "0" })}
                    />
                  )}
                  {podeTarefas && (
                    <Camada
                      rotulo="Tarefas em aberto"
                      marcador={<Quadrado cor={COR_TAREFA} />}
                      ativa={mostrarTarefas}
                      aoMudar={(v) => atualizarBusca({ tarefas: v ? "1" : undefined })}
                    />
                  )}
                </Grupo>

                <Grupo titulo="Territoriais" aberto>
                  <Camada
                    rotulo="Bairros"
                    marcador={
                      <span className="inline-block size-3 rounded-sm border-2 border-[#2b5f45]" />
                    }
                    ativa={mostrarBairros}
                    aoMudar={(v) => atualizarBusca({ bairros: v ? undefined : "0" })}
                  />
                </Grupo>

                {podeAlertas && (
                  <Grupo titulo="Ambientais — sinais externos" aberto>
                    <Camada
                      rotulo="Alertas ambientais"
                      marcador={<Losango cor={COR_ALERTA} />}
                      ativa={mostrarAlertas}
                      aoMudar={(v) => atualizarBusca({ alertas: v ? "1" : undefined })}
                    />
                    <p className="text-xs text-texto-suave">
                      Detecções de satélite e focos de calor não provam irregularidade.
                    </p>
                  </Grupo>
                )}

                {mostrarArvores && (
                  <Grupo titulo="Árvores" aberto>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-texto-suave">Colorir por</span>
                      <Selecao
                        value={modoCor}
                        onChange={(e) =>
                          atualizarBusca({
                            cor: e.target.value === "origem" ? "origem" : undefined,
                          })
                        }
                      >
                        <option value="condicao">Condição aparente</option>
                        <option value="origem">Origem da localização</option>
                      </Selecao>
                    </label>
                    <Selecao
                      aria-label="Condição aparente"
                      value={busca.condicao_aparente ?? ""}
                      onChange={(e) =>
                        atualizarBusca({
                          condicao_aparente: (e.target.value ||
                            undefined) as BuscaMapa["condicao_aparente"],
                        })
                      }
                    >
                      <option value="">Qualquer condição</option>
                      {(["boa", "regular", "ruim", "morta"] as const).map((v) => (
                        <option key={v} value={v}>
                          {ROTULOS_CONDICAO[v]}
                        </option>
                      ))}
                      <option value="sem">Não avaliada</option>
                    </Selecao>
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
                          localizacao_origem: (e.target.value ||
                            undefined) as OrigemLocalizacaoEnum,
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
                  </Grupo>
                )}

                {mostrarOcorrencias && (
                  <Grupo titulo="Ocorrências" aberto>
                    <Selecao
                      aria-label="Estado das ocorrências"
                      value={busca.estado ?? "abertas"}
                      onChange={(e) =>
                        atualizarBusca({ estado: e.target.value as BuscaMapa["estado"] })
                      }
                    >
                      <option value="abertas">Em aberto</option>
                      <option value="todas">Todas</option>
                    </Selecao>
                  </Grupo>
                )}

                <Grupo titulo="Mapa base">
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
                    <p className="text-xs text-texto-suave">
                      Imagem de satélite não configurada: o provedor ainda é decisão pendente
                      (DP-07).
                    </p>
                  )}
                  {base === "satelite" && satelite && (
                    <p className="text-xs text-texto-suave">
                      Data da imagem:{" "}
                      {satelite.data ? formatarData(satelite.data) : "não informada pelo provedor"}.
                    </p>
                  )}
                </Grupo>

                <Grupo titulo="Fontes dos dados">
                  <div className="text-xs text-texto-suave">
                    {info?.territorios.length ? (
                      info.territorios.map((t) => (
                        <p key={String(t.tipo)}>
                          {ROTULOS_TIPO_TERRITORIO[
                            t.tipo as keyof typeof ROTULOS_TIPO_TERRITORIO
                          ] ?? String(t.tipo)}
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
                    {base === "ruas" && config.mapaRuas && <p>{config.mapaRuas.atribuicao}</p>}
                    {info?.arvores && Number(info.arvores.sem_localizacao) > 0 && (
                      <p className="mt-1 text-atencao">
                        {Number(info.arvores.sem_localizacao)} árvores sem localização não aparecem
                        no mapa.
                      </p>
                    )}
                  </div>
                </Grupo>
              </div>

              <nav
                aria-label="Mesmos dados em lista"
                className="flex flex-wrap gap-x-4 gap-y-1 border-t border-borda px-4 py-2.5 text-xs"
              >
                <List className="size-3.5 self-center text-texto-suave" aria-hidden />
                <Link
                  to="/inventario/arvores"
                  search={{
                    especie_estado: busca.especie_estado,
                    localizacao_origem: busca.localizacao_origem,
                    sem_inspecao_dias: busca.sem_inspecao_dias,
                    condicao_aparente: busca.condicao_aparente,
                  }}
                  className="text-marca underline"
                >
                  Árvores em lista
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
                    Ocorrências em lista
                  </Link>
                )}
              </nav>
            </aside>
          ) : (
            <Botao
              ref={botaoMostrar}
              variante="secundario"
              className="pointer-events-auto self-start shadow"
              onClick={() => alternarPainel(true)}
            >
              <Layers /> Camadas e filtros
            </Botao>
          )}
          <div className="flex-1" />
          <Legenda
            modoCor={modoCor}
            arvores={mostrarArvores}
            ocorrencias={mostrarOcorrencias}
            tarefas={mostrarTarefas}
            alertas={mostrarAlertas}
          />
        </div>

        {cursor && (
          <div
            className="pointer-events-none absolute right-14 bottom-2 z-10 rounded bg-superficie/90 px-2 py-0.5 font-mono text-[11px] text-texto-suave shadow-sm"
            aria-hidden
          >
            {cursor.lat.toFixed(5)}, {cursor.lon.toFixed(5)}
          </div>
        )}
        {dica && (
          <div
            className="pointer-events-none absolute z-20 rounded-md bg-texto px-2 py-1 text-xs text-white shadow"
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

// --- Peças do painel e da legenda ---------------------------------------------

function Grupo({
  titulo,
  aberto,
  children,
}: {
  titulo: string;
  aberto?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={aberto} className="group border-b border-borda py-2 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold tracking-wide text-texto-suave uppercase">
        {titulo}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-1.5 flex flex-col gap-2">{children}</div>
    </details>
  );
}

function Camada({
  rotulo,
  marcador,
  ativa,
  contagem,
  aoMudar,
}: {
  rotulo: string;
  marcador: ReactNode;
  ativa: boolean;
  contagem?: string;
  aoMudar: (ativa: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className="accent-marca"
        checked={ativa}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span className="flex w-4 justify-center" aria-hidden>
        {marcador}
      </span>
      {rotulo}
      {contagem && <span className="ml-auto text-xs text-texto-suave">{contagem}</span>}
    </label>
  );
}

function Bolinha({ cor, vazada, borda }: { cor: string; vazada?: boolean; borda?: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full"
      style={{
        background: vazada ? `${cor}40` : cor,
        border: `${vazada || borda ? 2 : 1.5}px solid ${vazada ? cor : (borda ?? "#ffffff")}`,
        boxShadow: vazada || borda ? undefined : "0 0 0 1px rgba(0,0,0,0.15)",
      }}
    />
  );
}

function Triangulo({ cor, risco }: { cor: string; risco?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5">
      <path
        d="M6 1 L11 10.5 L1 10.5 Z"
        fill={cor}
        stroke={risco ? "#3b0d0c" : "#ffffff"}
        strokeWidth={risco ? 1.6 : 1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Quadrado({ cor }: { cor: string }) {
  return (
    <span
      className="inline-block size-3 rounded-[2px] border-2 bg-white"
      style={{ borderColor: cor }}
    />
  );
}

function Losango({ cor }: { cor: string }) {
  return <span className="inline-block size-2.5 rotate-45" style={{ background: cor }} />;
}

/** Legenda só das camadas ativas (RF-MAPA-007). */
function Legenda({
  modoCor,
  arvores,
  ocorrencias,
  tarefas,
  alertas,
}: {
  modoCor: ModoCor;
  arvores: boolean;
  ocorrencias: boolean;
  tarefas: boolean;
  alertas: boolean;
}) {
  const [aberta, setAberta] = useState(true);
  if (!arvores && !ocorrencias && !tarefas && !alertas) return null;
  return (
    <section
      aria-label="Legenda"
      className="pointer-events-auto shrink-0 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
    >
      <button
        className="flex w-full items-center justify-between gap-4 font-semibold"
        aria-expanded={aberta}
        onClick={() => setAberta((a) => !a)}
      >
        Legenda
        <ChevronDown
          className={`size-4 transition-transform ${aberta ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {aberta && (
        <div className="mt-2 flex flex-col gap-2.5">
          {arvores && (
            <div>
              <p className="mb-1 text-texto-suave">
                Árvores — {modoCor === "condicao" ? "condição aparente" : "origem da localização"}
              </p>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                {modoCor === "condicao"
                  ? (Object.keys(CORES_CONDICAO) as CondicaoAparenteEnum[]).map((c) => (
                      <li key={c} className="flex items-center gap-1.5">
                        <Bolinha cor={CORES_CONDICAO[c]} /> {ROTULOS_CONDICAO[c]}
                      </li>
                    ))
                  : Object.entries(ROTULOS_ORIGEM_LOCALIZACAO).map(([o, r]) => (
                      <li key={o} className="flex items-center gap-1.5">
                        <Bolinha cor={CORES_ORIGEM[o]!} /> {r}
                      </li>
                    ))}
              </ul>
              <p className="mt-1.5 mb-1 text-texto-suave">Símbolo — origem da localização</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                <li className="flex items-center gap-1.5">
                  <Bolinha cor="#5c6b63" borda="#0b3d2a" /> GPS de campo
                </li>
                <li className="flex items-center gap-1.5">
                  <Bolinha cor="#5c6b63" /> Importada
                </li>
                <li className="flex items-center gap-1.5">
                  <Bolinha cor="#5c6b63" vazada /> Estimada
                </li>
              </ul>
            </div>
          )}
          {ocorrencias && (
            <div>
              <p className="mb-1 text-texto-suave">Ocorrências — prioridade operacional</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {(
                  [
                    ["urgente", "Urgente"],
                    ["alta", "Alta"],
                    ["media", "Média"],
                    ["baixa", "Baixa"],
                    ["", "Sem prioridade"],
                  ] as const
                ).map(([k, r]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <Triangulo cor={CORES_PRIORIDADE[k]!} /> {r}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <Triangulo cor={CORES_PRIORIDADE.alta!} risco /> Risco confirmado
                </li>
              </ul>
            </div>
          )}
          {tarefas && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              <li className="flex items-center gap-1.5">
                <Quadrado cor={COR_TAREFA} /> Tarefa em aberto
              </li>
              <li className="flex items-center gap-1.5">
                <Quadrado cor={COR_TAREFA_ATRASADA} /> Atrasada
              </li>
            </ul>
          )}
          {alertas && (
            <p className="flex items-center gap-1.5">
              <Losango cor={COR_ALERTA} /> Alerta ambiental — sinal externo, não é confirmação de
              infração
            </p>
          )}
        </div>
      )}
    </section>
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
      className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] w-96 flex-col overflow-y-auto rounded-xl border border-borda bg-superficie p-4 shadow-lg"
    >
      <button
        className="absolute top-3 right-3 z-10 rounded-full bg-superficie/90 p-1 shadow-sm hover:bg-fundo"
        aria-label="Fechar detalhes"
        onClick={aoFechar}
      >
        <X className="size-4" />
      </button>
      {tipo === "arvore" ? <ResumoArvore id={id} /> : <ResumoOcorrencia id={id} />}
    </aside>
  );
}

/** Primeira foto disponível, para reconhecer a árvore em campo. */
function FotoDaArvore({ id }: { id: string }) {
  const consulta = useEvidenciasListar({ arvore: id });
  const foto = consulta.data?.data.find((e) => e.eh_imagem && e.url);
  if (!foto?.url) return null;
  return (
    <img
      src={foto.url}
      alt={foto.descricao || `Foto de ${foto.nome_original}`}
      className="-mx-4 -mt-4 aspect-[16/9] w-[calc(100%+2rem)] max-w-none rounded-t-xl object-cover"
    />
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
      <FotoDaArvore id={id} />
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
