#!/usr/bin/env node
/**
 * Verifica o contraste (WCAG 2.x, luminância relativa) dos pares de cor
 * realmente usados no painel. Lê `src/tokens.css` (fonte dos valores) e
 * confere que `src/tokens.ts` tem os mesmos valores.
 *
 * Limites: 4,5:1 para texto normal; 3:1 para texto grande, ícones e bordas
 * de componentes (WCAG 1.4.3 e 1.4.11).
 *
 * Uso: `node scripts/contraste.mjs` (sai com código 1 se algum par falhar).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Lê as variáveis `--color-*` de tokens.css. */
export function lerTokens(css) {
  const tokens = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

const paraRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminancia(hex) {
  const [r, g, b] = paraRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function razao(a, b) {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Cor `frente` com opacidade `alfa` composta sobre `fundo`. */
function compor(frente, fundo, alfa) {
  const f = paraRgb(frente);
  const b = paraRgb(fundo);
  return `#${f
    .map((v, i) =>
      Math.round(v * alfa + b[i] * (1 - alfa))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const TEXTO = 4.5;
const NAO_TEXTO = 3;
const BRANCO = "#ffffff";

/**
 * Pares de uso real. Cada item: [descrição, frente, fundo, mínimo].
 * `frente`/`fundo` são nomes de token ou cores literais (`#...`).
 */
function montarPares(t) {
  const pares = [];
  const p = (descricao, frente, fundo, minimo = TEXTO) =>
    pares.push({ descricao, frente, fundo, minimo });
  const cor = (v) => (v.startsWith("#") ? v : t[v]);

  // Texto sobre fundo, superfície e superfície alternativa (hover/selos neutros).
  for (const texto of ["texto", "texto-suave"]) {
    for (const fundo of ["fundo", "superficie", "neutro-clara", "marca-clara"])
      p(`${texto} sobre ${fundo}`, texto, fundo);
  }
  // Barra lateral.
  for (const texto of ["barra-texto", "barra-suave"]) {
    for (const fundo of ["barra", "barra-ativo"]) p(`${texto} sobre ${fundo}`, texto, fundo);
  }
  p("barra-realce (marcador do item ativo) sobre barra", "barra-realce", "barra", NAO_TEXTO);
  p(
    "barra-realce (marcador do item ativo) sobre barra-ativo",
    "barra-realce",
    "barra-ativo",
    NAO_TEXTO,
  );
  // Texto branco sobre as cores semânticas (botões, faixa de aviso).
  for (const fundo of ["marca", "marca-escura", "sucesso", "info", "atencao", "perigo"]) {
    p(`branco sobre ${fundo}`, BRANCO, fundo);
  }
  // Botão perigo em hover: perigo a 90% sobre o fundo da página e da superfície.
  for (const base of ["fundo", "superficie"]) {
    p(`branco sobre perigo/90 (hover) sobre ${base}`, BRANCO, compor(t.perigo, t[base], 0.9));
  }
  // Selos: texto semântico sobre a respectiva cor clara.
  for (const [texto, fundo] of [
    ["neutro", "neutro-clara"],
    ["marca-escura", "marca-clara"],
    ["info", "info-clara"],
    ["atencao", "atencao-clara"],
    ["perigo", "perigo-clara"],
    ["sucesso", "sucesso-clara"],
  ]) {
    p(`selo ${texto} sobre ${fundo}`, texto, fundo);
  }
  // Texto semântico solto (mensagens, valores) sobre fundo e superfície.
  for (const texto of ["marca", "marca-escura", "info", "atencao", "perigo", "sucesso", "neutro"]) {
    for (const fundo of ["fundo", "superficie"]) p(`${texto} sobre ${fundo}`, texto, fundo);
  }
  p(
    "perigo sobre perigo-clara/40 sobre superficie (linha com erro)",
    "perigo",
    compor(t["perigo-clara"], t.superficie, 0.4),
  );
  // Links (marca-escura) já cobertos acima; reforço explícito sobre as superfícies de lista.
  p("link marca-escura sobre neutro-clara", "marca-escura", "neutro-clara");
  // Não texto: bordas de campos (1.4.11) e anel de foco.
  for (const fundo of ["fundo", "superficie"]) {
    p(`borda-campo sobre ${fundo}`, "borda-campo", fundo, NAO_TEXTO);
    p(`anel de foco (marca) sobre ${fundo}`, "marca", fundo, NAO_TEXTO);
  }
  p("campo inválido: borda perigo sobre superficie", "perigo", "superficie", NAO_TEXTO);

  return pares.map((x) => ({ ...x, frente: cor(x.frente), fundo: cor(x.fundo) }));
}

export function verificar(css) {
  const t = lerTokens(css);
  const ausentes = [];
  const exigidos = [
    "fundo",
    "superficie",
    "borda-campo",
    "texto",
    "texto-suave",
    "marca",
    "marca-escura",
    "marca-clara",
    "barra",
    "barra-ativo",
    "barra-texto",
    "barra-suave",
    "barra-realce",
    "info",
    "info-clara",
    "atencao",
    "atencao-clara",
    "perigo",
    "perigo-clara",
    "sucesso",
    "sucesso-clara",
    "neutro",
    "neutro-clara",
  ];
  for (const n of exigidos) if (!t[n]) ausentes.push(n);
  if (ausentes.length) throw new Error(`Tokens ausentes em tokens.css: ${ausentes.join(", ")}`);
  return montarPares(t).map((x) => ({ ...x, razao: razao(x.frente, x.fundo) }));
}

/** Confere que tokens.ts (app móvel) repete os valores de tokens.css. */
export function divergenciasTs(css, ts) {
  const t = lerTokens(css);
  const erros = [];
  for (const m of ts.matchAll(/^\s+([a-zA-Z]+):\s*"(#[0-9a-fA-F]{6})",?$/gm)) {
    const nome = m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    if (!t[nome]) erros.push(`tokens.ts tem "${m[1]}" sem --color-${nome} em tokens.css`);
    else if (t[nome] !== m[2].toLowerCase())
      erros.push(`${m[1]}: tokens.ts ${m[2]} difere de tokens.css ${t[nome]}`);
  }
  return erros;
}

function principal() {
  const css = readFileSync(join(raiz, "src/tokens.css"), "utf8");
  const ts = readFileSync(join(raiz, "src/tokens.ts"), "utf8");
  const resultados = verificar(css);
  let falhas = 0;
  for (const r of resultados) {
    const ok = r.razao >= r.minimo;
    if (!ok) falhas += 1;
    console.log(
      `${ok ? "ok   " : "FALHA"} ${r.razao.toFixed(2).padStart(5)}:1 (mín. ${r.minimo}) ${r.descricao}`,
    );
  }
  const divergencias = divergenciasTs(css, ts);
  for (const d of divergencias) console.log(`FALHA ${d}`);
  console.log(
    `\n${resultados.length} pares verificados, ${falhas} falha(s), ${divergencias.length} divergência(s) css/ts.`,
  );
  if (falhas || divergencias.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
