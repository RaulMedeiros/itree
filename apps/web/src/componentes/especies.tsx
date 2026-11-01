import type { EspecieCartao } from "@itree/api-client";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Leaf } from "lucide-react";

import { cn } from "../util/cn";

interface ComImagem {
  nome_cientifico: string;
  imagem_url?: string;
  imagem_autor?: string;
  imagem_licenca?: string;
  imagem_pagina_url?: string;
}

/** Origem em relação ao Brasil, sem supor quando o catálogo não informa. */
function rotuloOrigem(nativa: boolean | null | undefined) {
  if (nativa === true)
    return { texto: "Nativa do Brasil", classe: "bg-sucesso-clara text-sucesso" };
  if (nativa === false) return { texto: "Exótica", classe: "bg-atencao-clara text-atencao" };
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

/** Imagem do Wikimedia Commons com autoria e licença sempre visíveis. */
export function ImagemEspecie({
  especie,
  className,
  comCredito = true,
}: {
  especie: ComImagem;
  className?: string;
  comCredito?: boolean;
}) {
  if (!especie.imagem_url)
    return (
      <div
        className={cn("flex items-center justify-center bg-marca-clara text-marca/50", className)}
        aria-hidden
      >
        <Leaf className="size-10" />
      </div>
    );
  return (
    <figure className={cn("relative overflow-hidden bg-fundo", className)}>
      <img
        src={especie.imagem_url}
        alt={`Exemplar de ${especie.nome_cientifico}`}
        loading="lazy"
        className="size-full object-cover"
      />
      {comCredito && (
        <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-0.5 text-[10px] text-white">
          {especie.imagem_autor || "Autor não informado"} · {especie.imagem_licenca} ·{" "}
          <a
            href={especie.imagem_pagina_url || undefined}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Wikimedia Commons
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
        </div>
      </div>
    </section>
  );
}
