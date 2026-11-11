/**
 * Simbologia do mapa (W-02).
 *
 * - **Cor** das árvores = condição aparente (o que a gestão precisa ver).
 * - **Forma/contorno** = origem da localização (RN-MAPA-002): cheio com borda
 *   branca (GPS de campo), borda escura (importada), vazado (estimada).
 * - Ocorrências, tarefas e alertas usam **formas** próprias (triângulo,
 *   quadrado, losango), não só cor — distinguíveis para daltônicos e
 *   visualmente separados entre si (RF-MAPA-005).
 *
 * O mapa não usa servidor de glifos: ícones e números dos agrupamentos são
 * desenhados em canvas e registrados como imagens.
 */
import type { CondicaoAparenteEnum } from "@itree/api-client";
import type { ExpressionSpecification, Map as MapaMapLibre } from "maplibre-gl";

export const COR_ARVORE = "#1f6b45";
export const COR_SEM_AVALIACAO = "#a3ada7";

export const CORES_CONDICAO: Record<CondicaoAparenteEnum, string> = {
  boa: "#2f9e44",
  regular: "#e3a008",
  ruim: "#e8590c",
  morta: "#6d4c41",
  nao_avaliada: COR_SEM_AVALIACAO,
};

export const CORES_ORIGEM: Record<string, string> = {
  gps_campo: "#1f6b45",
  importada: "#4f8f6b",
  estimada_web: "#d4a017",
  geocodificada: "#a3b1a8",
};

export const CORES_PRIORIDADE: Record<string, string> = {
  urgente: "#c92a2a",
  alta: "#e8590c",
  media: "#e3a008",
  baixa: "#1c7ed6",
  "": "#495057",
};

export const COR_TAREFA = "#1c7ed6";
export const COR_TAREFA_ATRASADA = "#c92a2a";
export const COR_ALERTA = "#7048e8";
export const COR_SELECAO = "#0b7285";

/**
 * Áreas verdes (praças, parques, unidades de conservação): camada de contexto,
 * translúcida e abaixo das árvores. As cores são deliberadamente diferentes da
 * cor "Boa" das árvores (#2f9e44): oliva, verde-azulado e musgo escuro, com
 * preenchimento de baixa opacidade. Sobre o mapa base claro, o preenchimento
 * fica a ΔE (CIE76) ≈ 58-60 da cor "Boa" e o contorno a ≥ 33. As unidades de
 * conservação ainda têm contorno tracejado, para não depender só da cor.
 */
export const CORES_AREA_VERDE: Record<string, string> = {
  praca: "#8a9a2b",
  parque: "#1f8a70",
  unidade_conservacao: "#4b6b3a",
};
export const OPACIDADE_AREA_VERDE = 0.22;
export const OPACIDADE_AREA_VERDE_UC = 0.14;

export type ModoCor = "condicao" | "origem";

const match = (
  propriedade: string,
  cores: Record<string, string>,
  padrao: string,
): ExpressionSpecification =>
  [
    "match",
    ["get", propriedade],
    ...Object.entries(cores).flatMap(([k, v]) => [k, v]),
    padrao,
  ] as unknown as ExpressionSpecification;

export const corDaArvore = (modo: ModoCor): ExpressionSpecification =>
  modo === "condicao"
    ? match("condicao", CORES_CONDICAO, COR_SEM_AVALIACAO)
    : match("localizacao_origem", CORES_ORIGEM, CORES_ORIGEM.geocodificada!);

/** Estimada (web) ou geocodificada: localização menos confiável → símbolo vazado. */
const ehEstimada: ExpressionSpecification = [
  "in",
  ["get", "localizacao_origem"],
  ["literal", ["estimada_web", "geocodificada"]],
];

const ehGps: ExpressionSpecification = ["==", ["get", "localizacao_origem"], "gps_campo"];

/**
 * Raio cresce com o zoom; a cor fica legível já na escala do bairro.
 * Contorno: GPS de campo (verificada) = anel verde-escuro; importada = borda
 * branca; estimada = símbolo vazado.
 */
export const pinturaArvores = (modo: ModoCor) => ({
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    11,
    3,
    13,
    4.5,
    14,
    5.5,
    15,
    6.5,
    17,
    9,
    19,
    12,
  ],
  "circle-color": corDaArvore(modo),
  "circle-opacity": ["case", ehEstimada, 0.2, 0.95],
  "circle-stroke-color": ["case", ehEstimada, corDaArvore(modo), ehGps, "#0b3d2a", "#ffffff"],
  "circle-stroke-width": ["case", ehEstimada, 2, ehGps, 2.2, 1.2],
});

