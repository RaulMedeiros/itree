import {
  ErroApi,
  PrioridadeEnum,
  useEquipesListar,
  useOcorrenciasPrioridadeEmLote,
  useOcorrenciasReatribuirEmLote,
  useUsuariosListar,
  type OperacaoEmLote,
  type ResultadoAcaoEmLote,
} from "@itree/api-client";
import { ROTULOS_PRIORIDADE } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { ResultadoDoLote, alterouRegistros } from "../../componentes/lote";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { invalidarCaminhos } from "../../util/cache";
import { plural } from "../../util/formatos";
import type { AlvoLote } from "../../util/lote";

/** Valor da opção que deixa o campo como está em cada ocorrência. */
const MANTER = "__manter__";
/** Valor da opção que limpa o campo. */
const NENHUM = "";

function mensagemDeErro(erro: ErroApi): string {
  return Object.values(erro.errosDeCampo).flat()[0] ?? erro.message;
}

/** Reatribui responsável e/ou equipe das ocorrências marcadas. Só muda o que for escolhido. */
export function ReatribuirEmLoteDialogo({
  alvo,
  total,
  aoFechar,
}: {
  alvo: AlvoLote;
  total: number;
  aoFechar: (alterou: boolean) => void;
}) {
  const podeVerUsuarios = usePermissao("admin.usuarios");
  const usuarios = useUsuariosListar(
    { ativo: true, tamanho: 500 },
    { query: { enabled: podeVerUsuarios } },
  );
  const equipes = useEquipesListar(
    { ativa: true, tamanho: 200 },
    { query: { enabled: usePermissao("tarefas.ler") } },
  );
  const [responsavel, setResponsavel] = useState(MANTER);
  const [equipe, setEquipe] = useState(MANTER);
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoAcaoEmLote | OperacaoEmLote | null>(null);
  const mutacao = useOcorrenciasReatribuirEmLote<ErroApi>();
  const cliente = useQueryClient();
  // Sem acesso à lista de usuários, oferece ao menos os membros das equipes.
  const membros = equipes.data?.data.results.flatMap((e) => e.membros) ?? [];
  const opcoes = podeVerUsuarios
    ? (usuarios.data?.data.results ?? []).map((u) => ({ id: u.id, nome: u.nome || u.email }))
    : [...new Map(membros.map((m) => [m.id, { id: m.id, nome: m.nome || m.email }])).values()];

  if (resultado) {
    return (
      <ResultadoDoLote
        titulo="Reatribuição concluída"
        resultado={resultado}
        aoFechar={() => aoFechar(alterouRegistros(resultado))}
      />
    );
  }
  const nadaMudou = responsavel === MANTER && equipe === MANTER;
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar(false)}
      titulo={`Reatribuir ${plural(total, "ocorrência", "ocorrências")}`}
      descricao="Vale para todas as ocorrências marcadas. As já encerradas não mudam. Fica no histórico de cada uma."
      rodape={
        <>
          <Botao variante="secundario" onClick={() => aoFechar(false)}>
            Cancelar
          </Botao>
          <Botao
            disabled={nadaMudou || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                {
                  data: {
                    ...alvo,
                    ...(responsavel !== MANTER && { responsavel_id: responsavel || null }),
                    ...(equipe !== MANTER && { equipe_id: equipe || null }),
                    motivo: motivo.trim() || undefined,
                  },
                },
                {
                  onSuccess: async ({ data }) => {
                    await invalidarCaminhos(cliente, "/api/v1/ocorrencias");
                    setResultado(data);
                  },
                },
              )
            }
          >
            Reatribuir
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {mensagemDeErro(mutacao.error)}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Responsável">
          {(p) => (
            <Selecao {...p} value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value={MANTER}>Manter o de cada ocorrência</option>
              <option value={NENHUM}>Sem responsável</option>
              {opcoes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Equipe">
          {(p) => (
            <Selecao {...p} value={equipe} onChange={(e) => setEquipe(e.target.value)}>
              <option value={MANTER}>Manter a de cada ocorrência</option>
              <option value={NENHUM}>Sem equipe</option>
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

/** Prioridade operacional das ocorrências marcadas (só quem pode priorizar). */
export function PrioridadeEmLoteDialogo({
  alvo,
  total,
  aoFechar,
}: {
  alvo: AlvoLote;
  total: number;
  aoFechar: (alterou: boolean) => void;
}) {
  const [prioridade, setPrioridade] = useState<PrioridadeEnum>("media");
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoAcaoEmLote | OperacaoEmLote | null>(null);
  const mutacao = useOcorrenciasPrioridadeEmLote<ErroApi>();
  const cliente = useQueryClient();
  if (resultado) {
    return (
      <ResultadoDoLote
        titulo="Prioridade definida"
        resultado={resultado}
        aoFechar={() => aoFechar(alterouRegistros(resultado))}
      />
    );
  }
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar(false)}
      titulo={`Alterar prioridade de ${plural(total, "ocorrência", "ocorrências")}`}
      descricao="A prioridade ordena o atendimento. Não é avaliação de risco. As já encerradas não mudam."
      rodape={
        <>
          <Botao variante="secundario" onClick={() => aoFechar(false)}>
            Cancelar
          </Botao>
          <Botao
            disabled={mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { data: { ...alvo, prioridade, motivo: motivo.trim() || undefined } },
                {
                  onSuccess: async ({ data }) => {
                    await invalidarCaminhos(cliente, "/api/v1/ocorrencias");
                    setResultado(data);
                  },
                },
              )
            }
          >
            Alterar prioridade
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {mensagemDeErro(mutacao.error)}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Prioridade">
          {(p) => (
            <Selecao
              {...p}
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as PrioridadeEnum)}
            >
              {Object.values(PrioridadeEnum).map((v) => (
                <option key={v} value={v}>
                  {ROTULOS_PRIORIDADE[v]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Justificativa (opcional)">
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
