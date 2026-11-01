import {
  getEspeciesListarQueryKey,
  getEspeciesObterQueryKey,
  useEspeciesAtualizarReferencias,
  useEspeciesListar,
  useEspeciesObter,
  type Especie,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw, Search, TreeDeciduous } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { ImagemEspecie, LinkExterno, SeloOrigem } from "../../componentes/especies";
import { Botao } from "../../ui/botao";
import { Entrada } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { formatarDataHora } from "../../util/formatos";

export interface BuscaEspecies {
  busca?: string;
  todas?: "1";
}

const LICENCA_WIKIPEDIA = "https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br";

/** Catálogo de espécies (M-01): o que há no território e onde saber mais. */
export function EspeciesCatalogoPagina() {
  const filtros = useSearch({ from: "/autenticado/inventario/especies" });
  const navegar = useNavigate({ from: "/inventario/especies" });
  const [busca, setBusca] = useState(filtros.busca ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.busca ?? ""))
        void navegar({ search: (s: BuscaEspecies) => ({ ...s, busca: busca || undefined }) });
    }, 300);
    return () => clearTimeout(t);
  }, [busca, filtros.busca, navegar]);

  const consulta = useEspeciesListar({
    busca: filtros.busca,
    ativa: true,
    com_arvores: filtros.todas ? undefined : true,
    ordem: "arvores",
    tamanho: 200,
  });

  return (
    <>
      <CabecalhoPagina
        titulo="Espécies"
        descricao="Espécies do catálogo, com as árvores do seu escopo e referências externas (Wikipedia, Wikimedia Commons, GBIF)."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-80">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-suave"
            aria-hidden
          />
          <Entrada
            type="search"
            aria-label="Buscar espécie"
            placeholder="Nome científico, nome comum ou família"
            className="pl-8"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-marca"
            checked={!!filtros.todas}
            onChange={(e) =>
              void navegar({
                search: (s: BuscaEspecies) => ({ ...s, todas: e.target.checked ? "1" : undefined }),
              })
            }
          />
          Incluir espécies sem árvores no meu escopo
        </label>
      </div>

      {consulta.isPending ? (
        <Carregando linhas={6} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.results.length === 0 ? (
        <Vazio titulo="Nenhuma espécie encontrada">
          Ajuste a busca ou inclua as espécies sem árvores no seu escopo.
        </Vazio>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {consulta.data.data.results.map((e) => (
            <li key={e.id}>
              <CartaoCatalogo especie={e} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CartaoCatalogo({ especie }: { especie: Especie }) {
  const arvores = especie.arvores_no_escopo ?? 0;
  return (
    <Link
      to="/inventario/especies/$id"
      params={{ id: especie.id }}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-borda bg-superficie shadow-sm transition hover:border-marca hover:shadow-md"
    >
      <ImagemEspecie especie={especie} comCredito={false} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="font-semibold italic group-hover:text-marca-escura">
          {especie.nome_cientifico}
        </p>
        <p className="line-clamp-1 text-sm text-texto-suave">
          {especie.nomes_comuns?.join(", ") || "Nomes comuns não cadastrados"}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <SeloOrigem nativa={especie.nativa_brasil} />
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums">
            <TreeDeciduous className="size-3.5 text-marca" aria-hidden />
            {arvores.toLocaleString("pt-BR")} {arvores === 1 ? "árvore" : "árvores"}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function EspecieDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/inventario/especies/$id" });
  const consulta = useEspeciesObter(id);
  const podeAdministrar = usePermissao("admin.configuracao");
  const cliente = useQueryClient();
  const atualizar = useEspeciesAtualizarReferencias({
    mutation: {
      onSuccess: async () => {
        await cliente.invalidateQueries({ queryKey: getEspeciesObterQueryKey(id) });
        await cliente.invalidateQueries({ queryKey: getEspeciesListarQueryKey() });
      },
    },
  });

  if (consulta.isPending) return <Carregando linhas={8} />;
  if (consulta.isError)
    return <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />;
  const e = consulta.data.data;
  const arvores = e.arvores_no_escopo ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/inventario/especies"
        className="inline-flex w-fit items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Espécies
      </Link>
      <CabecalhoPagina
        titulo={e.nome_cientifico}
        descricao={[e.nomes_comuns?.join(", "), e.familia].filter(Boolean).join(" · ") || undefined}
        acoes={
          <>
            <Botao variante="secundario" asChild>
              <Link to="/inventario/arvores" search={{ especie: e.id }}>
                <TreeDeciduous /> Ver {arvores.toLocaleString("pt-BR")}{" "}
                {arvores === 1 ? "árvore" : "árvores"}
              </Link>
            </Botao>
            {podeAdministrar && (
              <Botao
                variante="secundario"
                disabled={atualizar.isPending}
                onClick={() => atualizar.mutate({ id: e.id })}
              >
                <RefreshCw className={atualizar.isPending ? "animate-spin" : ""} /> Atualizar
                referências
              </Botao>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <ImagemEspecie especie={e} className="aspect-[4/3] rounded-xl lg:col-span-2" />

        <section className="flex flex-col gap-3 rounded-xl border border-borda bg-superficie p-5 text-sm lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeloOrigem nativa={e.nativa_brasil} />
            {e.wikipedia_descricao && (
              <span className="text-texto-suave">{e.wikipedia_descricao}</span>
            )}
          </div>
          {e.wikipedia_resumo ? (
            <>
              <p className="leading-relaxed">{e.wikipedia_resumo}</p>
              <p className="text-xs text-texto-suave">
                Texto de “{e.wikipedia_titulo}”, Wikipédia (
                {e.wikipedia_idioma === "pt" ? "português" : "inglês"}), licença{" "}
                <a href={LICENCA_WIKIPEDIA} target="_blank" rel="noreferrer" className="underline">
                  CC BY-SA 4.0
                </a>
                . Não substitui a identificação por especialista.
              </p>
            </>
          ) : (
            <p className="text-texto-suave">
              {e.referencias_situacao === "nao_consultada"
                ? "As referências desta espécie ainda não foram consultadas."
                : e.referencias_situacao === "nao_encontradas"
                  ? "Nenhuma referência externa corresponde exatamente a este nome científico."
                  : "Sem resumo disponível."}
            </p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <LinkExterno href={e.wikipedia_url}>Wikipedia</LinkExterno>
            <LinkExterno href={e.wikidata_url}>Wikidata</LinkExterno>
            <LinkExterno href={e.gbif_url}>GBIF</LinkExterno>
            {e.imagem_licenca_url && (
              <LinkExterno
                href={e.imagem_licenca_url}
              >{`Licença da imagem (${e.imagem_licenca})`}</LinkExterno>
            )}
          </div>
        </section>
      </div>

      <section className="grid gap-4 rounded-xl border border-borda bg-superficie p-5 text-sm md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Catálogo municipal</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-texto-suave">Família</dt>
            <dd>{e.familia || "—"}</dd>
            <dt className="text-texto-suave">Nomes comuns</dt>
            <dd>{e.nomes_comuns?.join(", ") || "—"}</dd>
            <dt className="text-texto-suave">Origem</dt>
            <dd>
              <SeloOrigem nativa={e.nativa_brasil} />
            </dd>
            <dt className="text-texto-suave">Fonte taxonômica</dt>
            <dd>{e.fonte_taxonomica || "—"}</dd>
          </dl>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Referências externas</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-texto-suave">Situação</dt>
            <dd>{ROTULOS_SITUACAO[e.referencias_situacao ?? "nao_consultada"]}</dd>
            {e.referencias_mensagem && (
              <>
                <dt className="text-texto-suave">Observação</dt>
                <dd>{e.referencias_mensagem}</dd>
              </>
            )}
            <dt className="text-texto-suave">Consultadas em</dt>
            <dd>{formatarDataHora(e.referencias_consultadas_em) ?? "—"}</dd>
          </dl>
          <p className="mt-2 text-xs text-texto-suave">
            Só são aceitas referências cujo nome científico no Wikidata é idêntico ao do catálogo.
            Os dados do catálogo municipal não são alterados por elas.
          </p>
        </div>
      </section>
    </div>
  );
}

const ROTULOS_SITUACAO: Record<string, string> = {
  nao_consultada: "Ainda não consultadas",
  encontradas: "Encontradas",
  nao_encontradas: "Não encontradas",
  erro: "Erro na última consulta",
};
