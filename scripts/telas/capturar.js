// Captura as telas do painel com os dados sintéticos de semear.py.
// Uso: node capturar.js <ids.json> <diretório de saída>   (ver README.md)
// SO=01,05 limita às capturas cujo nome começa com esses prefixos.
const { chromium } = require("playwright");
const path = require("path");
const ids = require(path.resolve(process.argv[2]));
const BASE = "http://localhost:8088";
const SAIDA = process.argv[3];

// Celular: 390 x 844, toque, tela de densidade 2 (equivale a um iPhone 13 em CSS px).
const CELULAR = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

async function entrar(nav, email, senha, dispositivo = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await nav.newContext({
    ...dispositivo,
    locale: "pt-BR",
    timezoneId: "America/Fortaleza",
  });
  const p = await ctx.newPage();
  await p.goto(BASE + "/visao-geral");
  await p.waitForURL(/localhost:8080/);
  await p.fill("#username", email);
  await p.fill("#password", senha);
  await p.click("#kc-login");
  await p.waitForURL((u) => u.href.startsWith(BASE));
  return { ctx, p };
}

async function tela(p, nome, caminho, { esperar, acao, espera = 1200, inteira = false } = {}) {
  if (process.env.SO && !process.env.SO.split(",").some((x) => nome.startsWith(x))) return;
  try {
    if (caminho) await p.goto(BASE + caminho);
    if (esperar) await p.getByText(esperar).first().waitFor({ timeout: 20000 });
    await p.waitForLoadState("networkidle").catch(() => undefined);
    if (acao) await acao(p);
    await p.waitForTimeout(espera);
    if (inteira) {
      // O shell limita a altura à janela e rola o <main>; para a captura da página
      // inteira, solta os limites.
      await p.evaluate(() => {
        const shell = document.querySelector('[data-testid="shell"]');
        const main = shell?.querySelector("main");
        for (const el of [shell, main?.parentElement, main?.parentElement?.parentElement, main]) {
          if (el) Object.assign(el.style, { height: "auto", overflow: "visible" });
        }
      });
    }
    await p.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: inteira });
    console.log("ok", nome, "—", await p.title());
  } catch (e) {
    console.log("FALHOU", nome, e.message.split("\n")[0]);
  }
}

