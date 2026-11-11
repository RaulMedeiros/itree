import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lerMapa, pinturaRaster, verificar } from "./contraste.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(raiz, "src/tokens.css"), "utf8");
const web = join(raiz, "../../apps/web/src/mapa");
const realce = readFileSync(join(web, "realce.ts"), "utf8");
const estilo = readFileSync(join(web, "estilo.ts"), "utf8");

const doMapa = (mapa) =>
  verificar(css, mapa).filter((r) => r.descricao.startsWith("contorno do bairro"));

test("o contorno do realce de bairro passa 3:1 sobre o mapa claro, com e sem máscara", () => {
  const pares = doMapa(lerMapa(realce, estilo));
  assert.equal(pares.length, 10);
  for (const r of pares) assert.ok(r.razao >= 3, `${r.descricao}: ${r.razao.toFixed(2)}:1`);
});

test("um contorno claro ou muito transparente falha na verificação", () => {
  const mapa = lerMapa(realce, estilo);
  assert.ok(doMapa({ ...mapa, contorno: "#b8c4d0" }).some((r) => r.razao < 3));
  assert.ok(doMapa({ ...mapa, opacidadeContorno: 0.2 }).some((r) => r.razao < 3));
});

test("o tratamento raster clareia o fundo do OSM como o estilo base", () => {
  const { raster } = lerMapa(realce, estilo);
  const tratado = pinturaRaster("#f2efe9", raster);
  assert.notEqual(tratado, "#f2efe9");
  // Dessaturado: os canais ficam mais próximos entre si do que no original.
  const [r, , b] = [1, 3, 5].map((i) => parseInt(tratado.slice(i, i + 2), 16));
  assert.ok(r - b < 0xf2 - 0xe9);
});
