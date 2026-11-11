import { useEvidenciasListar, type Evidencia } from "@itree/api-client";
import { Leaf } from "lucide-react";

import { formatarData } from "../util/formatos";

/** Foto principal: a evidência mais recente que é imagem (pela captura, ou pelo envio). */
function fotoPrincipal(evidencias: readonly Evidencia[]): Evidencia | undefined {
  const quando = (e: Evidencia) => Date.parse(e.capturada_em ?? e.criado_em);
  return evidencias
    .filter((e) => e.eh_imagem && e.url)
    .reduce<Evidencia | undefined>((a, e) => (!a || quando(e) > quando(a) ? e : a), undefined);
}

/** Foto principal da árvore na ficha, com legenda de autoria e data. Sem foto, um aviso, não uma imagem de mentira. */
export function FotoPrincipalArvore({ arvoreId }: { arvoreId: string }) {
  const consulta = useEvidenciasListar({ arvore: arvoreId });
  if (consulta.isPending) return <div className="min-h-40 animate-pulse rounded-lg bg-fundo" />;
  const foto = consulta.isSuccess ? fotoPrincipal(consulta.data.data) : undefined;
  if (!foto?.url)
    return (
      <div
        role="img"
        aria-label="Árvore sem foto"
        className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg bg-marca-clara text-marca"
      >
        <Leaf className="size-8" aria-hidden />
        <span className="text-xs">Sem foto. Fotos enviadas na aba Evidências aparecem aqui.</span>
      </div>
    );
  const data = foto.capturada_em ?? foto.criado_em;
  return (
    <figure className="overflow-hidden rounded-lg border border-borda">
      <img
        src={foto.url}
        alt={foto.descricao || `Foto de ${foto.nome_original}`}
        className="h-56 w-full object-cover"
      />
      <figcaption className="px-3 py-1.5 text-xs text-texto-suave">
        {foto.descricao && <span className="block text-texto">{foto.descricao}</span>}
        Foto enviada por {foto.enviada_por_nome || "autor não informado"} em {formatarData(data)}
      </figcaption>
    </figure>
  );
}
