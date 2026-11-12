import {
  areasVerdesListar,
  indicadoresArborizacaoEntornoGeojson,
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
  ROTULOS_TIPO_AREA_VERDE,
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
import { ChevronDown, ClipboardList, Layers, Leaf, List, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { DetalhesTecnicos } from "../../componentes/DetalhesTecnicos";
import {
  SeloEspecie,
  SeloIlustracao,
  SeloEstadoOcorrencia,
  SeloLocalizacao,
  SeloPrioridade,
  nomeEspecie,
} from "../../componentes/selos";
import { config } from "../../config";
import { useTerritorioAtivo } from "../../layout/territorio";
import { Mapa } from "../../mapa/Mapa";
import { AreaRolavel } from "../../ui/rolagem";
import { maplibregl } from "../../mapa/maplibre";
import {
  adicionarRealce,
  definirRealce,
  limitesDaGeometria,
  type FeicaoTerritorio,
} from "../../mapa/realce";
import { rotulosVisiveis } from "../../mapa/rotulos";
import {
  adicionarCamadasArea,
  definirArea,
  iniciarDesenho,
  poligonoDeLimites,
  type FormaArea,
  type PoligonoGeoJson,
} from "../../mapa/desenho";
import {
  codificarArea,
  decodificarArea,
  simplificarArea,
  type AreaSimplificada,
} from "../../mapa/areaUrl";
import {
  CAMADAS_ARBORIZACAO,
  COR_POR_VALOR,
  COR_SEM_DADO,
  CORES_ARBORIZACAO,
  FILTRO_COM_DADO,
  FILTRO_SEM_DADO,
  FONTE_ARBORIZACAO,
  IMAGEM_SEM_DADO,
  OPACIDADE_ARBORIZACAO,
  ROTULOS_CLASSES_ARBORIZACAO,
  registrarHachuraSemDado,
} from "../../mapa/coropletica";
import { urlApi } from "../../mapa/url";
import type { TipoBase } from "../../mapa/estilo";
import {
  COR_ALERTA,
  COR_SELECAO,
  COR_TAREFA,
  COR_TAREFA_ATRASADA,
  CORES_AREA_VERDE,
  CORES_CONDICAO,
  CORES_ORIGEM,
  CORES_PRIORIDADE,
  OPACIDADE_AREA_VERDE,
  OPACIDADE_AREA_VERDE_UC,
  aoFaltarImagem,
  layoutGrupo,
  pinturaArvores,
  registrarIcones,
  type ModoCor,
} from "../../mapa/simbologia";
import { Botao } from "../../ui/botao";
import { Selecao } from "../../ui/campos";
import { useTituloDocumento } from "../../util/titulo";
import { Carregando } from "../../ui/estados";
import {
  formatarData,
  formatarDataHora,
  formatarPontoGeografico,
  plural,
} from "../../util/formatos";
import { BarraSelecaoArea, PainelSelecaoArea } from "./SelecaoArea";
import { NovaOcorrenciaDialogo } from "../ocorrencias/NovaOcorrenciaDialogo";
import { CriarTarefasDialogo } from "../tarefas/CriarTarefasDialogo";

export interface BuscaMapa {
  lon?: number;
  lat?: number;
  zoom?: number;
  base?: TipoBase;
  camada?: "arvores" | "ocorrencias";
  arvores?: "0";
  ocorrencias?: "0";
  bairros?: "0";
  areas_verdes?: "1";
  /** Camada coroplética "Arborização do entorno (Censo 2022)"; desligada por padrão. */
  arborizacao_entorno?: "1";
  tarefas?: "1";
  alertas?: "1";
  sem_inspecao_dias?: number;
  especie_estado?: EstadoEspecieEnum;
  localizacao_origem?: OrigemLocalizacaoEnum;
  condicao_aparente?: "boa" | "regular" | "ruim" | "morta" | "sem";
  estado?: "abertas" | "todas";
  cor?: "origem";
  selecao?: string;
  /** Território (bairro) buscado, realçado até a próxima interação. */
  destaque?: string;
  /** Área da seleção por área, codificada por `codificarArea`. */
  area?: string;
}

/** Proveniência da camada "Arborização do entorno", como a API a devolve. */
interface ProvenienciaIndicador {
  nome: string;
  fonte: string;
  fonte_url?: string;
  licenca?: string;
  data_referencia?: string | null;
  ingerido_em?: string;
  definicao: string;
  metodo?: string;
}

/** Texto curto da definição, enquanto a camada ainda não trouxe a proveniência da API. */
const DEFINICAO_ARBORIZACAO =
  "Percentual das faces de quadra do bairro em que o Censo 2022 registrou ao menos uma árvore no entorno dos domicílios. Não mede copa nem cobertura vegetal.";

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

/** Camadas operacionais com clique próprio: o clique nelas não abre a área verde por baixo. */
const CAMADAS_COM_CLIQUE = [
  "arvores-grupos",
  "arvores-pontos",
  "ocorrencias-grupos",
  "ocorrencias-pontos",
];

/** Estado da última importação das áreas verdes, devolvido junto da camada (RF-INT-005). */
interface SituacaoFonteAreasVerdes {
  ultima_importacao: string | null;
  dias: number | null;
  limite_dias: number;
  desatualizada: boolean;
}

/** Propriedades de uma feição de `GET /api/v1/areas-verdes`, como chegam do MapLibre. */
interface AreaVerdeSelecionada {
  nome: string;
  nome_popular?: string;
  tipo: string;
  tipo_rotulo?: string;
  orgao_gestor?: string;
  esfera?: string;
  ato_legal?: string;
  area_m2?: number | null;
  fonte: string;
  licenca?: string;
  data_referencia?: string | null;
  ingerido_em?: string;
}

const COR_AREA_VERDE_POR_TIPO = ["match", ["get", "tipo"]] as unknown[];
for (const [tipo, cor] of Object.entries(CORES_AREA_VERDE)) COR_AREA_VERDE_POR_TIPO.push(tipo, cor);
COR_AREA_VERDE_POR_TIPO.push("#4b6b3a");

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
  const podeMapa = usePermissao("mapa.ler");
  const territorioAtivo = useTerritorioAtivo();
  const camadas = useMapaCamadas();
  const mapa = useRef<MapaMapLibre | null>(null);
  const rotulos = useRef<Marker[]>([]);
  const limitesRotulos = useRef<([number, number, number, number] | null)[]>([]);
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
  // Feições dos bairros, para realçar o buscado, e o destaque vigente (lido nos eventos do mapa).
  const [feicoesBairros, setFeicoesBairros] = useState<FeicaoTerritorio[]>([]);
  const destaqueAtual = useRef<string | undefined>(undefined);
  // Seleção por área (RF-MAPA-022): forma em desenho e área concluída (abre o painel). A área
  // concluída mora na URL (M-12): abrir um item da lista e voltar, ou recarregar, a restaura.
  const [formaArea, setFormaArea] = useState<FormaArea | null>(null);
  const [avisoSimplificacao, setAvisoSimplificacao] = useState<AreaSimplificada | null>(null);
  const area = useMemo(() => decodificarArea(busca.area), [busca.area]);
  const botaoSelecionarArea = useRef<HTMLButtonElement>(null);
  const devolverFocoAoBotao = useRef(false);
  // Enquanto se desenha, cliques no mapa são do desenho; com a área pronta, clicar numa árvore
  // abre o painel dela e mantém a área.
  const desenhando = useRef(false);
  const areaAtiva = useRef(false);
  // Áreas verdes: carregadas na primeira vez que a camada é ligada; a feição clicada abre o painel.
  const [estadoAreasVerdes, setEstadoAreasVerdes] = useState<"inicial" | "pronto" | "erro">(
    "inicial",
  );
  const areasVerdesIniciadas = useRef(false);
  const [fonteAreasVerdes, setFonteAreasVerdes] = useState<SituacaoFonteAreasVerdes | null>(null);
  const [areaVerde, setAreaVerde] = useState<AreaVerdeSelecionada | null>(null);
  // Arborização do entorno (Censo 2022): carregada na primeira vez que a camada é ligada.
  const [estadoArborizacao, setEstadoArborizacao] = useState<"inicial" | "pronto" | "erro">(
    "inicial",
  );
  const [proveniencia, setProveniencia] = useState<ProvenienciaIndicador | null>(null);
  // Bairro clicado na camada do Censo: abre o painel com o dado e a proveniência (M-18).
  const [bairroCenso, setBairroCenso] = useState<DicaArborizacao | null>(null);
  const arborizacaoIniciada = useRef(false);
  const [dica, setDica] = useState<{ x: number; y: number; texto: string } | null>(null);
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);

  const base: TipoBase = busca.base ?? "ruas";
  const modoCor: ModoCor = busca.cor === "origem" ? "origem" : "condicao";
  const mostrarArvores = busca.arvores !== "0";
  const mostrarOcorrencias = podeOcorrencias && busca.ocorrencias !== "0";
  // Filtros fora do padrão nas camadas visíveis: mostrados no grupo "Filtros" recolhido (R2-06).
  const filtrosAtivos =
    (mostrarArvores
      ? [
          busca.condicao_aparente,
          busca.especie_estado,
          busca.sem_inspecao_dias,
          busca.localizacao_origem,
        ].filter(Boolean).length
      : 0) + (mostrarOcorrencias && busca.estado === "todas" ? 1 : 0);
  const mostrarBairros = busca.bairros !== "0";
  const mostrarAreasVerdes = podeMapa && busca.areas_verdes === "1";
  const mostrarArborizacao = podeMapa && busca.arborizacao_entorno === "1";
  const mostrarTarefas = podeTarefas && busca.tarefas === "1";
  const mostrarAlertas = podeAlertas && busca.alertas === "1";
  const filtrosArvores = {
    bairro: territorioAtivo.id,
    especie_estado: busca.especie_estado,
    localizacao_origem: busca.localizacao_origem,
    condicao_aparente: busca.condicao_aparente,
    sem_inspecao_dias: busca.sem_inspecao_dias ? String(busca.sem_inspecao_dias) : undefined,
  };
  const filtrosOcorrencias = { estado: busca.estado ?? "abertas", bairro: territorioAtivo.id };
  const filtrosTarefas = { bairro: territorioAtivo.id };
  const [tipoSelecao, idSelecao] = (busca.selecao ?? "").split(":") as [
    "arvore" | "ocorrencia" | "",
    string,
  ];

  useEffect(() => {
    destaqueAtual.current = busca.destaque;
  }, [busca.destaque]);
  useEffect(() => {
    desenhando.current = formaArea !== null;
  }, [formaArea]);
  useEffect(() => {
    areaAtiva.current = area !== null;
  }, [area]);

  const atualizarBusca = (parcial: Partial<BuscaMapa>) =>
    void navegar({ search: (s: BuscaMapa) => ({ ...s, ...parcial }), replace: true });

  // Nomes dos bairros: só os que cabem no polígono e não colidem (C-08).
  const atualizarRotulos = (m: MapaMapLibre) => {
    if (m.getZoom() < ZOOM_ROTULOS) {
      for (const r of rotulos.current) r.getElement().hidden = true;
      return;
    }
    const medidos = rotulos.current.map((r, i) => {
      const el = r.getElement();
      const limites = limitesRotulos.current[i];
      const p = m.project(r.getLngLat());
      let larguraBairro = Infinity;
      if (limites) {
        const oeste = m.project([limites[0], limites[1]]);
        const leste = m.project([limites[2], limites[1]]);
        larguraBairro = Math.abs(leste.x - oeste.x);
      }
      // Medido com o rótulo exibido, para ter largura real.
      el.hidden = false;
      return {
        id: String(i),
        x: p.x,
        y: p.y,
        largura: el.offsetWidth,
        altura: el.offsetHeight,
        larguraBairro,
      };
    });
    const visiveis = rotulosVisiveis(medidos);
    rotulos.current.forEach((r, i) => (r.getElement().hidden = !visiveis.has(String(i))));
  };

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

    // Arborização do entorno (Censo 2022): preenchimento por classe e hachura para bairros sem
    // dado, abaixo do contorno dos bairros e das demais camadas; desligada até o usuário pedir.
    registrarHachuraSemDado(m);
    m.addSource(FONTE_ARBORIZACAO, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer(
      {
        id: "arborizacao-entorno-preenchimento",
        type: "fill",
        source: FONTE_ARBORIZACAO,
        filter: FILTRO_COM_DADO,
        layout: { visibility: "none" },
        paint: { "fill-color": COR_POR_VALOR, "fill-opacity": OPACIDADE_ARBORIZACAO },
      },
      "bairros-contorno",
    );
    m.addLayer(
      {
        id: "arborizacao-entorno-sem-dado",
        type: "fill",
        source: FONTE_ARBORIZACAO,
        filter: FILTRO_SEM_DADO,
        layout: { visibility: "none" },
        paint: { "fill-pattern": IMAGEM_SEM_DADO, "fill-opacity": 0.7 },
      },
      "bairros-contorno",
    );
    for (const camada of ["arborizacao-entorno-preenchimento", "arborizacao-entorno-sem-dado"]) {
      m.on("mousemove", camada, (e: MapLayerMouseEvent) => {
        // Árvores e ocorrências sob o cursor têm a própria dica.
        const operacionais = CAMADAS_COM_CLIQUE.filter((id) => m.getLayer(id));
        if (
          desenhando.current ||
          (operacionais.length && m.queryRenderedFeatures(e.point, { layers: operacionais }).length)
        )
          return;
        const p = e.features?.[0]?.properties ?? {};
        const texto = textoDicaArborizacao(p as DicaArborizacao);
        setDica({ x: e.point.x, y: e.point.y, texto });
      });
      m.on("mouseleave", camada, () => setDica(null));
      m.on("click", camada, (e: MapLayerMouseEvent) => {
        if (desenhando.current || areaAtiva.current) return;
        // Árvores, ocorrências e áreas verdes por cima têm o próprio clique.
        const porCima = [...CAMADAS_COM_CLIQUE, "areas-verdes-preenchimento"].filter((id) =>
          m.getLayer(id),
        );
        if (porCima.length && m.queryRenderedFeatures(e.point, { layers: porCima }).length) return;
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setBairroCenso(p as DicaArborizacao);
        setAreaVerde(null);
        atualizarBusca({ selecao: undefined });
      });
    }

    // Áreas verdes: abaixo das árvores e dos alertas, desligadas até o usuário pedir.
    // Cor própria de cada tipo (ver CORES_AREA_VERDE), translúcida e com contorno.
    m.addSource("areas-verdes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer({
      id: "areas-verdes-preenchimento",
      type: "fill",
      source: "areas-verdes",
      layout: { visibility: "none" },
      paint: {
        "fill-color": COR_AREA_VERDE_POR_TIPO as never,
        "fill-opacity": [
          "match",
          ["get", "tipo"],
          "unidade_conservacao",
          OPACIDADE_AREA_VERDE_UC,
          OPACIDADE_AREA_VERDE,
        ],
      },
    });
    m.addLayer({
      id: "areas-verdes-contorno",
      type: "line",
      source: "areas-verdes",
      filter: ["!=", ["get", "tipo"], "unidade_conservacao"],
      layout: { visibility: "none", "line-join": "round" },
      paint: {
        "line-color": COR_AREA_VERDE_POR_TIPO as never,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 2],
        "line-opacity": 0.9,
      },
    });
    m.addLayer({
      id: "areas-verdes-contorno-uc",
      type: "line",
      source: "areas-verdes",
      filter: ["==", ["get", "tipo"], "unidade_conservacao"],
      layout: { visibility: "none", "line-join": "round" },
      paint: {
        "line-color": CORES_AREA_VERDE.unidade_conservacao!,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 2.5],
        "line-dasharray": [3, 2],
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
      layout: layoutGrupo("arvores") as never,
    });

    if (podeTarefas) {
      m.addSource("tarefas", {
        type: "vector",
        tiles: [urlTiles("tarefas", filtrosTarefas)],
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
        layout: layoutGrupo("ocorrencias") as never,
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
    // Realce do bairro buscado: máscara clara no exterior (abaixo das árvores, que
    // mantêm a cor) e contorno grosso neutro, abaixo do anel da seleção.
    adicionarRealce(m, "selecao", "arvores-pontos");
    // Área da seleção por área e seu rascunho, também abaixo do anel.
    adicionarCamadasArea(m, "selecao");

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
        if (desenhando.current) return;
        atualizarBusca({
          selecao: `${camada.startsWith("arvores") ? "arvore" : "ocorrencia"}:${p.id}`,
        });
      });
    }
    // Clique numa área verde: nome, tipo e fonte. Árvores e ocorrências têm prioridade.
    m.on("mouseenter", "areas-verdes-preenchimento", () => {
      if (!desenhando.current && !areaAtiva.current) m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "areas-verdes-preenchimento", () => (m.getCanvas().style.cursor = ""));
    m.on("click", "areas-verdes-preenchimento", (e: MapLayerMouseEvent) => {
      if (desenhando.current || areaAtiva.current) return;
      const operacionais = CAMADAS_COM_CLIQUE.filter((id) => m.getLayer(id));
      if (operacionais.length && m.queryRenderedFeatures(e.point, { layers: operacionais }).length)
        return;
      const p = e.features?.[0]?.properties;
      if (!p) return;
      setAreaVerde(p as unknown as AreaVerdeSelecionada);
      setBairroCenso(null);
      atualizarBusca({ selecao: undefined });
    });
    // Qualquer clique no mapa encerra o realce do bairro buscado (RF-MAPA-011).
    m.on("click", () => {
      if (destaqueAtual.current) atualizarBusca({ destaque: undefined });
    });
    // Coordenada sob o cursor (RF-MAPA-012).
    m.on("mousemove", (e) => setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    m.on("mouseout", () => setCursor(null));
    // Nomes dos bairros só quando há espaço para lê-los.
    m.on("zoomend", () => atualizarRotulos(m));
    m.on("moveend", () => atualizarRotulos(m));
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
    void mapaAlertas({ bairro: territorioAtivo.id }).then(({ data }) => {
      (mapa.current?.getSource("alertas") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
  }, [pronto, mostrarAlertas, territorioAtivo.id]);

  // Áreas verdes: busca única, na primeira vez que a camada é ligada (escopo do usuário).
  useEffect(() => {
    if (!pronto || !mostrarAreasVerdes || areasVerdesIniciadas.current) return;
    areasVerdesIniciadas.current = true;
    void areasVerdesListar({ precisao: 5 })
      .then(({ data }) => {
        (mapa.current?.getSource("areas-verdes") as GeoJSONSource | undefined)?.setData(
          data as Parameters<GeoJSONSource["setData"]>[0],
        );
        setFonteAreasVerdes(
          (data as { situacao_da_fonte?: SituacaoFonteAreasVerdes }).situacao_da_fonte ?? null,
        );
        setEstadoAreasVerdes("pronto");
      })
      .catch(() => setEstadoAreasVerdes("erro"));
  }, [pronto, mostrarAreasVerdes]);

  // Arborização do entorno: busca única, na primeira vez que a camada é ligada.
  useEffect(() => {
    if (!pronto || !mostrarArborizacao || arborizacaoIniciada.current) return;
    arborizacaoIniciada.current = true;
    void indicadoresArborizacaoEntornoGeojson({ precisao: 5 })
      .then(({ data }) => {
        const { proveniencia: prov, ...colecao } = data as unknown as {
          proveniencia: ProvenienciaIndicador | null;
        };
        (mapa.current?.getSource(FONTE_ARBORIZACAO) as GeoJSONSource | undefined)?.setData(
          colecao as unknown as Parameters<GeoJSONSource["setData"]>[0],
        );
        setProveniencia(prov);
        setEstadoArborizacao("pronto");
      })
      .catch(() => setEstadoArborizacao("erro"));
  }, [pronto, mostrarArborizacao]);

  // Desligar a camada ou selecionar uma árvore/ocorrência fecha o painel da área verde.
  if (areaVerde && (!mostrarAreasVerdes || tipoSelecao)) setAreaVerde(null);
  // O mesmo vale para o painel do bairro do Censo, que também cede a vez a uma área verde.
  if (bairroCenso && (!mostrarArborizacao || tipoSelecao || areaVerde)) setBairroCenso(null);

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
      setFeicoesBairros((feicoes ?? []) as unknown as FeicaoTerritorio[]);
      const comRotulo = (feicoes ?? []).filter((f) => f.properties.rotulo?.length === 2);
      limitesRotulos.current = comRotulo.map((f) =>
        limitesDaGeometria((f as unknown as FeicaoTerritorio).geometry),
      );
      rotulos.current = comRotulo.map((f) => {
        const el = document.createElement("div");
        el.className = "rotulo-bairro";
        el.textContent = f.properties.nome;
        el.setAttribute("aria-hidden", "true");
        el.hidden = m.getZoom() < ZOOM_ROTULOS;
        return new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(f.properties.rotulo as [number, number])
          .addTo(m);
      });
      atualizarRotulos(m);
    });
  }, [pronto]);

  // Realça o bairro buscado e o enquadra; sai ao limpar o parâmetro (próxima interação).
  const destaque = busca.destaque;
  const feicaoDestaque = destaque
    ? (feicoesBairros.find((f) => String(f.id) === destaque) ?? null)
    : null;
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    definirRealce(m, feicaoDestaque);
    const limites = feicaoDestaque && limitesDaGeometria(feicaoDestaque.geometry);
    if (limites) m.fitBounds(limites, { padding: 60, maxZoom: 16 });
  }, [pronto, feicaoDestaque]);

  const definirAreaNaUrl = (nova: PoligonoGeoJson | null) =>
    atualizarBusca({ area: nova ? codificarArea(nova) : undefined });
  // Polígono com mais vértices que o endereço comporta é simplificado, e a perda é avisada (M-19).
  const concluirArea = (concluida: PoligonoGeoJson) => {
    const simplificada = simplificarArea(concluida);
    definirAreaNaUrl(simplificada.area);
    setAvisoSimplificacao(simplificada.toleranciaM === null ? null : simplificada);
  };
  // Modo de desenho da área: ativo enquanto houver forma escolhida.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m || !formaArea) return;
    return iniciarDesenho(m, formaArea, {
      aoConcluir: (concluida) => {
        concluirArea(concluida);
        setFormaArea(null);
      },
      aoCancelar: () => setFormaArea(null),
    });
    // `definirAreaNaUrl` muda a cada render; o desenho só reinicia com a forma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, formaArea]);

  // A área desenhada fica visível, tracejada, enquanto o painel está aberto.
  useEffect(() => {
    const m = mapa.current;
    if (pronto && m) definirArea(m, area);
  }, [pronto, area]);

  // Ao sair da seleção por área, o foco volta ao botão que a ligou.
  useEffect(() => {
    if (formaArea || area || !devolverFocoAoBotao.current) return;
    devolverFocoAoBotao.current = false;
    botaoSelecionarArea.current?.focus();
  }, [formaArea, area]);

  const iniciarSelecaoPorArea = (forma: FormaArea) => {
    setAvisoSimplificacao(null);
    definirAreaNaUrl(null);
    setFormaArea(forma);
  };
  const fecharSelecaoPorArea = () => {
    setAvisoSimplificacao(null);
    devolverFocoAoBotao.current = true;
    definirAreaNaUrl(null);
    setFormaArea(null);
  };
  const usarAreaVisivel = () => {
    const limites = mapa.current?.getBounds();
    if (!limites) return;
    definirAreaNaUrl(
      poligonoDeLimites([
        limites.getWest(),
        limites.getSouth(),
        limites.getEast(),
        limites.getNorth(),
      ]),
    );
    setFormaArea(null);
  };

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

  // Escolher outro território no cabeçalho enquadra o bairro, como na busca; voltar a "todo o
  // escopo" limpa o realce e enquadra o escopo. A abertura da tela não mexe na câmera.
  const territorioAnterior = useRef(territorioAtivo.id);
  useEffect(() => {
    if (territorioAnterior.current === territorioAtivo.id) return;
    territorioAnterior.current = territorioAtivo.id;
    atualizarBusca({ destaque: territorioAtivo.id });
    if (!territorioAtivo.id && limites)
      mapa.current?.fitBounds(limites as [number, number, number, number], { padding: 40 });
    // `atualizarBusca` e `limites` mudam a cada render; só a escolha do território dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territorioAtivo.id]);

  // Filtros → URLs dos tiles.
  const chaveArvores = JSON.stringify(filtrosArvores);
  const chaveOcorrencias = JSON.stringify(filtrosOcorrencias);
  const chaveTarefas = JSON.stringify(filtrosTarefas);
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
  useEffect(() => {
    if (!pronto) return;
    (mapa.current?.getSource("tarefas") as VectorTileSource | undefined)?.setTiles([
      urlTiles("tarefas", JSON.parse(chaveTarefas)),
    ]);
  }, [pronto, chaveTarefas]);

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
    definir(CAMADAS_ARBORIZACAO, mostrarArborizacao);
    definir(["bairros-preenchimento", "bairros-contorno"], mostrarBairros);
    definir(
      ["areas-verdes-preenchimento", "areas-verdes-contorno", "areas-verdes-contorno-uc"],
      mostrarAreasVerdes,
    );
    for (const r of rotulos.current) r.getElement().style.display = mostrarBairros ? "" : "none";
  }, [
    pronto,
    mostrarArvores,
    mostrarOcorrencias,
    mostrarBairros,
    mostrarAreasVerdes,
    mostrarArborizacao,
    mostrarTarefas,
    mostrarAlertas,
  ]);

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

              <AreaRolavel className="flex flex-col gap-1 px-4 py-2">
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
                  {podeMapa && (
                    <>
                      <Camada
                        rotulo="Áreas verdes"
                        marcador={<AmostraAreaVerde tipo="parque" />}
                        ativa={mostrarAreasVerdes}
                        aoMudar={(v) => atualizarBusca({ areas_verdes: v ? "1" : undefined })}
                      />
                      {mostrarAreasVerdes && pronto && estadoAreasVerdes === "inicial" && (
                        <p role="status" className="text-xs text-texto-suave">
                          Carregando áreas verdes…
                        </p>
                      )}
                      {mostrarAreasVerdes && fonteAreasVerdes?.desatualizada && (
                        <p role="status" className="text-xs text-atencao">
                          Fonte desatualizada: última importação há{" "}
                          {plural(fonteAreasVerdes.dias ?? 0, "dia", "dias")} (limite de{" "}
                          {fonteAreasVerdes.limite_dias}). Os limites podem ter mudado.
                        </p>
                      )}
                      {mostrarAreasVerdes && estadoAreasVerdes === "erro" && (
                        <p role="alert" className="text-xs text-perigo">
                          Não foi possível carregar as áreas verdes.
                        </p>
                      )}
                    </>
                  )}
                </Grupo>

                {podeMapa && (
                  <Grupo titulo="Contexto (fontes externas)" aberto>
                    <Camada
                      rotulo="Arborização do entorno (Censo 2022)"
                      marcador={<AmostraArborizacao />}
                      ativa={mostrarArborizacao}
                      aoMudar={(v) => atualizarBusca({ arborizacao_entorno: v ? "1" : undefined })}
                    />
                    <p className="text-xs text-texto-suave">
                      Faces de quadra com árvore, por bairro. Fonte: IBGE, Censo 2022. Não mede copa
                      nem cobertura vegetal.
                    </p>
                    {mostrarArborizacao && pronto && estadoArborizacao === "inicial" && (
                      <p role="status" className="text-xs text-texto-suave">
                        Carregando arborização do entorno…
                      </p>
                    )}
                    {mostrarArborizacao && estadoArborizacao === "erro" && (
                      <p role="alert" className="text-xs text-perigo">
                        Não foi possível carregar a arborização do entorno.
                      </p>
                    )}
                  </Grupo>
                )}

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
                  </Grupo>
                )}

                {(mostrarArvores || mostrarOcorrencias) && (
                  <Grupo
                    titulo="Filtros"
                    resumo={filtrosAtivos > 0 ? `${plural(filtrosAtivos, "ativo")}` : undefined}
                  >
                    {mostrarArvores && (
                      <>
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
                              sem_inspecao_dias: e.target.value
                                ? Number(e.target.value)
                                : undefined,
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
                      </>
                    )}
                    {mostrarOcorrencias && (
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
                    )}
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
                    <div>
                      <p className="text-xs text-texto-suave">
                        Imagem de satélite não configurada: o provedor ainda está em definição pela
                        prefeitura.
                      </p>
                      <DetalhesTecnicos>
                        Decisão pendente DP-07 (provedor de mapas).
                      </DetalhesTecnicos>
                    </div>
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
                    {mostrarAreasVerdes &&
                      (info?.areas_verdes ?? []).map((a) => (
                        <p key={String(a.tipo)}>
                          {ROTULOS_TIPO_AREA_VERDE[
                            a.tipo as keyof typeof ROTULOS_TIPO_AREA_VERDE
                          ] ?? String(a.tipo)}
                          : {(a.fontes as string[]).join(", ")}
                          {(a.licencas as string[]).length
                            ? ` · ${(a.licencas as string[]).join("; ")}`
                            : " · licença não informada"}{" "}
                          · ingerido em {formatarDataHora(String(a.ingerido_em))}
                          {a.data_referencia_mais_antiga
                            ? ` · dados de ${anoDaData(String(a.data_referencia_mais_antiga))}`
                            : " · data dos dados não informada"}
                        </p>
                      ))}
                    {mostrarArborizacao && proveniencia && (
                      <p>
                        {proveniencia.nome}: {proveniencia.fonte}
                        {proveniencia.licenca ? ` · ${proveniencia.licenca}` : ""} · ingerido em{" "}
                        {formatarDataHora(proveniencia.ingerido_em)}
                        {proveniencia.data_referencia
                          ? ` · dados de ${anoDaData(proveniencia.data_referencia)}`
                          : " · data dos dados não informada"}
                      </p>
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
              </AreaRolavel>

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
            recolhidaPorPadrao={painel}
            areasVerdes={mostrarAreasVerdes}
            arborizacao={mostrarArborizacao}
            definicaoArborizacao={proveniencia?.definicao ?? DEFINICAO_ARBORIZACAO}
          />
        </div>

        {/* Ferramentas do mapa, ao lado do painel de camadas. */}
        <div className="pointer-events-none absolute top-3 left-[21.75rem] z-10 flex max-w-[calc(100%-44rem)] min-w-64 flex-col items-start gap-2">
          <BarraSelecaoArea
            forma={formaArea}
            ativoPainel={area !== null}
            botao={botaoSelecionarArea}
            aoAlternar={() =>
              formaArea || area ? fecharSelecaoPorArea() : iniciarSelecaoPorArea("retangulo")
            }
            aoEscolherForma={iniciarSelecaoPorArea}
            aoUsarAreaVisivel={usarAreaVisivel}
          />
          {avisoSimplificacao && area && (
            <div
              role="status"
              className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-atencao bg-superficie px-3 py-1.5 text-sm shadow"
            >
              <span>
                A área tinha {avisoSimplificacao.verticesAntes.toLocaleString("pt-BR")} vértices e
                foi simplificada para {avisoSimplificacao.verticesDepois.toLocaleString("pt-BR")}{" "}
                (tolerância de até {avisoSimplificacao.toleranciaM} m) para caber no endereço da
                página. Pequenos detalhes do contorno se perderam.
              </span>
              <button
                className="rounded-full p-0.5 hover:bg-fundo"
                aria-label="Dispensar aviso"
                onClick={() => setAvisoSimplificacao(null)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )}
          {feicaoDestaque && (
            <div
              role="status"
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-marca bg-superficie px-3 py-1 text-sm shadow"
            >
              Bairro em destaque: <strong>{feicaoDestaque.properties.nome}</strong>
              <button
                className="rounded-full p-0.5 hover:bg-fundo"
                aria-label="Limpar destaque do bairro"
                onClick={() => atualizarBusca({ destaque: undefined })}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>
        {cursor && (
          <div
            className="pointer-events-none absolute right-14 bottom-2 z-10 rounded bg-superficie/90 px-2 py-0.5 font-mono text-[11px] text-texto-suave shadow-sm"
            aria-hidden
          >
            {formatarPontoGeografico(cursor.lat, cursor.lon)}
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
        {area && !tipoSelecao && (
          <PainelSelecaoArea
            area={area}
            filtros={{
              ...(Object.fromEntries(Object.entries(filtrosArvores).filter(([, v]) => v)) as Record<
                string,
                string
              >),
              estado: filtrosOcorrencias.estado,
            }}
            camadas={[
              ...(mostrarArvores ? (["arvores"] as const) : []),
              ...(mostrarOcorrencias ? (["ocorrencias"] as const) : []),
            ]}
            aoFechar={fecharSelecaoPorArea}
          />
        )}
        {areaVerde && !area && !tipoSelecao && (
          <PainelAreaVerde area={areaVerde} aoFechar={() => setAreaVerde(null)} />
        )}
        {bairroCenso && !area && !tipoSelecao && !areaVerde && (
          <PainelArborizacaoEntorno
            bairro={bairroCenso}
            proveniencia={proveniencia}
            aoFechar={() => setBairroCenso(null)}
          />
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
  resumo,
  children,
}: {
  titulo: string;
  aberto?: boolean;
  /** Texto curto ao lado do título, visível com o grupo recolhido (ex.: "2 ativos"). */
  resumo?: string;
  children: ReactNode;
}) {
  return (
    <details open={aberto} className="group border-b border-borda py-2 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold tracking-wide text-texto-suave uppercase">
        <span className="flex items-center gap-2">
          {titulo}
          {resumo && (
            <span className="rounded-full bg-marca/15 px-2 py-0.5 text-[11px] font-medium tracking-normal text-marca normal-case">
              {resumo}
            </span>
          )}
        </span>
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
      {contagem && (
        <span className="ml-auto text-xs text-texto-suave">
          {contagem}
          {!ativa && " · oculta no mapa"}
        </span>
      )}
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

/** Amostra do ícone de grupo: miolo neutro e anel na cor da pior condição. */
function AnelGrupo() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 rounded-full border-[3px] bg-white"
      style={{ borderColor: CORES_CONDICAO.ruim }}
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

/** Amostra da rampa da arborização do entorno: as cinco classes lado a lado, do claro ao escuro. */
function AmostraArborizacao() {
  return (
    <span aria-hidden className="inline-flex h-3 w-4 overflow-hidden rounded-[2px]">
      {CORES_ARBORIZACAO.map((c) => (
        <span key={c} className="h-full flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

interface DicaArborizacao {
  nome?: string;
  valor?: number | null;
  faces_com_arvore?: number | null;
  faces?: number | null;
}

/** Dica do bairro sob o cursor: percentual e base, ou "sem dado" (nunca zero). */
function textoDicaArborizacao(p: DicaArborizacao): string {
  if (p.valor === null || p.valor === undefined)
    return `${p.nome ?? "Bairro"} · sem dado do Censo 2022`;
  const pct = Number(p.valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const base =
    p.faces && p.faces_com_arvore !== null && p.faces_com_arvore !== undefined
      ? ` (${p.faces_com_arvore.toLocaleString("pt-BR")} de ${p.faces.toLocaleString("pt-BR")} faces)`
      : "";
  return `${p.nome} · ${pct}% das faces com árvore${base}`;
}

/** Amostra de área verde: preenchimento translúcido e contorno (tracejado nas unidades). */
function AmostraAreaVerde({ tipo }: { tipo: string }) {
  const cor = CORES_AREA_VERDE[tipo] ?? CORES_AREA_VERDE.parque!;
  return (
    <span
      aria-hidden
      data-testid={`amostra-area-verde-${tipo}`}
      className="inline-block size-3.5 shrink-0 rounded-[2px] border-2"
      style={{
        borderColor: cor,
        borderStyle: tipo === "unidade_conservacao" ? "dashed" : "solid",
        background: `${cor}38`,
      }}
    />
  );
}

/** Ano de uma data ISO ("2023-01-01"), sem passar por fuso horário. */
const anoDaData = (iso: string) => iso.slice(0, 4);

/** Legenda só das camadas ativas (RF-MAPA-007). */
function Legenda({
  modoCor,
  arvores,
  ocorrencias,
  tarefas,
  alertas,
  recolhidaPorPadrao,
  areasVerdes,
  arborizacao,
  definicaoArborizacao,
}: {
  modoCor: ModoCor;
  arvores: boolean;
  ocorrencias: boolean;
  tarefas: boolean;
  alertas: boolean;
  /** Com o painel de camadas aberto, a legenda começa recolhida para não cobrir o mapa (C-09). */
  recolhidaPorPadrao: boolean;
  areasVerdes: boolean;
  arborizacao: boolean;
  definicaoArborizacao: string;
}) {
  const [aberta, setAberta] = useState(!recolhidaPorPadrao);
  if (!arvores && !ocorrencias && !tarefas && !alertas && !areasVerdes && !arborizacao) return null;
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
              <p className="mt-1.5 flex items-center gap-1.5">
                <AnelGrupo /> Grupo: o anel mostra a pior condição
              </p>
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
          {areasVerdes && (
            <div>
              <p className="mb-1 text-texto-suave">Áreas verdes — tipo</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.keys(CORES_AREA_VERDE).map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <AmostraAreaVerde tipo={t} />{" "}
                    {ROTULOS_TIPO_AREA_VERDE[t as keyof typeof ROTULOS_TIPO_AREA_VERDE]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {arborizacao && (
            <div>
              <p className="mb-1 text-texto-suave">
                Arborização do entorno — faces de quadra com árvore
              </p>
              <ul className="flex flex-col gap-1">
                {ROTULOS_CLASSES_ARBORIZACAO.map((r, i) => (
                  <li key={r} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-5 shrink-0 rounded-[2px] border border-black/20"
                      style={{ background: CORES_ARBORIZACAO[i] }}
                    />{" "}
                    {r}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    data-testid="amostra-sem-dado"
                    className="inline-block h-3 w-5 shrink-0 rounded-[2px] border border-black/20"
                    style={{
                      background: `repeating-linear-gradient(135deg, ${COR_SEM_DADO} 0 2px, #ffffff 2px 5px)`,
                    }}
                  />{" "}
                  Sem dado
                </li>
              </ul>
              <p className="mt-1.5 text-texto-suave">Fonte: IBGE, Censo 2022.</p>
              <p className="mt-0.5 max-w-64 text-texto-suave">{definicaoArborizacao}</p>
            </div>
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

/** Nome, tipo e fonte da área verde clicada, com a proveniência do dado (RN-PROV-003). */
function PainelAreaVerde({ area, aoFechar }: { area: AreaVerdeSelecionada; aoFechar: () => void }) {
  const tipo = ROTULOS_TIPO_AREA_VERDE[area.tipo as keyof typeof ROTULOS_TIPO_AREA_VERDE];
  return (
    <aside
      aria-label="Detalhes da área verde"
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
        <p className="text-lg font-semibold">{area.nome}</p>
        {area.nome_popular && (
          <p className="text-texto-suave">Conhecida como {area.nome_popular}</p>
        )}
        <p className="mt-1 flex items-center gap-1.5">
          <AmostraAreaVerde tipo={area.tipo} /> {tipo ?? area.tipo}
        </p>
      </div>
      {area.ato_legal && <p>Ato legal: {area.ato_legal}</p>}
      {area.area_m2 ? (
        <p>Área informada: {Math.round(area.area_m2).toLocaleString("pt-BR")} m²</p>
      ) : null}
      <div className="border-t border-borda pt-2 text-xs text-texto-suave">
        <p>
          <span className="font-medium">Fonte:</span> {area.fonte}
        </p>
        {(area.orgao_gestor || area.esfera) && (
          <p>Órgão: {[area.orgao_gestor, area.esfera].filter(Boolean).join(" · ")}</p>
        )}
        {area.licenca && <p>{area.licenca}</p>}
        <p>
          {area.data_referencia
            ? `Dados de ${anoDaData(area.data_referencia)}`
            : "Data dos dados não informada"}
          {area.ingerido_em ? ` · ingerido em ${formatarDataHora(area.ingerido_em)}` : ""}
        </p>
      </div>
    </aside>
  );
}

/**
 * Bairro clicado na camada "Arborização do entorno": o percentual e a base (faces com árvore e
 * total de faces) e, na proveniência, a definição, o método, a fonte, a licença, a data de
 * referência e a ingestão (RN-PROV-003). Bairro sem dado diz isso, nunca "0%". O cruzamento com o
 * inventário fica de fora até as fórmulas da DP-14.
 */
function PainelArborizacaoEntorno({
  bairro,
  proveniencia,
  aoFechar,
}: {
  bairro: DicaArborizacao;
  proveniencia: ProvenienciaIndicador | null;
  aoFechar: () => void;
}) {
  const temDado = bairro.valor !== null && bairro.valor !== undefined;
  const pct = temDado
    ? Number(bairro.valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
    : null;
  return (
    <aside
      aria-label="Arborização do entorno do bairro"
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
        <p className="text-lg font-semibold">{bairro.nome ?? "Bairro"}</p>
        <p className="text-xs text-texto-suave">
          {proveniencia?.nome ?? "Arborização do entorno (Censo 2022)"}
        </p>
      </div>
      {temDado ? (
        <div>
          <p className="text-2xl font-semibold tabular-nums">{pct}%</p>
          <p>das faces de quadra têm árvore no entorno.</p>
          {bairro.faces ? (
            <p className="text-texto-suave">
              {(bairro.faces_com_arvore ?? 0).toLocaleString("pt-BR")} de{" "}
              {bairro.faces.toLocaleString("pt-BR")} faces
            </p>
          ) : null}
        </div>
      ) : (
        <p>
          Sem dado do Censo 2022 para este bairro. Isso não significa que não haja árvores no
          entorno.
        </p>
      )}
      <div className="flex flex-col gap-1 border-t border-borda pt-2 text-xs text-texto-suave">
        <p>
          <span className="font-medium">Definição:</span>{" "}
          {proveniencia?.definicao ?? DEFINICAO_ARBORIZACAO}
        </p>
        {proveniencia?.metodo && (
          <p>
            <span className="font-medium">Método:</span> {proveniencia.metodo}
          </p>
        )}
        {proveniencia && (
          <>
            <p>
              <span className="font-medium">Fonte:</span>{" "}
              {proveniencia.fonte_url ? (
                <a
                  href={proveniencia.fonte_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-marca-escura underline"
                >
                  {proveniencia.fonte}
                </a>
              ) : (
                proveniencia.fonte
              )}
            </p>
            <p>
              <span className="font-medium">Licença:</span>{" "}
              {proveniencia.licenca || "não informada pela fonte"}
            </p>
            <p>
              <span className="font-medium">Data de referência:</span>{" "}
              {proveniencia.data_referencia
                ? formatarData(proveniencia.data_referencia)
                : "não informada"}
              {proveniencia.ingerido_em
                ? ` · ingerido em ${formatarDataHora(proveniencia.ingerido_em)}`
                : ""}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

/** Primeira foto disponível, para reconhecer a árvore em campo. */
function FotoDaArvore({ id }: { id: string }) {
  const consulta = useEvidenciasListar({ arvore: id });
  const foto = consulta.data?.data.find((e) => e.eh_imagem && e.url);
  if (consulta.isPending) return null;
  // Sem foto: placeholder de folha, para não sugerir uma imagem real que não existe (C-10).
  if (!foto?.url)
    return (
      <div
        role="img"
        aria-label="Árvore sem foto"
        className="-mx-4 -mt-4 flex aspect-[16/9] w-[calc(100%+2rem)] max-w-none flex-col items-center justify-center gap-1 rounded-t-xl bg-marca-clara text-marca"
      >
        <Leaf className="size-8" aria-hidden />
        <span className="text-xs">Sem foto</span>
      </div>
    );
  // A legenda diz de onde vem a imagem: autoria e data do envio, não só a figura.
  const data = foto.capturada_em ?? foto.criado_em;
  return (
    <figure className="-mx-4 -mt-4 w-[calc(100%+2rem)] max-w-none">
      <div className="relative">
        <img
          src={foto.url}
          alt={foto.descricao || `Foto de ${foto.nome_original}`}
          className="aspect-[16/9] w-full rounded-t-xl object-cover"
        />
        {foto.ilustrativa && <SeloIlustracao className="absolute top-2 left-2 shadow-sm" />}
      </div>
      <figcaption className="px-4 pt-1 text-xs text-texto-suave">
        Foto enviada por {foto.enviada_por_nome || "autor não informado"} em {formatarData(data)}
      </figcaption>
    </figure>
  );
}

/** Condição aparente validada com o mesmo ponto colorido do mapa; sem avaliação, selo cinza. */
function SeloCondicaoMapa({ condicao, em }: { condicao?: string | null; em?: string | null }) {
  const chave = (condicao || "nao_avaliada") as CondicaoAparenteEnum;
  const avaliada = chave !== "nao_avaliada";
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <Bolinha cor={CORES_CONDICAO[chave] ?? CORES_CONDICAO.nao_avaliada} />
      <span
        className={avaliada ? "font-medium" : "rounded bg-neutro-clara px-1.5 text-texto-suave"}
      >
        {avaliada ? ROTULOS_CONDICAO[chave] : "Não avaliada"}
      </span>
      {avaliada && em && (
        <span className="text-xs text-texto-suave">validada em {formatarData(em)}</span>
      )}
      {!avaliada && <span className="text-xs text-texto-suave">Sem avaliação registrada.</span>}
    </p>
  );
}

function ResumoArvore({ id }: { id: string }) {
  const consulta = useArvoresObter(id);
  const podeOcorrencia = usePermissao("ocorrencias.editar");
  const podeTarefa = usePermissao("tarefas.editar");
  const [ocorrencia, setOcorrencia] = useState(false);
  const [criandoTarefa, setCriandoTarefa] = useState(false);
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
        {a.em_area_verde && (
          <p className="mt-1">
            Em área verde: <strong>{a.em_area_verde.nome}</strong>
          </p>
        )}
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
        <SeloCondicaoMapa condicao={a.condicao_aparente} em={a.condicao_aparente_em} />
      </div>
      <p>Ocorrências abertas: {a.ocorrencias_abertas ?? 0}</p>
      <Botao asChild>
        <Link to="/inventario/arvores/$id" params={{ id: a.id }}>
          Abrir cadastro completo
        </Link>
      </Botao>
      {(podeOcorrencia || podeTarefa) && a.situacao === "ativa" && a.localizacao && (
        <div className="flex flex-wrap gap-2">
          {podeOcorrencia && (
            <Botao variante="secundario" tamanho="pequeno" onClick={() => setOcorrencia(true)}>
              <TriangleAlert aria-hidden /> Registrar ocorrência
            </Botao>
          )}
          {podeTarefa && (
            <Botao variante="secundario" tamanho="pequeno" onClick={() => setCriandoTarefa(true)}>
              <ClipboardList aria-hidden /> Pedir inspeção
            </Botao>
          )}
        </div>
      )}
      {criandoTarefa && (
        <CriarTarefasDialogo
          alvo={{ tipo: "arvore", id: a.id, codigo: a.codigo }}
          aoFechar={() => setCriandoTarefa(false)}
        />
      )}
      {ocorrencia && (
        <NovaOcorrenciaDialogo
          arvore={{ id: a.id, codigo: a.codigo }}
          aoFechar={() => setOcorrencia(false)}
        />
      )}
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
