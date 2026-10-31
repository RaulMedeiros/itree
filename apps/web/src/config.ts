const env = import.meta.env;

export const config = {
  urlApi: env.VITE_API_URL ?? "",
  oidc: {
    authority: env.VITE_OIDC_AUTHORITY ?? "http://localhost:8080/realms/itree",
    clientId: env.VITE_OIDC_CLIENT_ID ?? "itree-web",
  },
  mostrarModulosFuturos: env.VITE_MOSTRAR_MODULOS_FUTUROS === "true",
};
