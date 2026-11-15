import type { PosteProximo } from "@itree/api-client";

import { capitalizar } from "../mapa/iluminacao";
import { descricaoDoPoste, formatarDistancia } from "../paginas/inventario/iluminacao";

/**
 * Poste de iluminação pública mais próximo (até 15 m), em texto: tipo e altura, distância e
 * código do ponto na fonte. Só descreve o dado da SEINF; não diz que há conflito.
 */
export function PosteMaisProximo({ poste }: { poste: PosteProximo }) {
  return (
    <>
      <span data-testid="poste-mais-proximo">
        {descricaoDoPoste(poste)} · a {formatarDistancia(poste.distancia_m)}
      </span>
      <p className="text-xs text-texto-suave">
        Ponto {poste.codigo}
        {poste.logradouro ? ` · ${capitalizar(poste.logradouro)}` : ""} · Prefeitura de Fortaleza,
        SEINF, dados abertos (CC BY-SA)
      </p>
    </>
  );
}
