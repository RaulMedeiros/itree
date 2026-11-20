import { useArvoresFotos, type Arvore, type FotoArvore } from "@itree/api-client";
import { Columns2, ImagePlus } from "lucide-react";
import { useState } from "react";

import { Botao } from "../ui/botao";
import { Dialogo } from "../ui/dialogo";
import { Carregando, Erro, Vazio } from "../ui/estados";
import { cn } from "../util/cn";
import { formatarData } from "../util/formatos";
import { ComparadorFotos } from "./ComparadorFotos";
import { altDaFoto, rotuloOrigem, urlDaGrade } from "./galeriaArvore";
import { SeloIlustracao } from "./selos";
import { VisualizadorFotos } from "./VisualizadorFotos";
import { ImagemEspecie } from "./especies";

/**
 * Galeria da árvore: todas as fotos (da árvore, das inspeções, ocorrências e tarefas), da mais
 * antiga à mais recente, em mosaico de miniaturas. Abre o visualizador em tela cheia e, com duas
 * ou mais, oferece "Comparar". A imagem de referência da espécie fica ao lado, rotulada.
 */
export function GaleriaArvore({
  arvore,
  podeEditar,
  aoAdicionarFoto,
}: {
  arvore: Arvore;
  podeEditar: boolean;
  aoAdicionarFoto: () => void;
}) {
  const consulta = useArvoresFotos(arvore.id);
  const [aberta, setAberta] = useState<number | null>(null);
  const [comparando, setComparando] = useState(false);
  const fotos: FotoArvore[] = consulta.isSuccess ? consulta.data.data : [];

  return (
    <section aria-labelledby="titulo-galeria" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-galeria" className="font-semibold">
          Fotos da árvore
          {fotos.length > 0 && (
            <span className="ml-2 text-sm font-normal text-texto-suave">({fotos.length})</span>
          )}
        </h2>
        <div className="flex gap-2">
          {fotos.length >= 2 && (
            <Botao variante="secundario" tamanho="pequeno" onClick={() => setComparando(true)}>
              <Columns2 /> Comparar
            </Botao>
          )}
          {podeEditar && fotos.length > 0 && (
            <Botao variante="secundario" tamanho="pequeno" onClick={aoAdicionarFoto}>
              <ImagePlus /> Adicionar foto
            </Botao>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          {consulta.isPending ? (
            <Carregando linhas={3} />
          ) : consulta.isError ? (
            <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
          ) : fotos.length === 0 ? (
            <Vazio
              titulo="Esta árvore ainda não tem fotos"
              acao={
                podeEditar ? (
                  <Botao onClick={aoAdicionarFoto}>
                    <ImagePlus /> Adicionar foto
                  </Botao>
                ) : undefined
              }
            >
              As fotos da árvore, das inspeções e das ocorrências ligadas a ela aparecem aqui, em
              ordem cronológica.
            </Vazio>
          ) : (
            <ul className="grid auto-rows-[7rem] grid-cols-2 gap-2 sm:auto-rows-[8.5rem] sm:grid-cols-3 xl:grid-cols-4">
              {fotos.map((f, i) => (
                <li
                  key={f.id}
                  className={cn(
                    "relative overflow-hidden rounded-lg border border-borda bg-fundo",
                    i % 7 === 0 && "col-span-2 row-span-2",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setAberta(i)}
                    aria-label={`Abrir foto de ${formatarData(f.data)}, ${rotuloOrigem(f)}${f.descricao ? `: ${f.descricao}` : ""}`}
                    className="group block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-marca"
                  >
                    <img
                      src={urlDaGrade(f)}
                      alt={altDaFoto(f, arvore.codigo)}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1 text-[11px] text-white">
                      <span>{formatarData(f.data)}</span>
                      <span className="truncate">{f.origem_codigo}</span>
                    </span>
                  </button>
                  {f.ilustrativa && <SeloIlustracao className="absolute top-1.5 left-1.5" />}
                </li>
              ))}
            </ul>
          )}
        </div>

        <ReferenciaEspecie arvore={arvore} />
      </div>

      <VisualizadorFotos
        fotos={fotos}
        indice={aberta}
        codigoArvore={arvore.codigo}
        aoMudar={setAberta}
      />
      <Dialogo
        aberto={comparando && fotos.length >= 2}
        aoMudar={setComparando}
        titulo="Comparar fotos"
        descricao="Escolha duas fotos para ver a evolução da árvore."
        largura="max-w-5xl"
      >
        {fotos.length >= 2 && <ComparadorFotos fotos={fotos} codigoArvore={arvore.codigo} />}
      </Dialogo>
    </section>
  );
}

/** Imagem de referência da espécie: pequena, com o aviso de que não é esta árvore e a atribuição. */
function ReferenciaEspecie({ arvore }: { arvore: Arvore }) {
  const especie = arvore.especie_cartao;
  if (!especie?.imagem_url) return null;
  return (
    <aside
      aria-label="Referência da espécie"
      className="flex flex-col gap-2 self-start rounded-lg border border-borda bg-superficie p-3"
    >
      <p className="text-xs font-medium text-texto-suave">
        Imagem de referência da espécie (não é esta árvore)
      </p>
      <ImagemEspecie especie={especie} credito="completo" className="aspect-[4/3] w-full rounded" />
      <p className="text-xs text-texto-suave italic">{especie.nome_cientifico}</p>
    </aside>
  );
}
