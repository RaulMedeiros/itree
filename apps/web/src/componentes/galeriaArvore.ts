import type { FotoArvore } from "@itree/api-client";

import { formatarData } from "../util/formatos";

const ROTULO_ORIGEM: Record<FotoArvore["origem"], string> = {
  evidencia: "Evidência da árvore",
  inspecao: "Inspeção",
  ocorrencia: "Ocorrência",
  tarefa: "Tarefa",
};

/** "Inspeção INS-000012" ou "Evidência da árvore ARV-000003". */
export function rotuloOrigem(foto: FotoArvore): string {
  return `${ROTULO_ORIGEM[foto.origem]} ${foto.origem_codigo}`.trim();
}

/** Texto alternativo descritivo: o que a imagem é, de quando e de onde vem. */
export function altDaFoto(foto: FotoArvore, codigoArvore: string): string {
  const base = `Foto da árvore ${codigoArvore} de ${formatarData(foto.data)}, ${rotuloOrigem(foto)}`;
  return foto.descricao ? `${base}: ${foto.descricao}` : base;
}

/** Miniatura quando há; sem ela, o original (a grade nunca fica sem imagem). */
export const urlDaGrade = (foto: FotoArvore) => foto.url_miniatura ?? foto.url ?? undefined;

/** Rota do registro de onde a foto veio; a evidência da própria árvore não tem outra. */
export function destinoDaOrigem(foto: FotoArvore): { to: string; params: { id: string } } | null {
  if (!foto.origem_id) return null;
  const rota = {
    inspecao: "/inspecoes/$id",
    ocorrencia: "/ocorrencias/$id",
    tarefa: "/equipes-tarefas/$id",
    evidencia: null,
  }[foto.origem];
  return rota ? { to: rota, params: { id: foto.origem_id } } : null;
}
