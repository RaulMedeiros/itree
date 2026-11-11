import { useTerritoriosListar, useUsuariosListar } from "@itree/api-client";
import type { TipoTerritorioEnum } from "@itree/api-client";
import { ROTULOS_TIPO_TERRITORIO } from "@itree/domain";

/** Territórios para seleção em formulários (lista curta: município, regionais, bairros). */
export function useOpcoesTerritorio() {
  const consulta = useTerritoriosListar({ tamanho: 500 });
  const opcoes =
    consulta.data?.data.results.map((t) => ({
      valor: t.id,
      rotulo: t.nome,
      descricao: ROTULOS_TIPO_TERRITORIO[t.tipo],
    })) ?? [];
  return {
    opcoes,
    territorios: consulta.data?.data.results ?? [],
    carregando: consulta.isPending,
    erro: consulta.error,
  };
}

export function useOpcoesUsuario(habilitado = true) {
  const consulta = useUsuariosListar(
    { tamanho: 500, ativo: true },
    { query: { enabled: habilitado } },
  );
  const usuarios = consulta.data?.data.results ?? [];
  return {
    usuarios,
    opcoes: usuarios.map((u) => ({ valor: u.id, rotulo: u.nome || u.email, descricao: u.email })),
    carregando: consulta.isPending,
  };
}

/**
 * Ordena os territórios em árvore (município, regionais, bairros) e recua os filhos.
 * Quando o pai de um território está marcado, o filho é redundante: o escopo é a união
 * das áreas (RF-ADM-002), e a opção avisa em vez de bloquear.
 */
export function organizarTerritorios(
  territorios: {
    id: string;
    nome: string;
    tipo: TipoTerritorioEnum;
    pai?: { id: string } | null;
  }[],
  selecionados: string[],
) {
  const ids = new Set(territorios.map((t) => t.id));
  const filhosDe = new Map<string | null, typeof territorios>();
  for (const t of territorios) {
    const chave = t.pai && ids.has(t.pai.id) ? t.pai.id : null;
    filhosDe.set(chave, [...(filhosDe.get(chave) ?? []), t]);
  }
  const resultado: {
    valor: string;
    rotulo: string;
    descricao: string;
    nivel: number;
    nota?: string;
  }[] = [];
  const visitar = (pai: string | null, nivel: number, paiMarcado: boolean) => {
    const filhos = [...(filhosDe.get(pai) ?? [])].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
    for (const t of filhos) {
      resultado.push({
        valor: t.id,
        rotulo: t.nome,
        descricao: ROTULOS_TIPO_TERRITORIO[t.tipo],
        nivel,
        nota: paiMarcado ? "Já coberto pelo território superior marcado" : undefined,
      });
      visitar(t.id, nivel + 1, paiMarcado || selecionados.includes(t.id));
    }
  };
  visitar(null, 0, false);
  return resultado;
}