// ---------------------------------------------------------------------------
// Ícones desenhados em canvas.

const ESCALA = 2;
/** Tamanho (px) dos ícones de ocorrência, tarefa e alerta: 20% maiores que antes (C-12). */
export const TAM_ICONE = 26;
export const TAM_ICONE_RISCO = 31;

function desenhar(
  m: MapaMapLibre,
  nome: string,
  tamanho: number,
  pintar: (c: CanvasRenderingContext2D, t: number) => void,
) {
  if (m.hasImage(nome)) return;
  const t = tamanho * ESCALA;
  const canvas = document.createElement("canvas");
  canvas.width = t;
  canvas.height = t;
  const c = canvas.getContext("2d");
  if (!c) return;
  pintar(c, t);
  m.addImage(nome, c.getImageData(0, 0, t, t), { pixelRatio: ESCALA });
}

function triangulo(c: CanvasRenderingContext2D, t: number, cor: string, borda: string, b: number) {
  c.beginPath();
  c.moveTo(t / 2, b);
  c.lineTo(t - b, t - b * 1.2);
  c.lineTo(b, t - b * 1.2);
  c.closePath();
  c.fillStyle = cor;
  c.fill();
  c.lineWidth = b;
  c.strokeStyle = borda;
  c.lineJoin = "round";
  c.stroke();
  // Ponto de exclamação.
  c.fillStyle = "#ffffff";
  c.fillRect(t / 2 - t * 0.045, t * 0.36, t * 0.09, t * 0.26);
  c.beginPath();
  c.arc(t / 2, t * 0.72, t * 0.055, 0, Math.PI * 2);
  c.fill();
}

/** Registra os ícones fixos (ocorrências, tarefas, alertas). */
export function registrarIcones(m: MapaMapLibre) {
  for (const [prioridade, cor] of Object.entries(CORES_PRIORIDADE)) {
    desenhar(m, `oco-${prioridade}`, TAM_ICONE, (c, t) =>
      triangulo(c, t, cor, "#ffffff", t * 0.08),
    );
    // Risco confirmado: contorno escuro grosso.
    desenhar(m, `oco-${prioridade}-risco`, TAM_ICONE_RISCO, (c, t) =>
      triangulo(c, t, cor, "#3b0d0c", t * 0.12),
    );
  }
  for (const [nome, cor] of [
    ["tarefa", COR_TAREFA],
    ["tarefa-atrasada", COR_TAREFA_ATRASADA],
  ] as const) {
    desenhar(m, nome, TAM_ICONE, (c, t) => {
      // Contorno branco externo (contraste sobre o mapa), moldura colorida e miolo claro.
      const b = t * 0.12;
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, t, t);
      c.fillStyle = `${cor}26`;
      c.fillRect(b, b, t - 2 * b, t - 2 * b);
      c.lineWidth = b * 1.4;
      c.strokeStyle = cor;
      c.strokeRect(b * 1.7, b * 1.7, t - 3.4 * b, t - 3.4 * b);
      // Prancheta: duas linhas.
      c.fillStyle = cor;
      c.fillRect(t * 0.3, t * 0.38, t * 0.4, t * 0.08);
      c.fillRect(t * 0.3, t * 0.56, t * 0.4, t * 0.08);
    });
  }
  desenhar(m, "alerta", TAM_ICONE, (c, t) => {
    const b = t * 0.1;
    c.beginPath();
    c.moveTo(t / 2, b);
    c.lineTo(t - b, t / 2);
    c.lineTo(t / 2, t - b);
    c.lineTo(b, t / 2);
    c.closePath();
    c.fillStyle = COR_ALERTA;
    c.fill();
    c.lineWidth = b * 1.2;
    c.strokeStyle = "#ffffff";
    c.stroke();
  });
  desenhar(m, "hachura-alerta", 12, (c, t) => {
    c.strokeStyle = COR_ALERTA;
    c.lineWidth = ESCALA * 1.2;
    c.beginPath();
    c.moveTo(0, t);
    c.lineTo(t, 0);
    c.stroke();
  });
}

/**
 * Camadas do alerta ambiental isolado (página de detalhe): o mesmo losango roxo e a
 * mesma hachura do mapa principal, nunca a cor laranja da condição "Ruim" (C-28).
 * Exige `registrarIcones` antes.
 */
