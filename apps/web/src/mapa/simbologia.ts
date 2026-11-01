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
    desenhar(m, `oco-${prioridade}`, 22, (c, t) => triangulo(c, t, cor, "#ffffff", t * 0.08));
    // Risco confirmado: contorno escuro grosso.
    desenhar(m, `oco-${prioridade}-risco`, 26, (c, t) => triangulo(c, t, cor, "#3b0d0c", t * 0.12));
  }
  for (const [nome, cor] of [
    ["tarefa", COR_TAREFA],
    ["tarefa-atrasada", COR_TAREFA_ATRASADA],
  ] as const) {
    desenhar(m, nome, 22, (c, t) => {
      const b = t * 0.1;
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.fillRect(b, b, t - 2 * b, t - 2 * b);
      c.lineWidth = b;
      c.strokeStyle = cor;
      c.strokeRect(b, b, t - 2 * b, t - 2 * b);
      // Prancheta: duas linhas.
      c.fillStyle = cor;
      c.fillRect(t * 0.3, t * 0.38, t * 0.4, t * 0.08);
      c.fillRect(t * 0.3, t * 0.56, t * 0.4, t * 0.08);
    });
  }
  desenhar(m, "alerta", 22, (c, t) => {
    const b = t * 0.1;
    c.beginPath();
    c.moveTo(t / 2, b);
    c.lineTo(t - b, t / 2);
    c.lineTo(t / 2, t - b);
    c.lineTo(b, t / 2);
    c.closePath();
    c.fillStyle = COR_ALERTA;
    c.fill();
    c.lineWidth = b * 0.8;
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
 * Agrupamentos com contagem (RF-MAPA-020). O nome da imagem codifica camada e
 * quantidade (`grupo-arvores-37`); é desenhada sob demanda.
 */
export function aoFaltarImagem(m: MapaMapLibre, id: string) {
  const r = /^grupo-(arvores|ocorrencias)-(\d+)$/.exec(id);
  if (!r) return;
  const quantidade = Number(r[2]);
  const texto = quantidade >= 1000 ? `${Math.round(quantidade / 100) / 10}k` : String(quantidade);
  const tamanho = quantidade < 10 ? 28 : quantidade < 100 ? 34 : quantidade < 1000 ? 40 : 46;
  const cor = r[1] === "arvores" ? "#1f6b45" : "#b35c00";
  desenhar(m, id, tamanho, (c, t) => {
    // Neutro: um grupo não tem condição; a cor fica para as árvores individuais.
    c.beginPath();
    c.arc(t / 2, t / 2, t / 2 - ESCALA, 0, Math.PI * 2);
    c.fillStyle = cor;
    c.globalAlpha = 0.18;
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(t / 2, t / 2, t / 2 - ESCALA * 4, 0, Math.PI * 2);
    c.fillStyle = "#ffffff";
    c.fill();
    c.lineWidth = ESCALA * 2;
    c.strokeStyle = cor;
    c.stroke();
    c.fillStyle = cor;
    c.font = `700 ${t * (texto.length > 2 ? 0.28 : 0.34)}px Inter, system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(texto, t / 2, t / 2 + ESCALA * 0.5);
  });
}

export const iconeGrupo = (camada: "arvores" | "ocorrencias"): ExpressionSpecification => [
  "concat",
  `grupo-${camada}-`,
  ["to-string", ["get", "quantidade"]],
];
