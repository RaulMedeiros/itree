import {
  getEvidenciasListarQueryKey,
  useEvidenciasListar,
  type Evidencia,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Leaf } from "lucide-react";
import { useState } from "react";

import { Botao } from "../ui/botao";
import { Dialogo } from "../ui/dialogo";
import { MenuAcoes } from "../ui/menu";
import { formatarData } from "../util/formatos";
import { RemoverEvidenciaDialogo } from "./Evidencias";

/** Foto principal: a evidência mais recente que é imagem (pela captura, ou pelo envio). */
function fotoPrincipal(evidencias: readonly Evidencia[]): Evidencia | undefined {
  const quando = (e: Evidencia) => Date.parse(e.capturada_em ?? e.criado_em);
  return evidencias
    .filter((e) => e.eh_imagem && e.url)
    .reduce<Evidencia | undefined>((a, e) => (!a || quando(e) > quando(a) ? e : a), undefined);
}

/**
 * Foto principal da árvore na ficha, com legenda de autoria e data. Sem foto, um aviso, não
 * uma imagem de mentira. Clicar amplia a foto com a legenda completa; o menu "⋯" (para quem
 * pode editar) remove a evidência, com justificativa (R2-17).
 */
export function FotoPrincipalArvore({
  arvoreId,
  podeEditar = false,
  aoAdicionar,
}: {
  arvoreId: string;
  podeEditar?: boolean;
  /** Leva a quem pode editar ao envio de fotos (a aba Evidências); sem isso, só o aviso. */
  aoAdicionar?: () => void;
}) {
  const consulta = useEvidenciasListar({ arvore: arvoreId });
  const cliente = useQueryClient();
  const [ampliada, setAmpliada] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null);
  if (consulta.isPending) return <div className="min-h-40 animate-pulse rounded-lg bg-fundo" />;
  const foto = consulta.isSuccess ? fotoPrincipal(consulta.data.data) : undefined;
  if (!foto?.url)
    return (
      // Sem foto, uma linha só, na largura toda: o vazio não ocupa meia tela (R3-12).
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-borda bg-fundo px-3 py-2 md:col-span-2">
        <span
          role="img"
          aria-label="Árvore sem foto"
          className="flex items-center gap-2 text-sm text-texto-suave"
        >
          <Leaf className="size-4 text-marca" aria-hidden />
          Sem foto
        </span>
        <span className="text-xs text-texto-suave">
          Fotos enviadas na aba Evidências aparecem aqui.
        </span>
        {podeEditar && aoAdicionar && (
          <Botao variante="secundario" tamanho="pequeno" className="ml-auto" onClick={aoAdicionar}>
            Adicionar foto
          </Botao>
        )}
      </div>
    );
  const data = foto.capturada_em ?? foto.criado_em;
  const legenda = `Foto enviada por ${foto.enviada_por_nome || "autor não informado"} em ${formatarData(data)}`;
  const alt = foto.descricao || `Foto de ${foto.nome_original}`;
  return (
    <figure className="relative overflow-hidden rounded-lg border border-borda">
      <button
        type="button"
        className="block w-full cursor-zoom-in"
        aria-label="Ampliar foto"
        onClick={() => setAmpliada(true)}
      >
        <img src={foto.url} alt={alt} className="h-56 w-full object-cover" />
      </button>
      {podeEditar && (
        <div className="absolute top-2 right-2">
          <MenuAcoes
            rotulo="Ações da foto"
            itens={[{ rotulo: "Remover", perigo: true, aoEscolher: () => setRemovendo(foto.id) }]}
          />
        </div>
      )}
      <figcaption className="px-3 py-1.5 text-xs text-texto-suave">
        {foto.descricao && <span className="block text-texto">{foto.descricao}</span>}
        {legenda}
      </figcaption>

      <Dialogo
        aberto={ampliada}
        aoMudar={setAmpliada}
        titulo={foto.descricao || foto.nome_original}
        largura="max-w-4xl"
      >
        <img src={foto.url} alt={alt} className="max-h-[70vh] w-full rounded object-contain" />
        <p className="mt-3 text-sm">{foto.descricao || "Sem descrição."}</p>
        <p className="text-xs text-texto-suave">
          {legenda}. Arquivo: {foto.nome_original}.
        </p>
        {foto.capturada_em && (
          <p className="text-xs text-texto-suave">
            Capturada em {formatarData(foto.capturada_em)}.
          </p>
        )}
      </Dialogo>
      <RemoverEvidenciaDialogo
        evidenciaId={removendo}
        aoFechar={() => setRemovendo(null)}
        aoRemover={() =>
          void cliente.invalidateQueries({
            queryKey: getEvidenciasListarQueryKey({ arvore: arvoreId }),
          })
        }
      />
    </figure>
  );
}