(async () => {
  const nav = await chromium.launch();
  let { ctx, p } = await entrar(nav, "gestor@itree.local", "gestor");

  await tela(p, "01-visao-geral", "/visao-geral", { esperar: "Como é calculado", espera: 4000 });
  await tela(p, "01b-visao-geral-completa", "/visao-geral", {
    esperar: "Como é calculado",
    espera: 4000,
    inteira: true,
  });
  await tela(p, "02-mapa", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6`, {
    esperar: "Legenda",
    espera: 5000,
  });
  await tela(p, "02b-mapa-grupos", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=12.6`, {
    esperar: "Legenda",
    espera: 5000,
  });
  // Satélite de desenvolvimento (Sentinel-2 de 10 m, EOX), zoom 15 numa área com árvores.
  await tela(
    p,
    "47-mapa-satelite",
    `/mapa?lon=${ids.foto_lon}&lat=${ids.foto_lat}&zoom=15&base=satelite`,
    {
      esperar: "Legenda",
      espera: 7000,
    },
  );
  await tela(
    p,
    "03-mapa-selecao",
    `/mapa?lon=${ids.foto_lon}&lat=${ids.foto_lat}&zoom=17&selecao=arvore:${ids.arvore_foto}`,
    { esperar: "Legenda", espera: 5000 },
  );
  await tela(
    p,
    "04-mapa-alertas-tarefas",
    `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6&alertas=1&tarefas=1&ocorrencias=0`,
    { esperar: "Legenda", espera: 5000 },
  );
  await tela(p, "33-mapa-bairro-destaque", "/mapa", {
    esperar: "Legenda",
    espera: 4000,
    acao: async (p) => {
      await p
        .getByPlaceholder("Buscar árvore, ocorrência, bairro ou coordenada")
        .fill(ids.bairro_demo);
      await p.getByRole("option", { name: ids.bairro_demo }).first().click();
      await p.getByText("Bairro em destaque:").waitFor({ timeout: 15000 });
    },
  });
  await tela(p, "34-mapa-selecao-area", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6`, {
    esperar: "Legenda",
    espera: 3000,
    acao: async (p) => {
      await p.waitForTimeout(3000);
      await p.getByRole("button", { name: "Selecionar área" }).click();
      await p.mouse.move(760, 330);
      await p.mouse.down();
      await p.mouse.move(930, 470, { steps: 8 });
      await p.mouse.move(1080, 600, { steps: 8 });
      await p.mouse.up();
      await p
        .getByText(/árvores? na área|Árvores/)
        .first()
        .waitFor({ timeout: 15000 });
    },
  });
  await tela(
    p,
    "35-mapa-areas-verdes",
    `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6&areas_verdes=1`,
    {
      esperar: "Legenda",
      espera: 5000,
    },
  );
  await tela(
    p,
    "37-mapa-censo",
    `/mapa?lon=${-38.54}&lat=${-3.76}&zoom=11.6&arborizacao_entorno=1`,
    {
      esperar: "Legenda",
      espera: 5000,
    },
  );
  await tela(p, "38-mapa-camada-conectada", `/mapa?lon=${-38.54}&lat=${-3.77}&zoom=11.8`, {
    esperar: "Camadas conectadas",
    espera: 5000,
    acao: async (p) => {
      await p
        .getByLabel(/Plano de Arborização/)
        .first()
        .check();
    },
  });
  // Iluminação pública (SEINF): Aldeota, na Av. Heráclito Graça (ponto 904705 da fonte), zoom 16.
  await tela(p, "39-mapa-iluminacao", `/mapa?lon=${-38.5095}&lat=${-3.7381}&zoom=16&iluminacao=1`, {
    esperar: "Legenda",
    espera: 6000,
  });
  await tela(p, "40-arvores-iluminacao", "/inventario/iluminacao", {
    esperar: /Árvores próximas à iluminação/,
    espera: 2500,
  });
  await tela(p, "36-notificacoes", "/visao-geral", {
    esperar: "Como é calculado",
    espera: 1500,
    acao: async (p) => {
      await p.getByRole("button", { name: /^Notificações/ }).click();
      await p.waitForTimeout(800);
    },
  });
  await tela(p, "05-arvores", "/inventario/arvores", { esperar: /ARV-/ });
  await tela(p, "06-arvore-resumo", `/inventario/arvores/${ids.arvore}`, { esperar: "Resumo" });
  await tela(p, "07-arvore-medidas", null, {
    acao: (q) => q.getByRole("tab", { name: /Medidas/ }).click(),
  });
  await tela(p, "08-arvore-historico", null, {
    acao: (q) => q.getByRole("tab", { name: /Histórico/ }).click(),
  });
  await tela(p, "09-arvore-evidencias", `/inventario/arvores/${ids.arvore_foto}`, {
    esperar: "Resumo",
    acao: (q) => q.getByRole("tab", { name: /Evidências/ }).click(),
    espera: 2500,
  });
  // Galeria: a árvore da semeadura com fotos sintéticas de inspeção, ocorrência e evidência,
  // linha do tempo, condição em degraus e referência da espécie.
  const abrirGaleria = (q) => q.getByRole("tab", { name: "Galeria" }).click();
  await tela(p, "45-arvore-galeria", `/inventario/arvores/${ids.arvore_foto}`, {
    esperar: "Resumo",
    acao: async (q) => {
      await abrirGaleria(q);
      await q
        .getByRole("button", { name: /^Abrir foto/ })
        .first()
        .waitFor({ timeout: 15000 });
    },
    espera: 3000,
    inteira: true,
  });
  // Comparar: o "antes da poda" (ocorrência) contra o "depois da poda", na barra deslizante.
  await tela(p, "46-arvore-comparar", `/inventario/arvores/${ids.arvore_foto}`, {
    esperar: "Resumo",
    acao: async (q) => {
      await abrirGaleria(q);
      await q.getByRole("button", { name: "Comparar" }).click();
      const dialogo = q.getByRole("dialog", { name: "Comparar fotos" });
      await dialogo.getByLabel("Foto de antes").selectOption({ index: 3 });
      await dialogo.getByLabel("Foto de depois").selectOption({ index: 5 });
      await dialogo.getByRole("button", { name: "Barra deslizante" }).click();
      await dialogo.getByRole("slider").fill("55");
    },
    espera: 3000,
  });
  await tela(p, "10-arvore-sugestao-ia", `/inventario/arvores/${ids.arvore_ia}`, {
    esperar: "Resumo",
    acao: (q) => q.getByRole("tab", { name: /Sugestões de IA/ }).click(),
  });
  await tela(p, "31-especies", "/inventario/especies", {
    esperar: "Licania tomentosa",
    espera: 2500,
  });
  await tela(p, "32-especie-detalhe", `/inventario/especies/${ids.especie}`, {
    esperar: "Catálogo municipal",
  });
  await tela(p, "11-importacoes", "/inventario/importacoes", { esperar: /inventario-sintetico/ });
  await tela(p, "12-importacao-nova", null, {
    acao: async (q) => {
      await q
        .getByRole("button", { name: /Nova importação|Importar/ })
        .first()
        .click();
      await q
        .getByRole("dialog")
        .locator('input[type="file"]')
        .setInputFiles(path.join(__dirname, "inventario-exemplo.csv"));
    },
    espera: 2500,
  });
  await tela(p, "13-duplicidades", "/inventario/duplicidades", { espera: 2500 });
  await tela(p, "14-qualidade", "/inventario/qualidade", {
    esperar: "Sem problemas",
    inteira: true,
  });
  await tela(p, "15-ocorrencias", "/ocorrencias", { esperar: /OCO-/ });
  await tela(p, "16-ocorrencia-detalhe", `/ocorrencias/${ids.ocorrencia}`, {
    esperar: /OCO-/,
    inteira: true,
  });
  await tela(p, "17-inspecoes", "/inspecoes", { esperar: /INS-/ });
  await tela(p, "18-inspecao-revisao", `/inspecoes/${ids.inspecao}`, {
    esperar: /INS-/,
    inteira: true,
  });
  await tela(p, "19-equipes-tarefas", "/equipes-tarefas", { esperar: /TAR-/ });
  await tela(p, "20-alertas", "/alertas", { esperar: /ALR-/ });
  await tela(p, "21-alerta-detalhe", `/alertas/${ids.alerta}`, { esperar: /ALR-/, espera: 3000 });
  await tela(p, "22-analises", "/analises?analise=arvores_por_bairro", {
    esperar: ids.bairro_demo,
  });
  // Ficha do bairro com mais árvores: mapa, cartões com fonte e data, gráficos e ranking.
  await tela(p, "42-ficha-bairro", `/bairros/${ids.bairro_demo_id}`, {
    esperar: "Indicadores do bairro",
    espera: 6000,
    inteira: true,
  });
  // Camada "Ilha de calor (UrbVerde)" ligada, em Fortaleza no zoom 12 (WMS buscado pelo navegador).
  await tela(p, "43-mapa-ilha-calor", `/mapa?lon=${-38.5267}&lat=${-3.7319}&zoom=12&ilha_calor=1`, {
    esperar: "Ilha de calor (UrbVerde), 2025",
    espera: 8000,
  });
  await tela(p, "44-bairros", "/bairros", { esperar: ids.bairro_demo, espera: 4000 });
  // Pessoas por árvore: camada coroplética "Árvores por 1.000 habitantes" (provisório, com a ressalva
  // do inventário) e as análises por bairro com população, renda e a dispersão.
  await tela(
    p,
    "48-mapa-renda-por-bairro",
    `/mapa?lon=${-38.54}&lat=${-3.78}&zoom=11.2&populacao=renda`,
    {
      esperar: /Censo 2022/,
      espera: 6000,
    },
  );
  await tela(
    p,
    "49-analises-pessoas-arvore",
    "/analises?analise=arvores_por_mil_habitantes_por_bairro",
    {
      esperar: /falta de cadastro/,
      espera: 3000,
    },
  );
  await tela(p, "50-analises-arvores-renda", "/analises?analise=arvores_mil_x_renda", {
    esperar: /falta de cadastro/,
    espera: 3000,
  });
  // Planejamento "Onde plantar": cenário Equilibrado e cenário Equidade com um bairro aberto.
  await tela(p, "51-planejamento", "/planejamento", {
    esperar: /Os 20 bairros com maior prioridade/,
    espera: 6000,
    inteira: true,
  });
  await tela(
    p,
    "52-planejamento-equidade",
    `/planejamento?renda=5&arborizacao=4&densidade=2&arvores=2&verde=2&bairro=${ids.bairro_demo_id}`,
    {
      esperar: /Abrir a ficha do bairro/,
      espera: 6000,
      inteira: true,
    },
  );
  // Regra 3-30-300 e imóveis (Open Buildings, uso do solo e macrozoneamento): a ficha do bairro com
  // o bloco 3-30-300, o mapa de edificações no zoom 16 em Aldeota, a coroplética da parte 300 e o
  // ranking da regra em Análises. A parte "3" usa só árvores SINTÉTICAS da semeadura, e o "30" fica
  // sem dado enquanto o NDVI de Fortaleza não estiver disponível.
  await tela(p, "58-ficha-bairro-3-30-300", `/bairros/${ids.bairro_demo_id}`, {
    esperar: /Árvores contadas/,
    espera: 3000,
    inteira: true,
  });
  await tela(
    p,
    "59-mapa-edificacoes",
    `/mapa?lon=${-38.4955}&lat=${-3.7375}&zoom=16&edificacoes=1&uso_lote=1`,
    { esperar: /Edificações/, espera: 7000 },
  );
  await tela(
    p,
    "60-mapa-3-30-300",
    `/mapa?lon=${-38.52}&lat=${-3.77}&zoom=11.5&populacao=regra_300`,
    {
      esperar: "Legenda",
      espera: 5000,
    },
  );
  await tela(p, "61-analises-3-30-300", "/analises?analise=regra_300_por_bairro", {
    esperar: /Konijnendijk/,
    espera: 3000,
  });
  // Linha do tempo: uma data passada (9 meses atrás), quando havia menos árvores cadastradas e
  // outras condições; a semeadura espalha as datas de cadastro em ~18 meses (SINTÉTICO).
  const mesPassado = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 9);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  await tela(
    p,
    "53-mapa-linha-tempo",
    `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6&ate=${mesPassado}`,
    { esperar: /Situação em/, espera: 7000 },
  );
  await tela(
    p,
    "54-mapa-comparar",
    `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6&ate=${mesPassado}&comparar=1`,
    { esperar: "Hoje", espera: 8000 },
  );
  // Detecção automática (dados do simulador, declarados como sintéticos).
  await tela(p, "55-deteccoes-lote", `/inventario/deteccoes/${ids.lote_deteccao}`, {
    esperar: "Recusas e avisos",
    espera: 4000,
    inteira: true,
  });
  await tela(p, "56-arvore-detectada", `/inventario/arvores/${ids.arvore_detectada}`, {
    esperar: "Detecção automática",
    espera: 3000,
  });
  await tela(
    p,
    "57-mapa-deteccoes",
    `/mapa?lon=${ids.det_lon}&lat=${ids.det_lat}&zoom=17&plantio=1`,
    { esperar: "Legenda", espera: 6000 },
  );
  await tela(p, "41-analises-mudas", "/analises?analise=mudas_doadas_por_especie", {
    esperar: /Ressalvas/,
    espera: 2500,
  });
  await ctx.close();

  // Segunda passada, de celular (390 px): menu em gaveta, mapa com folha de camadas, listas em
  // cartões e fichas em coluna única. Os nomes começam com "m" (SO=m gera só estas).
  ({ ctx, p } = await entrar(nav, "gestor@itree.local", "gestor", CELULAR));
  await tela(p, "m01-visao-geral", "/visao-geral", {
    esperar: "Como é calculado",
    espera: 4000,
    inteira: true,
  });
  await tela(p, "m02-mapa", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6`, {
    esperar: "Legenda",
    espera: 5000,
  });
  await tela(p, "m03-mapa-camadas", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6`, {
    esperar: "Legenda",
    espera: 3000,
    acao: async (q) => {
      await q.getByRole("button", { name: "Camadas e filtros" }).click();
      await q.getByRole("complementary", { name: "Camadas e filtros" }).waitFor();
    },
  });
  await tela(p, "m04-arvores", "/inventario/arvores", { esperar: /ARV-/ });
  await tela(p, "m05-arvore-ficha", `/inventario/arvores/${ids.arvore_foto}`, {
    esperar: "Resumo",
    espera: 2500,
    inteira: true,
  });
  await tela(p, "m06-inspecao-revisao", `/inspecoes/${ids.inspecao}`, {
    esperar: /INS-/,
    espera: 2000,
  });
  await tela(p, "m07-menu", "/visao-geral", {
    esperar: "Como é calculado",
    espera: 1000,
    acao: async (q) => {
      await q.getByRole("button", { name: "Abrir menu" }).click();
      await q.getByRole("dialog", { name: "Menu de navegação" }).waitFor();
    },
  });
  await tela(p, "m08-bairro", `/bairros/${ids.bairro_demo_id}`, {
    esperar: "Indicadores do bairro",
    espera: 6000,
    inteira: true,
  });
  // Assistente de importação em tela cheia, no passo 2 (correspondência de colunas).
  await tela(p, "m09-importacao-nova", "/inventario/importacoes", {
    esperar: /inventario-sintetico/,
    acao: async (q) => {
      await q
        .getByRole("button", { name: /Nova importação|Importar/ })
        .first()
        .click();
      const dialogo = q.getByRole("dialog");
      await dialogo
        .locator('input[type="file"]')
        .setInputFiles(path.join(__dirname, "inventario-exemplo.csv"));
      await dialogo.getByLabel(/Fonte dos dados/).fill("Inventário de exemplo");
      await dialogo.getByRole("button", { name: "Próximo" }).click();
      await dialogo.getByText("Correspondência de colunas").waitFor();
    },
    espera: 1500,
  });
  // Lista em cartões com dois cartões marcados: a barra de ações em lote fica fixa no rodapé.
  await tela(p, "m11-arvores-selecao", "/inventario/arvores", {
    esperar: /ARV-/,
    acao: async (q) => {
      const caixas = q.getByRole("checkbox", { name: /^Selecionar ARV-/ });
      await caixas.nth(0).check();
      await caixas.nth(1).check();
      await q.getByRole("region", { name: "Ações da seleção" }).waitFor();
    },
    espera: 800,
  });
  await ctx.close();

  // Administração em cartões, no celular (só o administrador entra).
  ({ ctx, p } = await entrar(nav, "admin@itree.local", "admin", CELULAR));
  await tela(p, "m10-admin-usuarios", "/administracao/usuarios", { esperar: "Clara Campos" });
  await ctx.close();

  ({ ctx, p } = await entrar(nav, "admin@itree.local", "admin"));
  await tela(p, "23-admin-usuarios", "/administracao/usuarios", { esperar: "Clara Campos" });
  await tela(p, "24-admin-usuario-detalhe", `/administracao/usuarios/${ids.usuario}`, {
    esperar: "Clara Campos",
  });
  await tela(p, "25-admin-equipes", "/administracao/equipes", {
    esperar: "Equipe de Arborização Leste",
  });
  await tela(p, "26-admin-territorios", "/administracao/territorios", {
    esperar: /Bairro/,
  });
  await tela(p, "27-admin-especies", "/administracao/especies", { esperar: "Licania tomentosa" });
  await tela(p, "28-admin-tipos-ocorrencia", "/administracao/tipos-ocorrencia", {
    esperar: "Galho caído",
  });
  await tela(p, "29-admin-integracoes", "/administracao/integracoes", { esperar: /novos/ });
  await tela(p, "30-admin-auditoria", "/administracao/auditoria", { espera: 2500 });
  await nav.close();
})();
