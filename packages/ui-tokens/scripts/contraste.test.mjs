import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lerCoropletica, lerMapa, pinturaRaster, verificar } from "./contraste.mjs";

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

const coropletica = readFileSync(join(web, "coropletica.ts"), "utf8");
const daColoropletica = (coro) =>
  verificar(css, lerMapa(realce, estilo), coro).filter((r) =>
    r.descricao.startsWith("arborização do entorno"),
  );

test("a rampa da arborização do entorno separa as classes e a mais escura contrasta com o mapa", () => {
  const coro = lerCoropletica(coropletica);
  assert.equal(coro.cores.length, 5);
  const pares = daColoropletica(coro);
  // Por fundo do OSM (5): 4 pares entre classes vizinhas e a classe mais escura.
  assert.equal(pares.length, 25);
  for (const r of pares)
    assert.ok(r.razao >= r.minimo, `${r.descricao}: ${r.razao.toFixed(2)}:1 (mín. ${r.minimo})`);
});

test("uma rampa com classes quase iguais, ou clara demais, falha na verificação", () => {
  const coro = lerCoropletica(coropletica);
  const igual = { ...coro, cores: [coro.cores[0], coro.cores[0], ...coro.cores.slice(2)] };
  assert.ok(daColoropletica(igual).some((r) => r.razao < r.minimo));
  const clara = { ...coro, cores: ["#cde2fb", "#d5e6fb", "#dbeafc", "#e2eefc", "#e8f1fd"] };
  assert.ok(daColoropletica(clara).some((r) => r.razao < r.minimo));
});
