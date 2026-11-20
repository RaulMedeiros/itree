import { useState } from "react";

import { useUsuario } from "../acesso/ContextoUsuario";
import { config } from "../config";
import { baseEfetiva, lerBaseLembrada } from "./baseLembrada";
import type { TipoBase } from "./estilo";

/** Base de mapa que a pessoa escolheu no mapa principal, para os mini-mapas das fichas. */
export function useBaseLembrada(): TipoBase {
  const usuario = useUsuario();
  const [lembrada] = useState(() => lerBaseLembrada(usuario.id));
  return baseEfetiva(undefined, lembrada, !!config.mapaSatelite);
}
