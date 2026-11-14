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
  const descendentes = (pai: string): number =>
    (filhosDe.get(pai) ?? []).reduce((soma, f) => soma + 1 + descendentes(f.id), 0);
  // Com o território superior marcado, os de baixo já estão cobertos: somem da lista e o
  // superior leva uma nota única, em vez de repetir o aviso em cada filho (R3-28).
  const visitar = (pai: string | null, nivel: number) => {
    const filhos = [...(filhosDe.get(pai) ?? [])].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
    for (const t of filhos) {
      const cobertos = selecionados.includes(t.id) ? descendentes(t.id) : 0;
      resultado.push({
        valor: t.id,
        rotulo: t.nome,
        descricao: ROTULOS_TIPO_TERRITORIO[t.tipo],
        nivel,
        nota:
          cobertos > 0
            ? `Cobre também ${cobertos === 1 ? "o território" : `os ${cobertos} territórios`} abaixo dele`
            : undefined,
      });
      if (cobertos === 0) visitar(t.id, nivel + 1);
    }
  };
  visitar(null, 0);
  return resultado;
}
