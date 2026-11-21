import {
  indicadoresArborizacaoEntornoGeojson,
  useBairrosListar,
  type Territorio,
} from "@itree/api-client";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo } from "react";

import { Entrada } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarValorCartao } from "./ficha";
import { MapaCoropletico } from "./MapaCoropletico";
import { filtrarBairros } from "./busca";

interface Colecao {
  features: { id?: string | number; properties: { valor?: number | null } }[];
}

const inteiro = new Intl.NumberFormat("pt-BR");

/** Lista dos bairros do escopo, com busca, mini-indicadores e o mapa coroplético. */
export function BairrosPagina() {
  const { busca = "" } = useSearch({ from: "/autenticado/bairros/" });
  const navegar = useNavigate();
  const lista = useBairrosListar();
  const censo = useQuery({
    queryKey: ["bairros-censo"],
    queryFn: () => indicadoresArborizacaoEntornoGeojson({ precisao: 4 }),
    staleTime: 5 * 60_000,
  });
  const valores = useMemo(() => {
    const mapa = new Map<string, number | null>();
    for (const f of (censo.data?.data as unknown as Colecao | undefined)?.features ?? [])
      mapa.set(String(f.id), f.properties.valor ?? null);
    return mapa;
  }, [censo.data]);

  const bairros: Territorio[] = lista.data?.data ?? [];
  const visiveis = filtrarBairros(bairros, busca);

  return (
    <div className="mx-auto max-w-6xl">
      <CabecalhoPagina
        titulo="Bairros"
        descricao="Os bairros do seu escopo. Abra a ficha de um bairro para ver tudo o que a plataforma sabe dele."
        migalhas={[{ rotulo: "Visão geral", para: "/visao-geral" }, { rotulo: "Bairros" }]}
      />
      {lista.isPending ? (
        <Carregando linhas={6} rotulo="Carregando os bairros…" />
      ) : lista.isError ? (
        <Erro erro={lista.error} aoTentarNovamente={() => void lista.refetch()} />
      ) : bairros.length === 0 ? (
        <Vazio titulo="Nenhum bairro no seu escopo">
          Os limites dos bairros são importados pela administração (Fortaleza em Mapas, Ipplan).
        </Vazio>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <div className="relative mb-3 max-w-sm">
              <Search
                className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-suave"
                aria-hidden
              />
              <Entrada
                type="search"
                aria-label="Buscar bairro"
                placeholder="Buscar bairro pelo nome"
                className="pl-8"
                value={busca}
                onChange={(e) =>
                  void navegar({
                    to: "/bairros",
                    search: { busca: e.target.value || undefined },
                    replace: true,
                  })
                }
              />
            </div>
            {visiveis.length === 0 ? (
              <Vazio titulo="Nenhum bairro com esse nome" />
            ) : (
              <Tabela>
                <thead>
                  <tr>
                    <Th>Bairro</Th>
                    <Th>Regional</Th>
                    <Th className="text-right">Árvores</Th>
                    <Th className="text-right" dica="Faces de quadra com árvore, Censo 2022 (IBGE)">
                      Entorno arborizado
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((b) => {
                    const valor = valores.get(b.id);
                    return (
                      <Linha key={b.id}>
                        <Td className="font-medium">
                          <Link
                            to="/bairros/$id"
                            params={{ id: b.id }}
                            className="text-marca-escura hover:underline"
                          >
                            {b.nome}
                          </Link>
                        </Td>
                        <Td className="text-texto-suave">{b.pai?.nome ?? "—"}</Td>
                        <Td className="text-right tabular-nums">
                          {inteiro.format(b.arvores_no_escopo ?? 0)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {valor === undefined || valor === null ? (
                            <span className="text-texto-suave">sem dado</span>
                          ) : (
                            formatarValorCartao({ valor, unidade: "%" })
                          )}
                        </Td>
                      </Linha>
                    );
                  })}
                </tbody>
              </Tabela>
            )}
            <p className="mt-2 text-xs text-texto-suave">
              {visiveis.length} de {bairros.length} bairros. Árvores: ativas no seu escopo
              (registros da plataforma). Entorno arborizado: IBGE, Censo 2022.
            </p>
          </div>
          <MapaCoropletico />
        </div>
      )}
    </div>
  );
}
