import type { Equipe } from "@itree/api-client";

/** Motivos pelos quais a equipe está incompleta (vazio quando está completa). */
export function pendenciasDaEquipe(equipe?: Pick<Equipe, "membros" | "territorios">): string[] {
  if (!equipe) return [];
  return [
    ...(equipe.membros.length === 0 ? ["sem membros"] : []),
    ...(equipe.territorios.length === 0 ? ["sem território"] : []),
  ];
}

/** Aviso, sem bloquear, ao atribuir uma tarefa a uma equipe "Incompleta". */
export function AvisoEquipeIncompleta({
  equipe,
}: {
  equipe?: Pick<Equipe, "nome" | "membros" | "territorios">;
}) {
  const pendencias = pendenciasDaEquipe(equipe);
  if (!equipe || pendencias.length === 0) return null;
  return (
    <p role="note" className="rounded-md bg-atencao-clara px-3 py-2 text-sm text-atencao">
      A equipe {equipe.nome} está incompleta ({pendencias.join(" e ")}). Você pode atribuir a tarefa
      assim mesmo, mas a equipe precisa de membros e território para executá-la.
    </p>
  );
}
