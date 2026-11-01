// Captura as telas do painel com os dados sintéticos de semear.py.
// Uso: node capturar.js <ids.json> <diretório de saída>   (ver README.md)
// SO=01,05 limita às capturas cujo nome começa com esses prefixos.
const { chromium } = require("playwright");
const path = require("path");
const ids = require(path.resolve(process.argv[2]));
const BASE = "http://localhost:8088";
const SAIDA = process.argv[3];

async function entrar(nav, email, senha) {
  const ctx = await nav.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Fortaleza",
  });
  // Tiles do mapa base não são acessíveis neste ambiente: responde vazio em vez de esperar o timeout.
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: "" }));
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
    await p.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: inteira });
    console.log("ok", nome, "—", await p.title());
  } catch (e) {
    console.log("FALHOU", nome, e.message.split("\n")[0]);
  }
}

(async () => {
  const nav = await chromium.launch();
  let { ctx, p } = await entrar(nav, "gestor@itree.local", "gestor");

  await tela(p, "01-visao-geral", "/visao-geral", { esperar: "Como é calculado" });
  await tela(p, "02-mapa", `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6`, {
    esperar: "Legenda",
    espera: 5000,
  });
  await tela(
    p,
    "03-mapa-selecao",
    `/mapa?lon=${ids.lon}&lat=${ids.lat}&zoom=17&selecao=arvore:${ids.arvore}`,
    { esperar: "Legenda", espera: 5000 },
  );
  await tela(
    p,
    "04-mapa-alertas-tarefas",
    `/mapa?lon=${-38.535}&lat=${-3.745}&zoom=14.6&alertas=1&tarefas=1&ocorrencias=0`,
    { esperar: "Legenda", espera: 5000 },
  );
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
  await tela(p, "10-arvore-sugestao-ia", `/inventario/arvores/${ids.arvore_ia}`, {
    esperar: "Resumo",
    acao: (q) => q.getByRole("tab", { name: /Sugestões de IA/ }).click(),
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
        .getByLabel(/Arquivo/)
        .setInputFiles(path.join(__dirname, "inventario-exemplo.csv"));
    },
    espera: 2500,
  });
  await tela(p, "13-duplicidades", "/inventario/duplicidades", { espera: 2500 });
  await tela(p, "14-qualidade", "/inventario/qualidade", {
    esperar: "Medidas fora da faixa plausível",
    inteira: true,
  });
  await tela(
    p,
    "15-ocorrencias",
    "/ocorrencias?estado=aberta,em_triagem,encaminhada,em_atendimento,concluida,cancelada",
    { esperar: /OCO-/ },
  );
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
    esperar: "Bairro de teste A",
  });
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
    esperar: "Bairro de teste A",
  });
  await tela(p, "27-admin-especies", "/administracao/especies", { esperar: "Licania tomentosa" });
  await tela(p, "28-admin-tipos-ocorrencia", "/administracao/tipos-ocorrencia", {
    esperar: "Galho caído",
  });
  await tela(p, "29-admin-integracoes", "/administracao/integracoes", { esperar: /novos/ });
  await tela(p, "30-admin-auditoria", "/administracao/auditoria", { espera: 2500 });
  await nav.close();
})();
