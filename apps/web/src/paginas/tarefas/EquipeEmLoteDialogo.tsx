import {
  ErroApi,
  useEquipesListar,
  useTarefasEquipeEmLote,
  type ResultadoAcaoEmLote,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AvisoEquipeIncompleta } from "../../componentes/AvisoEquipeIncompleta";
import { ResultadoDoLote } from "../../componentes/lote";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { invalidarCaminhos } from "../../util/cache";
import { plural } from "../../util/formatos";

/**
 * Passa as tarefas marcadas para outra equipe. O responsável de cada tarefa só continua
 * se for membro da nova equipe; senão a tarefa fica sem responsável (o servidor decide).
 */
export function EquipeEmLoteDialogo({
  ids,
  aoFechar,
}: {
  ids: string[];
  aoFechar: (alterou: boolean) => void;
}) {
  const equipes = useEquipesListar({ ativa: true, tamanho: 200 });
  const [equipe, setEquipe] = useState("");
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoAcaoEmLote | null>(null);
  const mutacao = useTarefasEquipeEmLote<ErroApi>();
  const cliente = useQueryClient();
  if (resultado) {
    return (
      <ResultadoDoLote
        titulo="Equipe reatribuída"
        resultado={resultado}
        aoFechar={() => aoFechar(resultado.atualizadas > 0)}
      />
    );
  }
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar(false)}
      titulo={`Reatribuir equipe de ${plural(ids.length, "tarefa", "tarefas")}`}
      descricao="As tarefas encerradas não mudam. Quem era responsável e não é da nova equipe deixa de ser, e a equipe é avisada."
      rodape={
        <>
          <Botao variante="secundario" onClick={() => aoFechar(false)}>
            Cancelar
          </Botao>
          <Botao
            disabled={!equipe || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { data: { ids, equipe_id: equipe, motivo: motivo.trim() || undefined } },
                {
                  onSuccess: async ({ data }) => {
                    await invalidarCaminhos(cliente, "/api/v1/tarefas");
                    setResultado(data);
                  },
                },
              )
            }
          >
            Reatribuir equipe
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <AvisoEquipeIncompleta equipe={equipes.data?.data.results.find((e) => e.id === equipe)} />
        <Campo rotulo="Nova equipe" obrigatorio>
          {(p) => (
            <Selecao {...p} value={equipe} onChange={(e) => setEquipe(e.target.value)}>
              <option value="">Escolha a equipe</option>
              {equipes.data?.data.results.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Motivo (opcional)">
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
