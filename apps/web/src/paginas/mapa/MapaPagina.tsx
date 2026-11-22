import {
  ErroApi,
  areasVerdesListar,
  deteccoesPontosPlantio,
  indicadoresArborizacaoEntornoGeojson,
  indicadoresPopulacaoGeojson,
  mapaAlertas,
  mapaSupressaoAnual,
  territoriosGeojson,
  useArvoresConfirmar,
  useArvoresObter,
  useEvidenciasListar,
  useMapaCamadas,
  useMapaSerieTemporal,
  useMapaSituacaoNaData,
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
  ROTULOS_SUBTIPO_PRACA,
  ROTULOS_TIPO_AREA_VERDE,
  ROTULOS_TIPO_TERRITORIO,
} from "@itree/domain";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  GeoJSONSource,
  Map as MapaMapLibre,
  MapLayerMouseEvent,
  Marker,
  VectorTileSource,
} from "maplibre-gl";
import {
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Layers,
  Leaf,
  List,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePermissao, useUsuario } from "../../acesso/ContextoUsuario";
import {
  SeloEspecie,
  SeloIlustracao,
  SeloEstadoOcorrencia,
  SeloLocalizacao,
  SeloPrioridade,
  nomeEspecie,
} from "../../componentes/selos";
import { SelosDeteccao } from "../../componentes/selosDeteccao";
import { invalidarCaminhos } from "../../util/cache";
import { config } from "../../config";
import { useTerritorioAtivo } from "../../layout/territorio";
import { CamadasReferencia } from "../../mapa/CamadasReferencia";
import { Mapa } from "../../mapa/Mapa";
import { BotaoLinhaDoTempo, ControleTempo } from "../../mapa/ControleTempo";
import { CortinaComparacao } from "../../mapa/CortinaComparacao";
import { mesAtual, textoDoPeriodo, type SerieTemporal } from "../../mapa/tempo";
import { paddingDoMapa } from "../../mapa/enquadramento";
import { cn } from "../../util/cn";
import { AreaRolavel } from "../../ui/rolagem";
import { useCelular } from "../../util/useMediaQuery";
import { maplibregl } from "../../mapa/maplibre";
import {
  adicionarRealce,
  definirRealce,
  limitesDaGeometria,
  type FeicaoTerritorio,
} from "../../mapa/realce";
import { rotuloDoBairroVisivel, rotulosVisiveis } from "../../mapa/rotulos";
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
  CAMADAS_POPULACAO,
  FONTE_POPULACAO,
  OPACIDADE_POPULACAO,
  corPorQuebras,
  filtroComDado,
  filtroSemDado,
  type IndicadorPopulacao,
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
import {
  AmostraPopulacao,
  ControlePopulacao,
  LegendaPopulacao,
  PainelPopulacaoBairro,
} from "./CamadaPopulacao";
import {
  PROPRIEDADE,
  textoDicaPopulacao,
  type BairroPopulacao,
  type DadosPopulacao,
} from "../../mapa/populacao";
import { urlApi } from "../../mapa/url";
import type { TipoBase } from "../../mapa/estilo";
import { baseEfetiva, lembrarBase, lerBaseLembrada } from "../../mapa/baseLembrada";
import { HALO_BAIRRO, aplicarLegibilidade } from "../../mapa/legibilidade";
import {
  COR_ALERTA,
  COR_NAO_CONFIRMADA,
  COR_PONTO_PLANTIO,
  COR_ILUMINACAO,
  COR_SELECAO,
  COR_TAREFA,
  COR_TAREFA_ATRASADA,
  CORES_AREA_VERDE,
  CORES_SUPRESSAO_ANUAL,
  CORES_CONDICAO,
  CORES_ORIGEM,
  CORES_PRIORIDADE,
  COR_AREA_VERDE_POR_TIPO,
  ID_OCORRENCIA,
  OPACIDADE_AREA_VERDE,
  OPACIDADE_AREA_VERDE_UC,
  OPACIDADE_HACHURA_AREA_VERDE,
  HACHURA_AREA_VERDE,
  OPACIDADE_SUPRESSAO_ANUAL,
  ID_ILUMINACAO,
  ID_PONTO_PLANTIO,
  ZOOM_AGRUPA_BAIRRO,
  ZOOM_ILUMINACAO,
  adicionarAneisNaoConfirmadas,
  CAMADAS_ANEL_NAO_CONFIRMADA,
  filtroArvoreIndividual,
  filtroGrupoDeArvores,
  aoFaltarImagem,
  corDaSupressao,
  layoutGrupo,
  pinturaArvores,
  registrarIcones,
  type ModoCor,
} from "../../mapa/simbologia";
import { ControleIlhaCalor, LegendaIlhaCalor } from "../../mapa/ControleIlhaCalor";
import { CAMADA_ILHA_CALOR, OPACIDADE_ILHA_CALOR, adicionarIlhaCalor } from "../../mapa/ilhaCalor";
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
import {
  ATRIBUICAO_ILUMINACAO,
  capitalizar,
  listaDeLampadas,
  textoDoPoste,
  type PontoIluminacaoTile,
} from "../../mapa/iluminacao";
import { BarraSelecaoArea, PainelSelecaoArea } from "./SelecaoArea";
import { NovaOcorrenciaDialogo } from "../ocorrencias/NovaOcorrenciaDialogo";
import { CriarTarefasDialogo } from "../tarefas/CriarTarefasDialogo";
import { PainelDetalhe } from "../../mapa/PainelDetalhe";

export interface BuscaMapa {
  lon?: number;
  lat?: number;
  zoom?: number;
  base?: TipoBase;
  camada?: "arvores" | "ocorrencias";
  arvores?: "0";
  ocorrencias?: "0";
  /** Pontos de plantio possível (detecção automática); desligada por padrão. */
  plantio?: "1";
  bairros?: "0";
  areas_verdes?: "1";
  /** Subtipo das praças na camada de áreas verdes (areninha, calçadão...); vazio mostra todos. */
  subtipo_praca?: "praca" | "areninha" | "calcadao" | "rotatoria" | "sem_denominacao";
  /** Na camada de áreas verdes, só as praças com termo de adoção (mapa 622 do Fortaleza em Mapas). */
  adotadas?: "1";
  /** Camada coroplética "Arborização do entorno (Censo 2022)"; desligada por padrão. */
  arborizacao_entorno?: "1";
  /** Camada "População e renda por bairro" e o indicador escolhido; ausente = desligada. */
  populacao?: IndicadorPopulacao;
  tarefas?: "1";
  alertas?: "1";
  /** Camada histórica "Supressão anual (PRODES Caatinga)"; desligada por padrão. */
  supressao_anual?: "1";
  /** Pontos de iluminação pública (SEINF); desligada por padrão, visível a partir do zoom 15. */
  iluminacao?: "1";
  /** Raster "Ilha de calor (UrbVerde)", por WMS; desligada por padrão. */
  ilha_calor?: "1";
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
  /** Linha do tempo (AAAA-MM): situação ao fim do mês; ausente = o mapa mostra o presente. */
  ate?: string;
  /** Linha do tempo no modo intervalo: do começo deste mês ao fim de `ate`. */
  desde?: string;
  /** Cortina "antes e depois": a data escolhida de um lado e hoje do outro. */
  comparar?: "1";
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

/** Proveniência e escala da camada "Supressão anual (PRODES Caatinga)", como a API as devolve. */
interface ProvenienciaSupressao {
  nome: string;
  fonte: string;
  fonte_url?: string;
  licenca?: string;
  ingerido_em?: string | null;
  ano_inicial: number | null;
  ano_final: number | null;
  quantidade: number;
  escala: string;
}

/** Texto curto da definição, enquanto a camada ainda não trouxe a proveniência da API. */
const DEFINICAO_ARBORIZACAO =
  "Percentual das faces de quadra do bairro em que o Censo 2022 registrou ao menos uma árvore no entorno dos domicílios. Não mede copa nem cobertura vegetal.";

function urlTiles(
  camada: "arvores" | "ocorrencias" | "tarefas" | "iluminacao",
  filtros: Record<string, string | undefined>,
) {
  const qs = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v) as [string, string][],
  ).toString();
  return urlApi(`/api/v1/mapa/tiles/${camada}/{z}/{x}/{y}${qs ? `?${qs}` : ""}`);
}

const FONTE_SUPRESSAO = "supressao-anual";

