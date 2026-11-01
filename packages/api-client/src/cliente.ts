/**
 * Cliente HTTP usado por todo o código gerado pelo Orval.
 *
 * O aplicativo (web ou móvel) chama `configurarCliente` uma vez com a URL da
 * API, uma função que devolve o token OIDC atual e a origem do canal, que vai
 * para a auditoria (RN-PROV-002).
 */

export type Origem = "web" | "app";

interface Configuracao {
  urlBase: string;
  obterToken: () => string | undefined | Promise<string | undefined>;
  origem: Origem;
  aoNaoAutenticado?: () => void;
}

let configuracao: Configuracao = {
  urlBase: "",
  obterToken: () => undefined,
  origem: "web",
};

export function configurarCliente(nova: Configuracao): void {
  configuracao = nova;
}

/** Erro de API com status e corpo já interpretado (mensagens de validação do DRF). */
export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    public readonly corpo: unknown,
  ) {
    super(mensagemDoCorpo(status, corpo));
    this.name = "ErroApi";
  }

  /** Erros por campo, no formato do Django REST Framework. */
  get errosDeCampo(): Record<string, string[]> {
    if (this.corpo && typeof this.corpo === "object" && !Array.isArray(this.corpo)) {
      const saida: Record<string, string[]> = {};
      for (const [campo, valor] of Object.entries(this.corpo)) {
        if (campo === "detail") continue;
        saida[campo] = Array.isArray(valor) ? valor.map(String) : [String(valor)];
      }
      return saida;
    }
    return {};
  }
}

function mensagemDoCorpo(status: number, corpo: unknown): string {
  if (corpo && typeof corpo === "object" && "detail" in corpo) {
    return String((corpo as { detail: unknown }).detail);
  }
  if (status === 0) return "Não foi possível conectar ao servidor.";
  if (status >= 500) return "O servidor encontrou um erro. Tente novamente em instantes.";
  if (status === 400) return "Há campos com problemas. Revise e tente novamente.";
  return `Erro ${status}`;
}

export async function requisicao<T>(url: string, opcoes: RequestInit = {}): Promise<T> {
  const token = await configuracao.obterToken();
  const cabecalhos = new Headers(opcoes.headers);
  cabecalhos.set("Accept", "application/json");
  cabecalhos.set("X-Itree-Origem", configuracao.origem);
  if (token) cabecalhos.set("Authorization", `Bearer ${token}`);

  let resposta: Response;
  try {
    resposta = await fetch(`${configuracao.urlBase}${url}`, { ...opcoes, headers: cabecalhos });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    throw new ErroApi(0, null);
  }

  const texto = await resposta.text();
  const corpo: unknown = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    if (resposta.status === 401) configuracao.aoNaoAutenticado?.();
    throw new ErroApi(resposta.status, corpo);
  }
  return { data: corpo, status: resposta.status, headers: resposta.headers } as T;
}

/**
 * Baixa um arquivo binário da API (exportações, PDF) com a mesma autenticação
 * do cliente gerado, e entrega ao navegador para salvar.
 */
export async function baixarArquivo(
  caminho: string,
  parametros: Record<string, string | undefined> = {},
): Promise<{ nome: string; tamanho: number }> {
  const token = await configuracao.obterToken();
  const qs = new URLSearchParams(
    Object.entries(parametros).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
  );
  const cabecalhos = new Headers({ "X-Itree-Origem": configuracao.origem });
  if (token) cabecalhos.set("Authorization", `Bearer ${token}`);
  const resposta = await fetch(`${configuracao.urlBase}${caminho}?${qs}`, { headers: cabecalhos });
  if (!resposta.ok) {
    const texto = await resposta.text();
    throw new ErroApi(resposta.status, texto ? JSON.parse(texto) : null);
  }
  const blob = await resposta.blob();
  const nome =
    /filename="([^"]+)"/.exec(resposta.headers.get("Content-Disposition") ?? "")?.[1] ?? "arquivo";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { nome, tamanho: blob.size };
}
