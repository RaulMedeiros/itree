import type { TerritorioResumo } from "@itree/api-client";
import { useCallback, useSyncExternalStore } from "react";

import { useUsuario } from "../acesso/ContextoUsuario";

/**
 * Território ativo (RF-SHELL-002): preferência local de quem tem mais de um território no
 * escopo. Vira o filtro de bairro das telas que ainda não têm `bairro` na URL; o que está na
 * URL sempre vale mais, para o link compartilhado mostrar o mesmo que quem o enviou.
 */
const ouvintes = new Set<() => void>();

const chave = (usuarioId: string) => `itree:territorio-ativo:${usuarioId}`;

function ler(usuarioId: string): string | null {
  try {
    return localStorage.getItem(chave(usuarioId));
  } catch {
    return null;
  }
}

function gravar(usuarioId: string, id: string | undefined) {
  try {
    if (id) localStorage.setItem(chave(usuarioId), id);
    else localStorage.removeItem(chave(usuarioId));
  } catch {
    // Sem armazenamento local (janela privada): a escolha vale só até recarregar.
  }
  ouvintes.forEach((f) => f());
}

/** Só há seletor quando o escopo tem mais de um território. */
export function temSeletorDeTerritorio(territorios: readonly TerritorioResumo[]): boolean {
  return territorios.length > 1;
}

/**
 * O território salvo só vale se ainda estiver no escopo e não for o município: o município é
 * "tudo", isto é, nenhum filtro de bairro.
 */
export function territorioAtivoValido(
  territorios: readonly TerritorioResumo[],
  salvo: string | null | undefined,
): string | undefined {
  if (!salvo || !temSeletorDeTerritorio(territorios)) return undefined;
  return territorios.some((t) => t.id === salvo && t.tipo !== "municipio") ? salvo : undefined;
}

export function useTerritorioAtivo(): {
  /** ID do bairro ativo, ou `undefined` para todo o escopo. */
  id: string | undefined;
  definir: (id: string | undefined) => void;
} {
  const eu = useUsuario();
  const salvo = useSyncExternalStore(
    (aviso) => {
      ouvintes.add(aviso);
      return () => ouvintes.delete(aviso);
    },
    () => ler(eu.id),
    () => null,
  );
  const definir = useCallback((id: string | undefined) => gravar(eu.id, id), [eu.id]);
  return { id: territorioAtivoValido(eu.territorios, salvo), definir };
}

/** Bairro efetivo de uma tela: o da URL, se houver; senão o território ativo do cabeçalho. */
export function useBairroDoFiltro(daUrl: string | undefined): {
  bairro: string | undefined;
  /** Avisar o cabeçalho quando a pessoa escolhe outro bairro no filtro da própria tela. */
  aoEscolher: (id: string) => void;
} {
  const ativo = useTerritorioAtivo();
  return { bairro: daUrl ?? ativo.id, aoEscolher: (id) => ativo.definir(id || undefined) };
}
