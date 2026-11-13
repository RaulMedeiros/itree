import {
  ErroApi,
  useOcorrenciasPrazoEmLote,
  useTarefasPrazoEmLote,
  type OperacaoEmLote,
  type ResultadoAcaoEmLote,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Botao } from "../ui/botao";
import { AreaTexto, Campo, EntradaData } from "../ui/campos";
import { Dialogo } from "../ui/dialogo";
import { invalidarCaminhos } from "../util/cache";
import { descreverPrazo, plural } from "../util/formatos";
import { alterouRegistros, type AlvoLote } from "../util/lote";
import { ResultadoDoLote } from "./lote";

const RECURSOS = {
  ocorrencias: { singular: "ocorrência", plural: "ocorrências", caminho: "/api/v1/ocorrencias" },
  tarefas: { singular: "tarefa", plural: "tarefas", caminho: "/api/v1/tarefas" },
} as const;

/**
 * Define (ou remove) o prazo das ocorrências ou tarefas marcadas, ou de todas as filtradas
 * (M-23). As encerradas não mudam, e o servidor diz quais ficaram de fora.
 */
export function PrazoEmLoteDialogo({
  recurso,
  alvo,
  total,
  aoFechar,
}: {
  recurso: keyof typeof RECURSOS;
  alvo: AlvoLote;
  total: number;
  aoFechar: (alterou: boolean) => void;
}) {
  const nomes = RECURSOS[recurso];
  const [prazo, setPrazo] = useState("");
  const [remover, setRemover] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoAcaoEmLote | OperacaoEmLote | null>(null);
  const deOcorrencias = useOcorrenciasPrazoEmLote<ErroApi>();
  const deTarefas = useTarefasPrazoEmLote<ErroApi>();
  const mutacao = recurso === "ocorrencias" ? deOcorrencias : deTarefas;
  const cliente = useQueryClient();

  if (resultado) {
    return (
      <ResultadoDoLote
        titulo="Prazo definido"
        resultado={resultado}
        aoFechar={() => aoFechar(alterouRegistros(resultado))}
      />
    );
  }
  const pronto = remover || prazo !== "";
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar(false)}
      titulo={`Definir prazo de ${plural(total, nomes.singular, nomes.plural)}`}
      descricao={`Vale para ${"filtros" in alvo ? "todas as filtradas" : "todas as marcadas"}. As já encerradas não mudam. Fica no histórico de cada uma.`}
      rodape={
        <>
          <Botao variante="secundario" onClick={() => aoFechar(false)}>
            Cancelar
          </Botao>
          <Botao
            disabled={!pronto || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                {
                  data: {
                    ...alvo,
                    prazo: remover ? null : prazo,
                    motivo: motivo.trim() || undefined,
                  },
                },
                {
                  onSuccess: async ({ data }) => {
                    await invalidarCaminhos(cliente, nomes.caminho);
                    setResultado(data);
                  },
                },
              )
            }
          >
            {remover ? "Remover prazo" : "Definir prazo"}
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
        <Campo rotulo="Novo prazo">
          {(p) => (
            <EntradaData
              {...p}
              value={prazo}
              disabled={remover}
              onChange={(v) => setPrazo(v)}
              className="max-w-40"
            />
          )}
        </Campo>
        {prazo !== "" && !remover && (
          <p className="-mt-1 text-sm text-texto-suave">Prazo: {descreverPrazo(prazo)}.</p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-marca"
            checked={remover}
            onChange={(e) => setRemover(e.target.checked)}
          />
          Remover o prazo
        </label>
        <Campo rotulo="Motivo (opcional)">
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