/** Camadas operacionais com clique próprio: o clique nelas não abre a área verde por baixo. */
const CAMADAS_COM_CLIQUE = [
  "arvores-grupos",
  "arvores-pontos",
  "ocorrencias-grupos",
  "ocorrencias-pontos",
  "iluminacao-pontos",
];
/** Camadas operacionais que ficam por cima dos pontos de iluminação e levam o clique. */
const CAMADAS_SOBRE_ILUMINACAO = CAMADAS_COM_CLIQUE.filter((id) => id !== "iluminacao-pontos");

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
  subtipo?: string;
  subtipo_rotulo?: string;
  orgao_gestor?: string;
  esfera?: string;
  /** Código e esfera no Cadastro Nacional de Unidades de Conservação (MMA), quando conferidos. */
  codigo_cnuc?: string;
  esfera_cnuc?: string;
  ato_legal?: string;
  area_m2?: number | null;
  /**
   * Adoção de praça (mapa 622): só a existência, a quantidade, a categoria do adotante (sem nome) e
   * o ano de referência do mapa. O MapLibre devolve listas como texto JSON.
   */
  adotada?: boolean | string;
  adocoes?: number;
  adocao_tipos?: string[] | string;
  adocao_ano_referencia?: number | null;
  /** Só nas unidades de conservação: feições da mesma unidade e a área somada delas. */
  feicoes_da_unidade?: number | null;
  area_total_da_unidade_m2?: number | null;
  fonte: string;
  licenca?: string;
  data_referencia?: string | null;
  ingerido_em?: string;
}

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
  // Mapa principal como estado: a cortina de comparação acompanha a câmera dele.
  const [mapaPrincipal, setMapaPrincipal] = useState<MapaMapLibre | null>(null);
  useTituloDocumento("Mapa");
  // No celular o painel é uma folha inferior e começa recolhida: o mapa ocupa a tela.
  const celular = useCelular();
  const [painel, setPainel] = useState(!celular);
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
  // O enquadramento (`fitBounds`) lê o estado atual do painel sem refazer-se a cada abrir/fechar.
  const painelAbertoRef = useRef(painel);
  useEffect(() => {
    painelAbertoRef.current = painel;
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
  const filtroDasUnidadesAlterado = useRef(false);
  const [fonteAreasVerdes, setFonteAreasVerdes] = useState<SituacaoFonteAreasVerdes | null>(null);
  const [areaVerde, setAreaVerde] = useState<AreaVerdeSelecionada | null>(null);
  const [poste, setPoste] = useState<PontoIluminacaoTile | null>(null);
  // Arborização do entorno (Censo 2022): carregada na primeira vez que a camada é ligada.
  const [estadoArborizacao, setEstadoArborizacao] = useState<"inicial" | "pronto" | "erro">(
    "inicial",
  );
  const [proveniencia, setProveniencia] = useState<ProvenienciaIndicador | null>(null);
  // Bairro clicado na camada do Censo: abre o painel com o dado e a proveniência (M-18).
  const [bairroCenso, setBairroCenso] = useState<DicaArborizacao | null>(null);
  const arborizacaoIniciada = useRef(false);
  // População e renda por bairro: carregada na primeira vez que a camada é ligada.
  const [estadoPopulacao, setEstadoPopulacao] = useState<"inicial" | "pronto" | "erro">("inicial");
  const [dadosPopulacao, setDadosPopulacao] = useState<DadosPopulacao | null>(null);
  const [bairroPopulacao, setBairroPopulacao] = useState<BairroPopulacao | null>(null);
  const populacaoIniciada = useRef(false);
  const escolhidoPopulacao = useRef<IndicadorPopulacao | undefined>(undefined);
  // Supressão anual do PRODES: carregada na primeira vez que a camada é ligada.
  const [estadoSupressao, setEstadoSupressao] = useState<"inicial" | "pronto" | "erro">("inicial");
  const [provSupressao, setProvSupressao] = useState<ProvenienciaSupressao | null>(null);
  const supressaoIniciada = useRef(false);
  const [dica, setDica] = useState<{ x: number; y: number; texto: string } | null>(null);
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);

  const usuario = useUsuario();
  const [baseLembrada, setBaseLembrada] = useState(() => lerBaseLembrada(usuario.id));
  // A URL vale mais que a preferência lembrada; sem satélite configurado, sempre ruas.
  const base: TipoBase = baseEfetiva(busca.base, baseLembrada, !!config.mapaSatelite);
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
  const mostrarPopulacao = podeMapa && busca.populacao !== undefined;

  const mostrarIluminacao = podeMapa && busca.iluminacao === "1";
  const mostrarIlhaCalor = podeMapa && busca.ilha_calor === "1";
  const [opacidadeIlhaCalor, setOpacidadeIlhaCalor] = useState(OPACIDADE_ILHA_CALOR);
  const aproximarIluminacao = (busca.zoom ?? 11) < ZOOM_ILUMINACAO;
  const mostrarTarefas = podeTarefas && busca.tarefas === "1";
  const podeDeteccao = usePermissao("deteccao.ler");
  const mostrarPlantio = podeDeteccao && busca.plantio === "1";
  const mostrarAlertas = podeAlertas && busca.alertas === "1";
  const mostrarSupressao = podeAlertas && busca.supressao_anual === "1";
  // Linha do tempo: com `ate`, árvores, ocorrências e alertas mostram a situação nesse mês.
  const tempoLigado = podeMapa && busca.ate !== undefined;
  const periodoTempo = tempoLigado ? { ate: busca.ate, desde: busca.desde } : {};
  const comparando = tempoLigado && busca.comparar === "1";
  const filtrosArvoresHoje = {
    bairro: territorioAtivo.id,
    especie_estado: busca.especie_estado,
    localizacao_origem: busca.localizacao_origem,
    condicao_aparente: busca.condicao_aparente,
    sem_inspecao_dias: busca.sem_inspecao_dias ? String(busca.sem_inspecao_dias) : undefined,
  };
  const filtrosOcorrenciasHoje = { estado: busca.estado ?? "abertas", bairro: territorioAtivo.id };
  const filtrosArvores = { ...periodoTempo, ...filtrosArvoresHoje };
  const filtrosOcorrencias = { ...periodoTempo, ...filtrosOcorrenciasHoje };
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

  const escolherBase = (b: TipoBase) => {
    lembrarBase(usuario.id, b);
    setBaseLembrada(b);
    atualizarBusca({ base: b });
  };
  // Base lembrada sem `base` na URL: a URL passa a refletir o que está na tela (link compartilhável).
  useEffect(() => {
    if (busca.base === undefined && base === "satelite") {
      void navegar({ search: (s: BuscaMapa) => ({ ...s, base: "satelite" }), replace: true });
    }
  }, [busca.base, base, navegar]);

  // Nomes dos bairros: só os que cabem no polígono e não colidem (C-08).
  const atualizarRotulos = (m: MapaMapLibre) => {
    if (!rotuloDoBairroVisivel(m.getZoom())) {
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
    setMapaPrincipal(m);
    registrarIcones(m);
    m.on("styleimagemissing", (e) => aoFaltarImagem(m, e.id));

    // Ilha de calor (UrbVerde, WMS): raster de contexto sob todos os dados, desligado por padrão.
    if (podeMapa) adicionarIlhaCalor(m);
    m.addSource("bairros", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "bairros-preenchimento",
      type: "fill",
      source: "bairros",
      paint: { "fill-color": "#2b8a3e", "fill-opacity": 0.05 },
    });
    // Halo escuro sob o contorno branco do bairro; só aparece sobre o satélite.
    m.addLayer({
      id: "bairros-halo",
      type: "line",
      source: "bairros",
      layout: { visibility: "none" },
      paint: {
        "line-color": HALO_BAIRRO.cor,
        "line-opacity": HALO_BAIRRO.opacidade,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          HALO_BAIRRO.larguras[0],
          15,
          HALO_BAIRRO.larguras[1],
        ],
      },
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
        setPoste(null);
        atualizarBusca({ selecao: undefined });
      });
    }

    // População e renda por bairro: mesma ordem de camadas da arborização do entorno; a cor e o
    // filtro seguem o indicador escolhido e as quebras (quantis) vindas da API.
    m.addSource(FONTE_POPULACAO, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer(
      {
        id: "populacao-preenchimento",
        type: "fill",
        source: FONTE_POPULACAO,
        filter: filtroComDado("densidade"),
        layout: { visibility: "none" },
        paint: { "fill-color": "#ece4f6", "fill-opacity": OPACIDADE_POPULACAO },
      },
      "bairros-contorno",
    );
    m.addLayer(
      {
        id: "populacao-sem-dado",
        type: "fill",
        source: FONTE_POPULACAO,
        filter: filtroSemDado("densidade"),
        layout: { visibility: "none" },
        paint: { "fill-pattern": IMAGEM_SEM_DADO, "fill-opacity": 0.7 },
      },
      "bairros-contorno",
    );
    for (const camada of CAMADAS_POPULACAO) {
      m.on("mousemove", camada, (e: MapLayerMouseEvent) => {
        const operacionais = CAMADAS_COM_CLIQUE.filter((id) => m.getLayer(id));
        if (
          desenhando.current ||
          (operacionais.length && m.queryRenderedFeatures(e.point, { layers: operacionais }).length)
        )
          return;
        const escolhido = escolhidoPopulacao.current ?? "densidade";
        const p = (e.features?.[0]?.properties ?? {}) as BairroPopulacao;
        setDica({ x: e.point.x, y: e.point.y, texto: textoDicaPopulacao(p, escolhido) });
      });
      m.on("mouseleave", camada, () => setDica(null));
      m.on("click", camada, (e: MapLayerMouseEvent) => {
        if (desenhando.current || areaAtiva.current) return;
        const porCima = [...CAMADAS_COM_CLIQUE, "areas-verdes-preenchimento"].filter((id) =>
          m.getLayer(id),
        );
        if (porCima.length && m.queryRenderedFeatures(e.point, { layers: porCima }).length) return;
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setBairroPopulacao(p as BairroPopulacao);
        setBairroCenso(null);
        setAreaVerde(null);
        setPoste(null);
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
      id: "areas-verdes-hachura",
      type: "fill",
      source: "areas-verdes",
      layout: { visibility: "none" },
      paint: {
        "fill-pattern": HACHURA_AREA_VERDE as never,
        "fill-opacity": OPACIDADE_HACHURA_AREA_VERDE,
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
      // Supressão anual (PRODES Caatinga): referência histórica, abaixo dos alertas.
      m.addSource(FONTE_SUPRESSAO, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "supressao-anual-preenchimento",
        type: "fill",
        source: FONTE_SUPRESSAO,
        layout: { visibility: "none" },
        paint: {
          "fill-color": corDaSupressao(2004, 2025),
          "fill-opacity": OPACIDADE_SUPRESSAO_ANUAL,
        },
      });
      m.addLayer({
        id: "supressao-anual-contorno",
        type: "line",
        source: FONTE_SUPRESSAO,
        layout: { visibility: "none" },
        paint: { "line-color": CORES_SUPRESSAO_ANUAL[1], "line-width": 0.8, "line-opacity": 0.8 },
      });
      m.on("mousemove", "supressao-anual-preenchimento", (e: MapLayerMouseEvent) => {
        const operacionais = CAMADAS_COM_CLIQUE.filter((id) => m.getLayer(id));
        if (
          desenhando.current ||
          (operacionais.length && m.queryRenderedFeatures(e.point, { layers: operacionais }).length)
        )
          return;
        const p = e.features?.[0]?.properties ?? {};
        setDica({ x: e.point.x, y: e.point.y, texto: textoDicaSupressao(p as DicaSupressao) });
      });
      m.on("mouseleave", "supressao-anual-preenchimento", () => setDica(null));
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

    if (podeMapa) {
      // Iluminação pública (contexto): abaixo das árvores, desligada por padrão e sem baixar nada
      // antes de ligar; o servidor só entrega os pontos a partir do zoom 15.
      m.addSource("iluminacao", {
        type: "vector",
        tiles: [urlTiles("iluminacao", {})],
        minzoom: ZOOM_ILUMINACAO,
        maxzoom: 22,
      });
      m.addLayer({
        id: "iluminacao-pontos",
        type: "symbol",
        source: "iluminacao",
        "source-layer": "iluminacao",
        minzoom: ZOOM_ILUMINACAO,
        layout: {
          visibility: "none",
          "icon-image": ID_ILUMINACAO,
          "icon-allow-overlap": true,
          "icon-size": ["interpolate", ["linear"], ["zoom"], ZOOM_ILUMINACAO, 0.7, 18, 1],
        },
        paint: { "icon-opacity": 0.85 },
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
      filter: filtroArvoreIndividual,
      paint: pinturaArvores(modoCor) as never,
    });
    adicionarAneisNaoConfirmadas(m, filtroArvoreIndividual);
    m.addLayer({
      id: "arvores-grupos",
      type: "symbol",
      source: "arvores",
      "source-layer": "arvores",
      filter: filtroGrupoDeArvores,
      layout: layoutGrupo("arvores") as never,
    });

    // Pontos de plantio possível (berço vazio e toco vistos por detecção), carregados ao ligar.
    m.addSource("pontos-plantio", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer({
      id: "pontos-plantio",
      type: "symbol",
      source: "pontos-plantio",
      layout: {
        visibility: "none",
        "icon-image": ID_PONTO_PLANTIO,
        "icon-allow-overlap": true,
      },
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
        const texto = p.bairro
          ? `${p.bairro} · ${plural(quantidade, "árvore")} — clique para aproximar`
          : quantidade > 1
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
        if (p.bairro || Number(p.quantidade ?? 1) > 1) {
          // Grupo de bairro: aproxima até sair do agrupamento por bairro (M-29).
          const alvo = p.bairro
            ? Math.max(m.getZoom() + 2.5, ZOOM_AGRUPA_BAIRRO + 0.5)
            : m.getZoom() + 2.5;
          m.easeTo({ center: e.lngLat, zoom: Math.min(alvo, 18) });
          return;
        }
        if (desenhando.current) return;
        atualizarBusca({
          selecao: `${camada.startsWith("arvores") ? "arvore" : "ocorrencia"}:${p.id}`,
        });
      });
    }
    // Iluminação pública: texto do ponto no painel. Árvores e ocorrências por cima têm prioridade.
    if (podeMapa) {
      m.on("mouseenter", "iluminacao-pontos", () => {
        if (!desenhando.current && !areaAtiva.current) m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "iluminacao-pontos", () => (m.getCanvas().style.cursor = ""));
      m.on("click", "iluminacao-pontos", (e: MapLayerMouseEvent) => {
        if (desenhando.current || areaAtiva.current) return;
        const sobre = CAMADAS_SOBRE_ILUMINACAO.filter((id) => m.getLayer(id));
        if (sobre.length && m.queryRenderedFeatures(e.point, { layers: sobre }).length) return;
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setPoste(p as unknown as PontoIluminacaoTile);
        setAreaVerde(null);
        setBairroCenso(null);
        atualizarBusca({ selecao: undefined });
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
      setPoste(null);
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
    void mapaAlertas({ bairro: territorioAtivo.id, ...periodoTempo }).then(({ data }) => {
      (mapa.current?.getSource("alertas") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
    // `periodoTempo` é recriado a cada render; só o mês escolhido dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, mostrarAlertas, territorioAtivo.id, tempoLigado, busca.ate, busca.desde]);

  // Pontos de plantio possível: buscados ao ligar a camada (escopo e permissão no servidor).
  useEffect(() => {
    if (!pronto || !mostrarPlantio) return;
    void deteccoesPontosPlantio().then(({ data }) => {
      (mapa.current?.getSource("pontos-plantio") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
  }, [pronto, mostrarPlantio]);

  // Supressão anual (PRODES): busca única, na primeira vez que a camada é ligada.
  useEffect(() => {
    if (!pronto || !mostrarSupressao || supressaoIniciada.current) return;
    supressaoIniciada.current = true;
    void mapaSupressaoAnual({ precisao: 5 })
      .then(({ data }) => {
        const { proveniencia: prov, ...colecao } = data as unknown as {
          proveniencia: ProvenienciaSupressao;
        };
        const m = mapa.current;
        (m?.getSource(FONTE_SUPRESSAO) as GeoJSONSource | undefined)?.setData(
          colecao as unknown as Parameters<GeoJSONSource["setData"]>[0],
        );
        if (m?.getLayer("supressao-anual-preenchimento") && prov.ano_inicial && prov.ano_final)
          m.setPaintProperty(
            "supressao-anual-preenchimento",
            "fill-color",
            corDaSupressao(prov.ano_inicial, prov.ano_final),
          );
        setProvSupressao(prov);
        setEstadoSupressao("pronto");
      })
      .catch(() => setEstadoSupressao("erro"));
  }, [pronto, mostrarSupressao]);

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

  // O indicador escolhido, para os manipuladores do mapa (registrados uma só vez).
  useEffect(() => {
    escolhidoPopulacao.current = busca.populacao;
  }, [busca.populacao]);

  // População e renda por bairro: busca única, na primeira vez que a camada é ligada.
  useEffect(() => {
    if (!pronto || !mostrarPopulacao || populacaoIniciada.current) return;
    populacaoIniciada.current = true;
    void indicadoresPopulacaoGeojson({ precisao: 5 })
      .then(({ data }) => {
        const { indicadores, estimativa, ...colecao } = data as unknown as DadosPopulacao & {
          type: string;
          features: unknown[];
        };
        (mapa.current?.getSource(FONTE_POPULACAO) as GeoJSONSource | undefined)?.setData(
          colecao as unknown as Parameters<GeoJSONSource["setData"]>[0],
        );
        setDadosPopulacao({ indicadores, estimativa });
        setEstadoPopulacao("pronto");
      })
      .catch(() => setEstadoPopulacao("erro"));
  }, [pronto, mostrarPopulacao]);

  // Trocar o indicador repinta a camada: cor pelas quebras (quantis) e filtro do "sem dado".
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m || !busca.populacao || !dadosPopulacao) return;
    const indicador = dadosPopulacao.indicadores.find((i) => i.id === busca.populacao);
    if (!indicador || !m.getLayer("populacao-preenchimento")) return;
    const propriedade = PROPRIEDADE[busca.populacao];
    m.setPaintProperty(
      "populacao-preenchimento",
      "fill-color",
      corPorQuebras(propriedade, indicador.quebras),
    );
    m.setFilter("populacao-preenchimento", filtroComDado(propriedade));
    m.setFilter("populacao-sem-dado", filtroSemDado(propriedade));
  }, [pronto, busca.populacao, dadosPopulacao]);

  // Desligar a camada ou selecionar uma árvore/ocorrência fecha o painel do ponto de iluminação.
  if (poste && (!mostrarIluminacao || tipoSelecao)) setPoste(null);
  // Desligar a camada ou selecionar uma árvore/ocorrência fecha o painel da área verde.
  if (areaVerde && (!mostrarAreasVerdes || tipoSelecao)) setAreaVerde(null);
  // O mesmo vale para o painel do bairro do Censo, que também cede a vez a uma área verde.
  if (bairroCenso && (!mostrarArborizacao || tipoSelecao || areaVerde)) setBairroCenso(null);
  if (bairroPopulacao && (!mostrarPopulacao || tipoSelecao || areaVerde)) setBairroPopulacao(null);

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
        el.hidden = !rotuloDoBairroVisivel(m.getZoom());
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
    if (limites)
      m.fitBounds(limites, { padding: paddingDoMapa(painelAbertoRef.current, 60), maxZoom: 16 });
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
    // Com os dois painéis abertos sobravam cerca de 470 px de mapa: o de camadas recolhe (R3-21).
    setPainel(false);
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
      padding: paddingDoMapa(painelAbertoRef.current),
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
      mapa.current?.fitBounds(limites as [number, number, number, number], {
        padding: paddingDoMapa(painelAbertoRef.current),
      });
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

  // Modo de cor das árvores e legibilidade das camadas sobre o mapa base (ruas ou satélite).
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    aplicarLegibilidade(m, base, COR_AREA_VERDE_POR_TIPO, pinturaArvores(modoCor, base));
  }, [pronto, modoCor, base]);

  // Visibilidade das camadas.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    const definir = (ids: string[], v: boolean) => {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(v));
    };
    definir(["arvores-grupos", "arvores-pontos", ...CAMADAS_ANEL_NAO_CONFIRMADA], mostrarArvores);
    definir(["pontos-plantio"], mostrarPlantio);
    definir(["ocorrencias-grupos", "ocorrencias-pontos"], mostrarOcorrencias);
    definir(["alertas-area", "alertas-borda", "alertas-pontos"], mostrarAlertas);
    definir(["supressao-anual-preenchimento", "supressao-anual-contorno"], mostrarSupressao);
    definir(["tarefas-pontos"], mostrarTarefas);
    definir(["iluminacao-pontos"], mostrarIluminacao);
    definir([CAMADA_ILHA_CALOR], mostrarIlhaCalor);
    definir(CAMADAS_ARBORIZACAO, mostrarArborizacao);
    definir(CAMADAS_POPULACAO, mostrarPopulacao);
    definir(["bairros-preenchimento", "bairros-contorno"], mostrarBairros);
    definir(
      [
        "areas-verdes-preenchimento",
        "areas-verdes-hachura",
        "areas-verdes-contorno",
        "areas-verdes-contorno-uc",
      ],
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
    mostrarPopulacao,
    mostrarTarefas,
    mostrarPlantio,
    mostrarAlertas,
    mostrarSupressao,
    mostrarIluminacao,
    mostrarIlhaCalor,
  ]);

  // Opacidade do raster da ilha de calor (controle deslizante do painel de camadas).
  useEffect(() => {
    const m = mapa.current;
    if (pronto && m?.getLayer(CAMADA_ILHA_CALOR))
      m.setPaintProperty(CAMADA_ILHA_CALOR, "raster-opacity", opacidadeIlhaCalor);
  }, [pronto, opacidadeIlhaCalor]);

  // Subtipo das praças: some só o que é praça e não é do subtipo escolhido; parques e unidades
  // de conservação seguem à vista.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const porSubtipo = busca.subtipo_praca
      ? ["any", ["!=", ["get", "tipo"], "praca"], ["==", ["get", "subtipo"], busca.subtipo_praca]]
      : null;
    // "Só adotadas" esconde tudo o que não tem termo de adoção, parques e unidades inclusive.
    const soAdotadas = busca.adotadas === "1" ? ["==", ["get", "adotada"], true] : null;
    const filtros = [porSubtipo, soAdotadas].filter(Boolean);
    const filtro = filtros.length > 1 ? ["all", ...filtros] : (filtros[0] ?? null);
    const semUc = ["!=", ["get", "tipo"], "unidade_conservacao"];
    m.setFilter("areas-verdes-preenchimento", filtro as never);
    m.setFilter("areas-verdes-hachura", filtro as never);
    m.setFilter(
      "areas-verdes-contorno",
      (filtros.length ? ["all", semUc, ...filtros] : semUc) as never,
    );
    // O contorno das unidades só muda de filtro quando "só adotadas" liga ou desliga.
    if (soAdotadas || filtroDasUnidadesAlterado.current) {
      const soUc = ["==", ["get", "tipo"], "unidade_conservacao"];
      m.setFilter(
        "areas-verdes-contorno-uc",
        (soAdotadas ? ["all", soUc, soAdotadas] : soUc) as never,
      );
      filtroDasUnidadesAlterado.current = soAdotadas !== null;
    }
  }, [pronto, busca.subtipo_praca, busca.adotadas]);

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

  // Linha do tempo: histograma mensal e contagens do período, com o escopo do usuário.
  const serieTempo = useMapaSerieTemporal(
    { bairro: territorioAtivo.id },
    { query: { enabled: tempoLigado, staleTime: 60_000 } },
  );
  const contagensTempo = useMapaSituacaoNaData(
    { ate: busca.ate ?? mesAtual(), desde: busca.desde, bairro: territorioAtivo.id },
    { query: { enabled: tempoLigado, placeholderData: keepPreviousData } },
  );
  const alterarPeriodo = (periodo: { ate: string; desde?: string }) =>
    atualizarBusca({ ate: periodo.ate, desde: periodo.desde });
  const ligarTempo = () => atualizarBusca({ ate: mesAtual() });
  const desligarTempo = () =>
    atualizarBusca({ ate: undefined, desde: undefined, comparar: undefined });
  const controleTempo = tempoLigado && busca.ate && (
    <ControleTempo
      serie={serieTempo.data?.data as SerieTemporal | undefined}
      ate={busca.ate}
      desde={busca.desde}
      aoMudar={alterarPeriodo}
      aoDesligar={desligarTempo}
      contagens={contagensTempo.data?.data}
      comparando={comparando}
      aoComparar={(c) => atualizarBusca({ comparar: c ? "1" : undefined })}
      compacto={celular}
    />
  );

  // Mapa de hoje da cortina: árvores e ocorrências sem período, com os mesmos filtros e cores.
  const mapaHoje = useRef<MapaMapLibre | null>(null);
  const carregarMapaHoje = (m: MapaMapLibre) => {
    mapaHoje.current = m;
    registrarIcones(m);
    m.on("styleimagemissing", (e) => aoFaltarImagem(m, e.id));
    m.addSource("arvores", {
      type: "vector",
      tiles: [urlTiles("arvores", filtrosArvoresHoje)],
      minzoom: 0,
      maxzoom: 22,
    });
    m.addLayer({
      id: "arvores-pontos",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: filtroArvoreIndividual,
      paint: pinturaArvores(modoCor, base) as never,
    });
    adicionarAneisNaoConfirmadas(m, filtroArvoreIndividual);
    m.addLayer({
      id: "arvores-grupos",
      type: "symbol",
      source: "arvores",
      "source-layer": "arvores",
      filter: filtroGrupoDeArvores,
      layout: layoutGrupo("arvores") as never,
    });
    if (podeOcorrencias) {
      m.addSource("ocorrencias", {
        type: "vector",
        tiles: [urlTiles("ocorrencias", filtrosOcorrenciasHoje)],
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
  };
  // Os filtros seguem valendo no mapa de hoje; o mês escolhido não.
  const chaveArvoresHoje = JSON.stringify(filtrosArvoresHoje);
  const chaveOcorrenciasHoje = JSON.stringify(filtrosOcorrenciasHoje);
  useEffect(() => {
    const m = mapaHoje.current;
    if (!comparando || !m) return;
    (m.getSource("arvores") as VectorTileSource | undefined)?.setTiles([
      urlTiles("arvores", JSON.parse(chaveArvoresHoje)),
    ]);
    (m.getSource("ocorrencias") as VectorTileSource | undefined)?.setTiles([
      urlTiles("ocorrencias", JSON.parse(chaveOcorrenciasHoje)),
    ]);
  }, [comparando, chaveArvoresHoje, chaveOcorrenciasHoje]);
  useEffect(() => {
    if (!comparando) mapaHoje.current = null;
  }, [comparando]);
  // Quantas praças há em cada subtipo, informado pela API de camadas.
  const subtiposPracas = ((info?.areas_verdes ?? []).find((a) => a.tipo === "praca")?.subtipos ??
    {}) as Record<string, number>;

  return (
    <div className="-m-4 h-[calc(100%+2rem)] md:-m-6 md:h-[calc(100%+3rem)]">
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
        {comparando && busca.ate && (
          <CortinaComparacao
            key={`${base}-${modoCor}`}
            base={base}
            mapaPrincipal={mapaPrincipal}
            aoCarregarHoje={carregarMapaHoje}
            rotuloAntes={textoDoPeriodo(busca.ate, busca.desde)}
          />
        )}
        {satelite && (
          <div
            role="group"
            aria-label="Mapa base"
            className="absolute right-2.5 bottom-[7.75rem] z-10 flex w-44 flex-col gap-1.5 rounded-lg border border-borda bg-superficie/95 p-1.5 text-xs shadow-md backdrop-blur max-md:top-16 max-md:bottom-auto max-md:w-36"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {(["ruas", "satelite"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={base === b}
                  onClick={() => escolherBase(b)}
                  className={cn(
                    "flex flex-col items-stretch gap-1 rounded-md border p-1 focus-visible:outline-2 focus-visible:outline-marca",
                    base === b
                      ? "border-marca bg-marca-clara font-medium"
                      : "border-borda hover:bg-neutro-clara",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-8 rounded-sm",
                      b === "ruas"
                        ? "bg-[linear-gradient(135deg,#eceee9_0_45%,#fff_45%_55%,#dfe3dc_55%)]"
                        : "bg-[linear-gradient(135deg,#2c4a2e,#4a6b3a_40%,#6b7f52_60%,#2f3b2a)]",
                    )}
                  />
                  {b === "ruas" ? "Mapa" : "Satélite"}
                </button>
              ))}
            </div>
            {satelite.aviso && (
              // No celular, o aviso só aparece com o satélite ligado, para não cobrir o mapa.
              <p
                className={cn(
                  "px-0.5 text-[11px] leading-tight text-texto-suave",
                  base !== "satelite" && "hidden md:block",
                )}
              >
                <span className="font-medium">Satélite:</span> {satelite.aviso}.
              </p>
            )}
          </div>
        )}
        {/* Coluna esquerda: painel (encolhe e rola) e legenda, sem se sobrepor. */}
        <div
          className={cn(
            "pointer-events-none absolute top-3 bottom-9 left-3 z-10 flex w-80 flex-col gap-2",
            // Celular: coluna na base da tela. Fechado, o botão e a legenda sobem acima da
            // escala do mapa e deixam o zoom livre; aberto, a folha ocupa a largura toda.
            "max-md:inset-x-0 max-md:top-auto max-md:w-auto max-md:flex-col-reverse max-md:gap-2",
            painel
              ? "max-md:bottom-0"
              : "max-md:right-14 max-md:bottom-7 max-md:left-3 max-md:w-auto",
          )}
        >
          {painel ? (
            <aside
              aria-label="Camadas e filtros"
              className="pointer-events-auto flex min-h-0 shrink flex-col overflow-hidden rounded-xl border border-borda bg-superficie/95 text-sm shadow-lg backdrop-blur max-md:max-h-[70dvh] max-md:rounded-t-2xl max-md:rounded-b-none"
            >
              <button
                type="button"
                aria-label="Recolher camadas e filtros"
                onClick={() => alternarPainel(false)}
                className="flex h-7 shrink-0 items-center justify-center md:hidden"
              >
                <span aria-hidden className="h-1.5 w-10 rounded-full bg-borda" />
              </button>
              <div className="flex items-center justify-between border-b border-borda px-4 py-3 max-md:pt-1">
                <h1 className="flex items-center gap-2 font-semibold">
                  <Layers className="size-4 text-marca" aria-hidden /> Camadas e filtros
                </h1>
                <button
                  ref={botaoOcultar}
                  className="rounded p-1 hover:bg-fundo max-md:p-3"
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
                  {podeDeteccao && (
                    <Camada
                      rotulo="Plantio possível (detecção)"
                      marcador={<AmostraPlantio />}
                      ativa={mostrarPlantio}
                      aoMudar={(v) => atualizarBusca({ plantio: v ? "1" : undefined })}
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
                      {mostrarAreasVerdes && (
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-texto-suave">Subtipo das praças</span>
                          <Selecao
                            value={busca.subtipo_praca ?? ""}
                            onChange={(e) =>
                              atualizarBusca({
                                subtipo_praca: (e.target.value ||
                                  undefined) as BuscaMapa["subtipo_praca"],
                              })
                            }
                          >
                            <option value="">Todos os subtipos</option>
                            {Object.entries(ROTULOS_SUBTIPO_PRACA).map(([subtipo, rotulo]) => {
                              const n = subtiposPracas[subtipo];
                              return (
                                <option key={subtipo} value={subtipo}>
                                  {rotulo}
                                  {n !== undefined ? ` (${n.toLocaleString("pt-BR")})` : ""}
                                </option>
                              );
                            })}
                          </Selecao>
                        </label>
                      )}
                      {mostrarAreasVerdes && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-marca"
                            checked={busca.adotadas === "1"}
                            onChange={(e) =>
                              atualizarBusca({ adotadas: e.target.checked ? "1" : undefined })
                            }
                          />
                          Só praças adotadas
                        </label>
                      )}
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
                  <Grupo
                    titulo="Contexto (fontes externas)"
                    aberto={
                      mostrarArborizacao ||
                      mostrarPopulacao ||
                      mostrarIluminacao ||
                      mostrarIlhaCalor
                    }
                  >
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
                    <ControlePopulacao
                      escolhido={busca.populacao}
                      aoMudar={(v) => atualizarBusca({ populacao: v })}
                      carregando={pronto && estadoPopulacao === "inicial"}
                      erro={estadoPopulacao === "erro"}
                      amostra={<AmostraPopulacao />}
                    />
                    <Camada
                      rotulo="Iluminação pública"
                      marcador={<AmostraIluminacao />}
                      ativa={mostrarIluminacao}
                      aoMudar={(v) => atualizarBusca({ iluminacao: v ? "1" : undefined })}
                    />
                    <p className="text-xs text-texto-suave">
                      Pontos de serviço da iluminação, com poste e lâmpadas. Aparecem a partir do
                      zoom {ZOOM_ILUMINACAO}. Fonte: {ATRIBUICAO_ILUMINACAO}.
                    </p>
                    {mostrarIluminacao && aproximarIluminacao && (
                      <p role="status" className="text-xs text-texto-suave">
                        Aproxime o mapa para ver os pontos de iluminação (a partir do zoom{" "}
                        {ZOOM_ILUMINACAO}).
                      </p>
                    )}
                    <ControleIlhaCalor
                      ativa={mostrarIlhaCalor}
                      aoMudar={(v) => atualizarBusca({ ilha_calor: v ? "1" : undefined })}
                      opacidade={opacidadeIlhaCalor}
                      aoMudarOpacidade={setOpacidadeIlhaCalor}
                    />
                  </Grupo>
                )}

                {podeAlertas && (
                  <Grupo
                    titulo="Ambientais — sinais externos"
                    aberto={mostrarAlertas || mostrarSupressao}
                  >
                    <Camada
                      rotulo="Alertas ambientais"
                      marcador={<Losango cor={COR_ALERTA} />}
                      ativa={mostrarAlertas}
                      aoMudar={(v) => atualizarBusca({ alertas: v ? "1" : undefined })}
                    />
                    <p className="text-xs text-texto-suave">
                      Detecções de satélite e focos de calor não provam irregularidade.
                    </p>
                    <Camada
                      rotulo="Supressão anual (PRODES Caatinga)"
                      marcador={<AmostraSupressao />}
                      ativa={mostrarSupressao}
                      aoMudar={(v) => atualizarBusca({ supressao_anual: v ? "1" : undefined })}
                    />
                    <p className="text-xs text-texto-suave">
                      Histórico anual de supressão de vegetação, de {ESCALA_SUPRESSAO}. Camada de
                      referência, não é alerta.
                    </p>
                    {mostrarSupressao && pronto && estadoSupressao === "inicial" && (
                      <p role="status" className="text-xs text-texto-suave">
                        Carregando a supressão anual…
                      </p>
                    )}
                    {mostrarSupressao && estadoSupressao === "erro" && (
                      <p role="alert" className="text-xs text-perigo">
                        Não foi possível carregar a supressão anual.
                      </p>
                    )}
                  </Grupo>
                )}

                <CamadasReferencia
                  mapaRef={mapa}
                  pronto={pronto}
                  camadasPrioritarias={CAMADAS_COM_CLIQUE}
                />

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
                    {mostrarIluminacao && info?.iluminacao && (
                      <p>
                        Iluminação pública: {String(info.iluminacao.fonte)}
                        {info.iluminacao.licenca ? ` · ${String(info.iluminacao.licenca)}` : ""} ·
                        ingerido em {formatarDataHora(String(info.iluminacao.ingerido_em))}
                        {info.iluminacao.data_referencia
                          ? ` · dados de ${formatarData(String(info.iluminacao.data_referencia))}`
                          : " · data dos dados não informada"}
                      </p>
                    )}
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
                    {mostrarPopulacao &&
                      dadosPopulacao?.indicadores
                        .filter((i) => i.id === busca.populacao)
                        .map(
                          (i) =>
                            i.proveniencia && (
                              <p key={i.id}>
                                {i.nome}: {i.proveniencia.fonte}
                                {i.proveniencia.versao ? ` (versão ${i.proveniencia.versao})` : ""}
                                {i.proveniencia.licenca ? ` · ${i.proveniencia.licenca}` : ""} ·
                                ingerido em {formatarDataHora(i.proveniencia.ingerido_em)}
                                {i.proveniencia.data_referencia
                                  ? ` · dados de ${anoDaData(i.proveniencia.data_referencia)}`
                                  : " · data dos dados não informada"}
                                {i.provisorio ? " · valor provisório (DP-14)" : ""}
                              </p>
                            ),
                        )}
                    {mostrarPopulacao && dadosPopulacao?.estimativa && (
                      <p>
                        Estimativa iTree por bairro (não é dado oficial): base IBGE{" "}
                        {dadosPopulacao.estimativa.ano}, versão {dadosPopulacao.estimativa.versao}.{" "}
                        {dadosPopulacao.estimativa.hipotese}
                      </p>
                    )}
                    {(info?.populacao ?? []).map((f) => (
                      <p
                        key={String(f.fonte)}
                        className={f.desatualizada || f.falhou ? "text-atencao" : undefined}
                      >
                        {String(f.nome)}: versão {String(f.versao || "—")} · conferida em{" "}
                        {formatarDataHora(String(f.ultima_conferencia))}
                        {f.falhou ? " · a última conferência falhou" : ""}
                        {f.desatualizada ? " · desatualizada" : ""}
                      </p>
                    ))}
                    {base === "ruas" && config.mapaRuas && <p>{config.mapaRuas.atribuicao}</p>}
                    {base === "satelite" && satelite && (
                      <p>
                        {[
                          satelite.nome,
                          satelite.data
                            ? `imagem de ${formatarData(satelite.data)}`
                            : "data da imagem não informada pelo provedor",
                          satelite.atribuicao,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
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
              className="pointer-events-auto self-start shadow max-md:h-12 max-md:px-4"
              onClick={() => alternarPainel(true)}
            >
              <Layers /> Camadas e filtros
            </Botao>
          )}
          {celular &&
            !painel &&
            podeMapa &&
            (controleTempo || <BotaoLinhaDoTempo aoLigar={ligarTempo} />)}
          <div className="flex-1" />
          <div className={cn("contents", painel && "max-md:hidden")}>
            <Legenda
              tempo={tempoLigado}
              modoCor={modoCor}
              arvores={mostrarArvores}
              ocorrencias={mostrarOcorrencias}
              tarefas={mostrarTarefas}
              plantio={mostrarPlantio}
              alertas={mostrarAlertas}
              supressao={mostrarSupressao ? (provSupressao ?? "carregando") : null}
              recolhidaPorPadrao={painel || celular}
              areasVerdes={mostrarAreasVerdes}
              iluminacao={mostrarIluminacao ? { aproximar: aproximarIluminacao } : null}
              arborizacao={mostrarArborizacao}
              definicaoArborizacao={proveniencia?.definicao ?? DEFINICAO_ARBORIZACAO}
            />
          </div>
          {tempoLigado && (mostrarPopulacao || mostrarIlhaCalor) && (
            <p
              data-testid="legenda-sem-tempo"
              className="pointer-events-auto rounded-lg bg-superficie/95 px-3 py-1.5 text-xs text-texto-suave shadow"
            >
              {[mostrarPopulacao && "População e renda", mostrarIlhaCalor && "Ilha de calor"]
                .filter(Boolean)
                .join(" e ")}
              : camada sem linha do tempo.
            </p>
          )}
          {mostrarPopulacao && busca.populacao && (
            <LegendaPopulacao
              indicador={dadosPopulacao?.indicadores.find((i) => i.id === busca.populacao) ?? null}
              carregado={estadoPopulacao === "pronto"}
            />
          )}
          {mostrarIlhaCalor && (
            <section
              aria-label="Legenda da ilha de calor"
              className="pointer-events-auto shrink-0 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur max-md:max-h-[45dvh] max-md:overflow-y-auto"
            >
              <LegendaIlhaCalor />
            </section>
          )}
        </div>

        {/* Linha do tempo, no rodapé, ao lado da coluna de camadas e acima da escala. No celular ela
            fica na coluna da base, fora das folhas. */}
        {!celular && podeMapa && (
          <div className="pointer-events-none absolute right-16 bottom-9 left-[21.75rem] z-10 flex">
            <div className="flex w-full max-w-2xl flex-col">
              {controleTempo || <BotaoLinhaDoTempo aoLigar={ligarTempo} />}
            </div>
          </div>
        )}

        {/* Ferramentas do mapa, ao lado do painel de camadas. */}
        <div
          className={cn(
            "pointer-events-none absolute top-3 z-10 flex min-w-64 flex-col items-start gap-2",
            painel
              ? "left-[21.75rem] max-w-[calc(100%-44rem)]"
              : "left-52 max-w-[calc(100%-14rem)]",
            // Celular: as ferramentas ficam no topo, na largura da tela (o painel é a folha de baixo).
            "max-md:right-3 max-md:left-3 max-md:max-w-none max-md:min-w-0",
          )}
        >
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
              Bairro em destaque:{" "}
              <Link
                to="/bairros/$id"
                params={{ id: String(feicaoDestaque.id) }}
                className="font-semibold text-marca-escura hover:underline"
                aria-label={`${feicaoDestaque.properties.nome}: abrir a ficha do bairro`}
              >
                {feicaoDestaque.properties.nome}
              </Link>
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
            className="pointer-events-none absolute right-14 bottom-2 z-10 rounded bg-superficie/90 max-md:hidden px-2 py-0.5 font-mono text-[11px] text-texto-suave shadow-sm"
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
        {poste && !area && !tipoSelecao && !areaVerde && !bairroCenso && (
          <PainelPoste
            poste={poste}
            fonte={info?.iluminacao as FonteIluminacao | null | undefined}
            aoFechar={() => setPoste(null)}
          />
        )}
        {bairroCenso && !area && !tipoSelecao && !areaVerde && (
          <PainelArborizacaoEntorno
            bairro={bairroCenso}
            proveniencia={proveniencia}
            aoFechar={() => setBairroCenso(null)}
          />
        )}
        {bairroPopulacao &&
          busca.populacao &&
          !area &&
          !tipoSelecao &&
          !areaVerde &&
          !bairroCenso && (
            <PainelPopulacaoBairro
              bairro={bairroPopulacao}
              escolhido={busca.populacao}
              dados={dadosPopulacao}
              aoFechar={() => setBairroPopulacao(null)}
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

/** Amostra do anel das árvores detectadas e ainda não confirmadas. */
function AnelNaoConfirmada() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 rounded-full border-2 bg-transparent"
      style={{ borderColor: COR_NAO_CONFIRMADA, boxShadow: "0 0 0 1.5px #ffffff" }}
    />
  );
}

/** Amostra do ponto de plantio possível: círculo laranja com "+". */
function AmostraPlantio() {
  return (
    <span
      aria-hidden
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold text-white"
      style={{ background: COR_PONTO_PLANTIO }}
    >
      +
    </span>
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

/** Amostra do ponto de iluminação: a mesma cruz discreta do mapa. */
function AmostraIluminacao() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="size-3.5">
      <path
        d="M2 6h8M6 2v8"
        stroke={COR_ILUMINACAO}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

const ESCALA_SUPRESSAO = "≥ ~1 ha, anual, escala regional";

/** Amostra da rampa da supressão anual: do mais antigo (claro) ao mais recente (escuro). */
function AmostraSupressao() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-4 rounded-[2px]"
      style={{
        background: `linear-gradient(to right, ${CORES_SUPRESSAO_ANUAL[0]}, ${CORES_SUPRESSAO_ANUAL[1]})`,
      }}
    />
  );
}

interface DicaSupressao {
  ano?: number;
  data_imagem?: string;
  area_ha?: number | null;
}

/** Dica do polígono sob o cursor: ano do mapeamento, data da imagem e área. */
function textoDicaSupressao(p: DicaSupressao): string {
  const ha =
    p.area_ha === null || p.area_ha === undefined
      ? ""
      : ` · ${Number(p.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha`;
  const imagem = p.data_imagem ? ` · imagem de ${formatarData(p.data_imagem)}` : "";
  return `Supressão mapeada em ${p.ano ?? "ano desconhecido"}${imagem}${ha}`;
}

interface DicaArborizacao {
  /** Id do bairro (propriedade da feição): leva à ficha dele. */
  id?: string;
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
  plantio,
  alertas,
  supressao,
  recolhidaPorPadrao,
  areasVerdes,
  iluminacao,
  arborizacao,
  definicaoArborizacao,
  tempo,
}: {
  /** Linha do tempo ligada: as camadas de contexto avisam que não acompanham o tempo. */
  tempo: boolean;
  modoCor: ModoCor;
  arvores: boolean;
  ocorrencias: boolean;
  tarefas: boolean;
  /** Pontos de plantio possível (berço vazio e toco vistos por detecção) ligados. */
  plantio: boolean;
  alertas: boolean;
  /** Supressão anual ligada: a proveniência (ou "carregando"); `null` com a camada desligada. */
  supressao: ProvenienciaSupressao | "carregando" | null;
  /** Com o painel de camadas aberto, a legenda começa recolhida para não cobrir o mapa (C-09). */
  recolhidaPorPadrao: boolean;
  areasVerdes: boolean;
  /** Iluminação ligada: se o zoom ainda é menor que o de exibição (`aproximar`); `null` desligada. */
  iluminacao: { aproximar: boolean } | null;
  arborizacao: boolean;
  definicaoArborizacao: string;
}) {
  const [aberta, setAberta] = useState(!recolhidaPorPadrao);
  // Ao ligar uma camada de contexto a legenda abre: sem ela a coropleta e a rampa não se leem
  // (R3-22). Estado derivado na renderização, sem efeito.
  const [contextoAnterior, setContextoAnterior] = useState({
    areasVerdes,
    arborizacao,
    supressao: !!supressao,
    iluminacao: !!iluminacao,
  });
  const contextoAtual = {
    areasVerdes,
    arborizacao,
    supressao: !!supressao,
    iluminacao: !!iluminacao,
  };
  if (
    contextoAtual.areasVerdes !== contextoAnterior.areasVerdes ||
    contextoAtual.arborizacao !== contextoAnterior.arborizacao ||
    contextoAtual.supressao !== contextoAnterior.supressao ||
    contextoAtual.iluminacao !== contextoAnterior.iluminacao
  ) {
    setContextoAnterior(contextoAtual);
    if (
      (contextoAtual.areasVerdes && !contextoAnterior.areasVerdes) ||
      (contextoAtual.arborizacao && !contextoAnterior.arborizacao) ||
      (contextoAtual.supressao && !contextoAnterior.supressao) ||
      (contextoAtual.iluminacao && !contextoAnterior.iluminacao)
    )
      setAberta(true);
  }
  if (
    !arvores &&
    !ocorrencias &&
    !tarefas &&
    !plantio &&
    !alertas &&
    !supressao &&
    !areasVerdes &&
    !iluminacao &&
    !arborizacao
  )
    return null;
  return (
    <section
      aria-label="Legenda"
      className="pointer-events-auto shrink-0 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur max-md:max-h-[45dvh] max-md:overflow-y-auto"
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
              <p className="mt-1.5 flex items-center gap-1.5" data-testid="legenda-nao-confirmada">
                <AnelNaoConfirmada /> Detectada, ainda não confirmada
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
          {plantio && (
            <p className="flex items-center gap-1.5" data-testid="legenda-plantio">
              <AmostraPlantio /> Plantio possível: berço vazio ou toco visto por detecção
            </p>
          )}
          {tarefas && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {tempo && (
                <li>
                  <SemTempo rotulo="Tarefas" />
                </li>
              )}
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
              <p className="mb-1 text-texto-suave">Áreas verdes — tipo {tempo && <SemTempo />}</p>
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
                Arborização do entorno — faces de quadra com árvore {tempo && <SemTempo />}
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
          {supressao && (
            <div data-testid="legenda-supressao">
              <p className="font-semibold">
                Supressão anual (PRODES Caatinga) {tempo && <SemTempo />}
              </p>
              <p className="mt-1 flex items-center gap-1.5">
                <span className="text-texto-suave">
                  {typeof supressao === "object" && supressao.ano_inicial
                    ? supressao.ano_inicial
                    : "…"}
                </span>
                <span
                  aria-hidden
                  className="inline-block h-3 w-20 shrink-0 rounded-[2px] border border-black/20"
                  style={{
                    background: `linear-gradient(to right, ${CORES_SUPRESSAO_ANUAL[0]}, ${CORES_SUPRESSAO_ANUAL[1]})`,
                  }}
                />
                <span className="text-texto-suave">
                  {typeof supressao === "object" && supressao.ano_final ? supressao.ano_final : "…"}
                </span>
              </p>
              <p className="mt-0.5 max-w-64 text-texto-suave">
                Cor pelo ano do mapeamento: mais escuro, mais recente. Polígonos {ESCALA_SUPRESSAO}.
                Fonte: INPE, TerraBrasilis. Não é alerta nem prova irregularidade.
              </p>
            </div>
          )}
          {iluminacao && (
            <div data-testid="legenda-iluminacao">
              <p className="flex items-center gap-1.5">
                <AmostraIluminacao /> Iluminação pública — ponto de serviço {tempo && <SemTempo />}
              </p>
              {iluminacao.aproximar && (
                <p className="mt-0.5 max-w-64 text-texto-suave">
                  Aproxime para ver: os pontos aparecem a partir do zoom {ZOOM_ILUMINACAO}.
                </p>
              )}
              <p className="mt-0.5 max-w-64 text-texto-suave">Fonte: {ATRIBUICAO_ILUMINACAO}.</p>
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

/** Aviso nas camadas que não têm data: a linha do tempo não as altera. */
function SemTempo({ rotulo }: { rotulo?: string }) {
  return (
    <span className="font-normal text-texto-suave italic">
      {rotulo ? `${rotulo}: ` : "· "}camada sem linha do tempo
    </span>
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
    <PainelDetalhe rotulo="Detalhes da seleção">
      <button
        className="absolute top-3 right-3 z-10 rounded-full bg-superficie/90 p-1 shadow-sm hover:bg-fundo max-md:top-1 max-md:right-1 max-md:p-3.5"
        aria-label="Fechar detalhes"
        onClick={aoFechar}
      >
        <X className="size-4" />
      </button>
      {tipo === "arvore" ? <ResumoArvore id={id} /> : <ResumoOcorrencia id={id} />}
    </PainelDetalhe>
  );
}

function areaAdotada(area: AreaVerdeSelecionada): boolean {
  return area.adotada === true || area.adotada === "true";
}

/** O MapLibre devolve lista de propriedade como texto JSON. */
function categoriasDoAdotante(area: AreaVerdeSelecionada): string[] {
  const bruto = area.adocao_tipos;
  if (Array.isArray(bruto)) return bruto;
  try {
    const lista: unknown = JSON.parse(bruto ?? "[]");
    return Array.isArray(lista) ? lista.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Adoção da praça (mapa 622, SEUMA). A fonte tem o nome do adotante, que o iTree não importa:
 * aparecem só a existência, a quantidade, a categoria (empresa, associação ou condomínio, quando a
 * razão social deixa claro) e o ano de referência do mapa, que não é a data do termo.
 */
function AdocaoDaArea({ area }: { area: AreaVerdeSelecionada }) {
  const categorias = categoriasDoAdotante(area);
  const n = area.adocoes ?? 0;
  return (
    <div className="flex flex-col gap-1">
      <p>
        <span className="rounded-full border border-marca px-2 py-0.5 text-xs font-medium text-marca">
          Adotada
        </span>
      </p>
      <p className="text-xs text-texto-suave">
        {n > 1 ? `${n} termos de adoção` : "Termo de adoção"} registrado
        {n > 1 ? "s" : ""} no Fortaleza em Mapas (SEUMA)
        {area.adocao_ano_referencia ? `, referência ${area.adocao_ano_referencia}` : ""}
        {categorias.length ? ` · ${categorias.join(" e ").toLowerCase()}` : ""}. O nome do adotante
        não é importado.
      </p>
    </div>
  );
}

/** Fonte da camada de iluminação, como `mapa/camadas` a devolve. */
interface FonteIluminacao {
  fonte?: string;
  licenca?: string;
  data_referencia?: string | null;
  ingerido_em?: string | null;
}

/**
 * Ponto de iluminação pública clicado, em texto: logradouro, poste, lâmpadas e a fonte com a
 * atribuição exigida pela licença (RN-PROV-003). Só descreve o dado da SEINF.
 */
function PainelPoste({
  poste,
  fonte,
  aoFechar,
}: {
  poste: PontoIluminacaoTile;
  fonte?: FonteIluminacao | null;
  aoFechar: () => void;
}) {
  const lampadas = listaDeLampadas(poste.lampadas);
  return (
    <PainelDetalhe rotulo="Detalhes do ponto de iluminação" className="gap-2 text-sm">
      <button
        className="absolute top-3 right-3 rounded-full p-1 hover:bg-fundo max-md:top-1 max-md:right-1 max-md:p-3.5"
        aria-label="Fechar detalhes"
        onClick={aoFechar}
      >
        <X className="size-4" />
      </button>
      <div className="pr-8">
        <p className="text-lg font-semibold">Ponto de iluminação pública</p>
        <p className="flex items-center gap-1.5 text-texto-suave">
          <AmostraIluminacao /> Ponto de serviço <span className="tabular-nums">{poste.id}</span>
        </p>
      </div>
      <p>
        <span className="font-medium">Logradouro:</span>{" "}
        {poste.logradouro ? capitalizar(poste.logradouro) : "Não informado"}
      </p>
      <p>
        <span className="font-medium">Poste:</span>{" "}
        {textoDoPoste(poste.poste, poste.altura_min_m, poste.altura_max_m)}
      </p>
      <div>
        <p className="font-medium">Lâmpadas:</p>
        {lampadas.length ? (
          <ul className="list-disc pl-5">
            {lampadas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p>Não informadas</p>
        )}
      </div>
      <div className="border-t border-borda pt-2 text-xs text-texto-suave">
        <p>
          <span className="font-medium">Fonte:</span> {ATRIBUICAO_ILUMINACAO}
        </p>
        {fonte?.licenca && <p>{fonte.licenca}</p>}
        <p>
          {fonte?.data_referencia
            ? `Dados de ${anoDaData(fonte.data_referencia)}`
            : "Data dos dados não informada"}
          {fonte?.ingerido_em ? ` · ingerido em ${formatarDataHora(fonte.ingerido_em)}` : ""}
        </p>
      </div>
    </PainelDetalhe>
  );
}

/** Nome, tipo e fonte da área verde clicada, com a proveniência do dado (RN-PROV-003). */
function PainelAreaVerde({ area, aoFechar }: { area: AreaVerdeSelecionada; aoFechar: () => void }) {
  const tipo = ROTULOS_TIPO_AREA_VERDE[area.tipo as keyof typeof ROTULOS_TIPO_AREA_VERDE];
  return (
    <PainelDetalhe rotulo="Detalhes da área verde" className="gap-2 text-sm">
      <button
        className="absolute top-3 right-3 rounded-full p-1 hover:bg-fundo max-md:top-1 max-md:right-1 max-md:p-3.5"
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
          {area.tipo === "praca" && area.subtipo && area.subtipo !== "praca"
            ? ` · ${area.subtipo_rotulo ?? ROTULOS_SUBTIPO_PRACA[area.subtipo] ?? area.subtipo}`
            : ""}
        </p>
      </div>
      {areaAdotada(area) && <AdocaoDaArea area={area} />}
      {area.ato_legal && <p>Ato legal: {area.ato_legal}</p>}
      {area.codigo_cnuc && (
        <p>
          Código no CNUC: <span className="tabular-nums">{area.codigo_cnuc}</span>
          {area.esfera_cnuc ? ` · esfera ${area.esfera_cnuc.toLowerCase()}` : ""}
        </p>
      )}
      {area.area_m2 ? (
        <p>Área informada: {Math.round(area.area_m2).toLocaleString("pt-BR")} m²</p>
      ) : null}
      {(area.feicoes_da_unidade ?? 0) > 1 && (
        <p>
          Esta unidade aparece em {area.feicoes_da_unidade} feições no mapa
          {area.area_total_da_unidade_m2
            ? `; área somada: ${Math.round(area.area_total_da_unidade_m2).toLocaleString("pt-BR")} m²`
            : ""}
          .
        </p>
      )}
      <div className="border-t border-borda pt-2 text-xs text-texto-suave">
        <p>
          <span className="font-medium">Fonte:</span> {area.fonte}
        </p>
        {(area.orgao_gestor || area.esfera) && (
          <p>Órgão: {[area.orgao_gestor, area.esfera].filter(Boolean).join(" · ")}</p>
        )}
        {area.licenca && <p>{area.licenca}</p>}
        {area.codigo_cnuc && <p>Código e esfera conferidos com o CNUC (MMA), licença CC BY.</p>}
        <p>
          {area.data_referencia
            ? `Dados de ${anoDaData(area.data_referencia)}`
            : "Data dos dados não informada"}
          {area.ingerido_em ? ` · ingerido em ${formatarDataHora(area.ingerido_em)}` : ""}
        </p>
      </div>
    </PainelDetalhe>
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
    <PainelDetalhe rotulo="Arborização do entorno do bairro" className="gap-2 text-sm">
      <button
        className="absolute top-3 right-3 rounded-full p-1 hover:bg-fundo max-md:top-1 max-md:right-1 max-md:p-3.5"
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
              {bairro.nome ?? "Bairro"}
            </Link>
          ) : (
            (bairro.nome ?? "Bairro")
          )}
        </p>
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
    </PainelDetalhe>
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
  const podeConfirmar = usePermissao("deteccao.revisar");
  const cliente = useQueryClient();
  const confirmar = useArvoresConfirmar<ErroApi>();
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
          <SelosDeteccao arvore={a} />
        </div>
        {a.deteccao && !a.confirmada && (
          <p className="mt-1 text-xs text-texto-suave">
            Detectada automaticamente e ainda não confirmada: o anel no mapa marca as árvores nesse
            estado.
          </p>
        )}
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
      {podeConfirmar && a.situacao === "ativa" && !a.confirmada && (
        <Botao
          variante="secundario"
          disabled={confirmar.isPending}
          onClick={() =>
            confirmar.mutate(
              { id: a.id, data: {} },
              {
                onSuccess: () =>
                  void invalidarCaminhos(cliente, "/api/v1/arvores", "/api/v1/indicadores"),
              },
            )
          }
        >
          <CircleCheck aria-hidden /> Confirmar árvore
        </Botao>
      )}
      {confirmar.isError && (
        <p role="alert" className="text-xs text-perigo">
          {confirmar.error.message}
        </p>
      )}
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