export function camadasDoAlerta(fonte: string, pontual: boolean) {
  return pontual
    ? [
        {
          id: "alerta",
          type: "symbol",
          source: fonte,
          layout: { "icon-image": "alerta", "icon-allow-overlap": true, "icon-size": 1.3 },
        },
      ]
    : [
        {
          id: "alerta-area",
          type: "fill",
          source: fonte,
          paint: { "fill-pattern": "hachura-alerta", "fill-opacity": 0.6 },
        },
        {
          id: "alerta-borda",
          type: "line",
          source: fonte,
          paint: { "line-color": COR_ALERTA, "line-width": 2, "line-dasharray": [3, 1.5] },
        },
      ];
}

/** Condições na ordem de gravidade usada pelo backend em `pior_condicao`. */
const CONDICOES_GRUPO = Object.keys(CORES_CONDICAO);

/**
 * Agrupamentos com contagem (RF-MAPA-020). O nome da imagem codifica camada e
 * quantidade (`grupo-ocorrencias-37`); para árvores inclui também a pior condição
 * contida (`grupo-arvores-morta-37`), que colore o anel. Desenhada sob demanda.
 */
export function aoFaltarImagem(m: MapaMapLibre, id: string) {
  const r = /^grupo-(?:arvores-([a-z_]+)|(ocorrencias))-(\d+)$/.exec(id);
  if (!r) return;
  const quantidade = Number(r[3]);
  const texto = quantidade >= 1000 ? `${Math.round(quantidade / 100) / 10}k` : String(quantidade);
  const tamanho = quantidade < 10 ? 28 : quantidade < 100 ? 34 : quantidade < 1000 ? 40 : 46;
  if (r[2]) {
    desenharGrupo(m, id, tamanho, texto, "#b35c00", "#b35c00");
    return;
  }
  const condicao = CONDICOES_GRUPO.includes(r[1]!) ? r[1]! : "nao_avaliada";
  desenharGrupo(
    m,
    id,
    tamanho,
    texto,
    CORES_CONDICAO[condicao as keyof typeof CORES_CONDICAO],
    "#1f2933",
  );
}

function desenharGrupo(
  m: MapaMapLibre,
  id: string,
  tamanho: number,
  texto: string,
  corAnel: string,
  corTexto: string,
) {
  desenhar(m, id, tamanho, (c, t) => {
    // Halo translúcido, anel de ~3 px na cor da pior condição e miolo neutro.
    c.beginPath();
    c.arc(t / 2, t / 2, t / 2 - ESCALA, 0, Math.PI * 2);
    c.fillStyle = corAnel;
    c.globalAlpha = 0.18;
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(t / 2, t / 2, t / 2 - ESCALA * 4.5, 0, Math.PI * 2);
    c.fillStyle = "#ffffff";
    c.fill();
    c.lineWidth = ESCALA * 3;
    c.strokeStyle = corAnel;
    c.stroke();
    c.fillStyle = corTexto;
    c.font = `700 ${t * (texto.length > 2 ? 0.28 : 0.34)}px Inter, system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(texto, t / 2, t / 2 + ESCALA * 0.5);
  });
}

export const iconeGrupo = (camada: "arvores" | "ocorrencias"): ExpressionSpecification =>
  camada === "arvores"
    ? [
        "concat",
        "grupo-arvores-",
        ["coalesce", ["get", "pior_condicao"], "nao_avaliada"],
        "-",
        ["to-string", ["get", "quantidade"]],
      ]
    : ["concat", "grupo-ocorrencias-", ["to-string", ["get", "quantidade"]]];

/**
 * Layout das camadas de agrupamento (R2-07). Os grupos de árvores cedem lugar uns aos outros
 * (`icon-allow-overlap: false`), com prioridade para o de maior quantidade, e encolhem em zoom
 * baixo. Os de ocorrências nunca são escondidos: a camada fica acima das árvores e, como entra
 * antes no índice de colisão, são os grupos de árvores que cedem a elas.
 */
export function layoutGrupo(camada: "arvores" | "ocorrencias") {
  const tamanho: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 8, 0.7, 13, 1];
  if (camada === "ocorrencias") {
    return {
      "icon-image": iconeGrupo(camada),
      "icon-allow-overlap": true,
      "icon-size": tamanho,
      "symbol-sort-key": ["-", ["get", "quantidade"]] as ExpressionSpecification,
    };
  }
  return {
    "icon-image": iconeGrupo(camada),
    "icon-allow-overlap": false,
    "icon-size": tamanho,
    // Menor chave é colocada primeiro: o grupo com mais árvores vence a colisão.
    "symbol-sort-key": ["-", ["get", "quantidade"]] as ExpressionSpecification,
  };
}
