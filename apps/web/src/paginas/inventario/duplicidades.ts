import type { ArvoreResumo } from "@itree/api-client";
import { ROTULOS_ESTADO_ESPECIE, ROTULOS_ORIGEM_LOCALIZACAO } from "@itree/domain";

import { nomeEspecie } from "../../componentes/selos";
import { formatarDataHora } from "../../util/formatos";

export type CampoFicha = "especie" | "identificacao" | "localizacao" | "endereco" | "cadastro";

export const rotuloLocalizacao = (a: ArvoreResumo) =>
  a.localizacao_origem
    ? (ROTULOS_ORIGEM_LOCALIZACAO[
        a.localizacao_origem as keyof typeof ROTULOS_ORIGEM_LOCALIZACAO
      ] ?? a.localizacao_origem)
    : "Sem localização";

/** Valor comparável de cada campo: dois registros "diferem" quando o texto muda. */
export const VALORES: Record<CampoFicha, (a: ArvoreResumo) => string> = {
  especie: (a) => nomeEspecie(a),
  identificacao: (a) => ROTULOS_ESTADO_ESPECIE[a.especie_estado ?? "nao_identificada"],
  localizacao: (a) =>
    `${rotuloLocalizacao(a)}${a.precisao_m ? ` · ±${Math.round(a.precisao_m)} m` : ""}`,
  endereco: (a) => a.endereco || "Sem endereço",
  cadastro: (a) => formatarDataHora(a.criado_em) ?? "—",
};

export const ROTULOS_CAMPO: Record<CampoFicha, string> = {
  especie: "Espécie",
  identificacao: "Identificação",
  localizacao: "Localização",
  endereco: "Endereço",
  cadastro: "Cadastrada em",
};

/** Campos em que os dois registros têm valores diferentes. */
export function camposDiferentes(a: ArvoreResumo, b: ArvoreResumo): CampoFicha[] {
  return (Object.keys(VALORES) as CampoFicha[]).filter((c) => VALORES[c](a) !== VALORES[c](b));
}
