import { defineConfig } from "orval";

export default defineConfig({
  itree: {
    input: "./openapi.yaml",
    output: {
      mode: "tags-split",
      target: "./src/gerado/endpoints.ts",
      schemas: "./src/gerado/modelos",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      override: {
        mutator: { path: "./src/cliente.ts", name: "requisicao" },
        query: { signal: true },
      },
    },
  },
});
