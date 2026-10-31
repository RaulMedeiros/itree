import { useTerritoriosListar, useUsuariosListar } from "@itree/api-client";
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
  return { opcoes, carregando: consulta.isPending, erro: consulta.error };
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
