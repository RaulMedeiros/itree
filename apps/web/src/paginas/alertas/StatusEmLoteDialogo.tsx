import {
  ErroApi,
  StatusAlertaEnum,
  useAlertasStatusEmLote,
  type OperacaoEmLote,
  type ResultadoAcaoEmLote,
} from "@itree/api-client";
import { ROTULOS_STATUS_ALERTA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ResultadoDoLote, alterouRegistros } from "../../componentes/lote";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { invalidarCaminhos } from "../../util/cache";
import { plural } from "../../util/formatos";
import type { AlvoLote } from "../../util/lote";

/** Status que exigem justificativa e, entre eles, os que exigem a referência (como na triagem). */
const EXIGEM_JUSTIFICATIVA: StatusAlertaEnum[] = [
  "descartado",
  "confirmado",
  "compativel_autorizacao",
  "encaminhado",
];
const EXIGEM_REFERENCIA: Partial<Record<StatusAlertaEnum, string>> = {
  confirmado: "Documento da autoridade",
  encaminhado: "Protocolo de encaminhamento",
};

/**
 * Muda o status dos alertas marcados ou de todos os filtrados (M-26). Passa só quem tem a
 * transição permitida a partir do status atual; o servidor diz quais ficaram de fora e por quê.
 */
export function StatusEmLoteDialogo({
  alvo,
  total,
  aoFechar,
}: {
  alvo: AlvoLote;
  total: number;
  aoFechar: (alterou: boolean) => void;
}) {
  const [status, setStatus] = useState<StatusAlertaEnum>("em_triagem");
  const [justificativa, setJustificativa] = useState("");
  const [referencia, setReferencia] = useState("");
  const [resultado, setResultado] = useState<ResultadoAcaoEmLote | OperacaoEmLote | null>(null);
  const mutacao = useAlertasStatusEmLote<ErroApi>();
  const cliente = useQueryClient();
  if (resultado) {
    return (
      <ResultadoDoLote
        titulo="Status alterado"
        resultado={resultado}
        aoFechar={() => aoFechar(alterouRegistros(resultado))}
      />
    );
  }
  const exigeJustificativa = EXIGEM_JUSTIFICATIVA.includes(status);
  const rotuloReferencia = EXIGEM_REFERENCIA[status];
  const pronto =
    (!exigeJustificativa || justificativa.trim() !== "") &&
    (!rotuloReferencia || referencia.trim() !== "");
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar(false)}
      titulo={`Alterar o status de ${plural(total, "alerta", "alertas")}`}
      descricao="Só mudam os alertas em que a transição é permitida a partir do status atual. Os demais ficam como estão, e a lista diz o motivo. Nenhum status afirma infração antes da autoridade."
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
                    status,
                    justificativa: justificativa.trim() || undefined,
                    referencia: referencia.trim() || undefined,
                  },
                },
                {
                  onSuccess: async ({ data }) => {
                    await invalidarCaminhos(cliente, "/api/v1/alertas");
                    setResultado(data);
                  },
                },
              )
            }
          >
            Alterar status
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
        <Campo rotulo="Novo status" obrigatorio>
          {(p) => (
            <Selecao
              {...p}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusAlertaEnum)}
            >
              {Object.values(StatusAlertaEnum)
                .filter((s) => s !== "detectado")
                .map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_STATUS_ALERTA[s]}
                  </option>
                ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Justificativa" obrigatorio={exigeJustificativa}>
          {(p) => (
            <AreaTexto
              {...p}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
            />
          )}
        </Campo>
        {rotuloReferencia && (
          <Campo rotulo={rotuloReferencia} obrigatorio>
            {(p) => (
              <Entrada {...p} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            )}
          </Campo>
        )}
      </div>
    </Dialogo>
  );
}
