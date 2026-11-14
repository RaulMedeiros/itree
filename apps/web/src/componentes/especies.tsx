import type { EspecieCartao } from "@itree/api-client";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Leaf } from "lucide-react";
import { useState } from "react";

import { cn } from "../util/cn";

interface ComImagem {
  nome_cientifico: string;
  nomes_comuns?: string[];
  imagem_url?: string;
  imagem_autor?: string;
  imagem_licenca?: string;
  imagem_licenca_url?: string;
  imagem_pagina_url?: string;
  imagem_fonte?: string;
}

/** Origem em relação ao Brasil, sem supor quando o catálogo não informa. */
function rotuloOrigem(nativa: boolean | null | undefined) {
  if (nativa === true)
    return { texto: "Nativa do Brasil", classe: "bg-sucesso-clara text-sucesso" };
  if (nativa === false) return { texto: "Exótica", classe: "bg-neutro-clara text-neutro" };
  return { texto: "Origem não informada", classe: "bg-neutro-clara text-neutro" };
}

export function SeloOrigem({ nativa }: { nativa: boolean | null | undefined }) {
  const o = rotuloOrigem(nativa);
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium", o.classe)}>
      {o.texto}
    </span>
  );
}

/** Marcador neutro, igual em todo lugar, para a espécie sem imagem (ou com imagem que falhou). */
export function MarcadorSemImagem({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 bg-marca-clara text-marca-escura/70",
        className,
      )}
    >
      <Leaf className="size-7" aria-hidden />
      <span className="text-xs">Sem imagem de referência</span>
    </div>
  );
}

function textoAlt(e: ComImagem) {
  const comuns = e.nomes_comuns?.filter(Boolean).join(", ");
  return comuns ? `${e.nome_cientifico} (${comuns})` : e.nome_cientifico;
}

/** Autoria, licença (com link) e fonte (com link) da imagem: nada é exibido sem atribuição. */
export function AtribuicaoImagem({
  especie,
  className,
}: {
  especie: ComImagem;
  className?: string;
}) {
  const fonte = especie.imagem_fonte || "Wikimedia Commons";
  return (
    <p className={cn("text-xs text-texto-suave", className)}>
      Foto: {especie.imagem_autor || "autor não informado"}
      {especie.imagem_licenca && (
        <>
          {" · Licença: "}
          {especie.imagem_licenca_url ? (
            <a
              href={especie.imagem_licenca_url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {especie.imagem_licenca}
            </a>
          ) : (
            especie.imagem_licenca
          )}
        </>
      )}
      {" · Fonte: "}
      {especie.imagem_pagina_url ? (
        <a href={especie.imagem_pagina_url} target="_blank" rel="noreferrer" className="underline">
          {fonte}
        </a>
      ) : (
        fonte
      )}
    </p>
  );
}

/**
 * Imagem de referência da espécie (Wikimedia Commons ou GBIF). O recipiente tem
 * sempre o tamanho dado por `className`: sem imagem, ou se ela falhar ao
 * carregar (limite de taxa, rede), aparece o marcador neutro no mesmo espaço.
 * `credito`: "completo" mostra a atribuição abaixo da imagem (detalhe),
 * "sobreposto" a mostra em uma faixa sobre ela, "nenhum" a omite (miniatura de
 * cartão, cuja atribuição fica no detalhe).
 */
export function ImagemEspecie({
  especie,
  className,
  credito = "sobreposto",
}: {
  especie: ComImagem;
  className?: string;
  credito?: "completo" | "sobreposto" | "nenhum";
}) {
  const [falhouEm, setFalhouEm] = useState<string | null>(null);
  if (!especie.imagem_url || falhouEm === especie.imagem_url)
    return <MarcadorSemImagem className={className} />;
  const imagem = (
    <img
      src={especie.imagem_url}
      alt={textoAlt(especie)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="size-full object-cover"
      onError={() => setFalhouEm(especie.imagem_url ?? null)}
    />
  );
  if (credito === "completo")
    return (
      <figure className="flex flex-col gap-1.5">
        <div className={cn("overflow-hidden bg-fundo", className)}>{imagem}</div>
        <figcaption>
          <AtribuicaoImagem especie={especie} />
        </figcaption>
      </figure>
    );
  return (
    <figure className={cn("relative overflow-hidden bg-fundo", className)}>
      {imagem}
      {credito === "sobreposto" && (
        <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-0.5 text-[10px] text-white">
          {especie.imagem_autor || "Autor não informado"} · {especie.imagem_licenca} ·{" "}
          <a
            href={especie.imagem_pagina_url || undefined}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {especie.imagem_fonte || "Wikimedia Commons"}
          </a>
        </figcaption>
      )}
    </figure>
  );
}

export function LinkExterno({ href, children }: { href?: string; children: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-marca-escura hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  );
}

/** Cartão da espécie na ficha da árvore. */
export function CartaoEspecie({ especie }: { especie: EspecieCartao }) {
  return (
    <section className="overflow-hidden rounded-lg border border-borda bg-superficie">
      {especie.imagem_url && <ImagemEspecie especie={especie} className="aspect-[16/9] w-full" />}
      <div className="flex flex-col gap-2 p-4 text-sm">
        <div>
          <p className="flex items-center gap-1.5 font-semibold italic">
            {!especie.imagem_url && <Leaf className="size-4 text-marca" aria-hidden />}
            {especie.nome_cientifico}
          </p>
          <p className="text-texto-suave">
            {[especie.nomes_comuns?.join(", "), especie.familia].filter(Boolean).join(" · ") ||
              "Nomes comuns não cadastrados"}
          </p>
        </div>
        <div>
          <SeloOrigem nativa={especie.nativa_brasil} />
        </div>
        {especie.wikipedia_descricao && (
          <p className="text-texto-suave">{especie.wikipedia_descricao}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            to="/inventario/especies/$id"
            params={{ id: especie.id }}
            className="text-marca-escura hover:underline"
          >
            Ver no catálogo
          </Link>
          <LinkExterno href={especie.wikipedia_url}>Wikipedia</LinkExterno>
          <LinkExterno href={especie.flora_brasil_url}>Flora e Funga do Brasil</LinkExterno>
        </div>
      </div>
    </section>
  );
}
