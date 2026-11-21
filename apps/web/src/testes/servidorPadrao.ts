import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const API = "http://api.teste";

/**
 * Respostas-padrão do que o shell pede em qualquer tela (o sino de notificações). Ficam depois
 * dos handlers de cada teste, que sempre ganham, e evitam um aviso de requisição sem
 * tratamento em cada arquivo que renderiza o shell.
 */
export const handlersPadrao = [
  http.get(`${API}/api/v1/notificacoes/contagem`, () => HttpResponse.json({ nao_lidas: 0 })),
  http.get(`${API}/api/v1/notificacoes/agrupadas`, () => HttpResponse.json([])),
  // Conectores (RF-INT-006): lista vazia para quem administra e nenhuma camada de referência.
  http.get(`${API}/api/v1/conectores`, () => HttpResponse.json([])),
  // Fontes de população e renda (aviso de fonte desatualizada do cabeçalho): sem problema.
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      iluminacao: null,
      populacao: [],
      arvores: null,
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/mapa/camadas-referencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/notificacoes`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
];

/** `setupServer` com os handlers do teste e, por último, os padrões do shell. */
export const criarServidor = (...handlers: Parameters<typeof setupServer>) =>
  setupServer(...handlers, ...handlersPadrao);
