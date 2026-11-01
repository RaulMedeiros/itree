import {
  ErroApi,
  useEquipesListar,
  useTarefasCriar,
  useTarefasCriarEmLote,
  type ResultadoLote,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { invalidarCaminhos } from "../../util/cache";

type Alvo =
  | { tipo: "lote"; filtros: Record<string, string>; total: number }
  | { tipo: "arvore"; id: string; codigo: string }
  | { tipo: "ocorrencia"; id: string; codigo: string };

/** Cria uma tarefa (árvore ou ocorrência) ou várias, a partir dos filtros do inventário. */
export function CriarTarefasDialogo({ alvo, aoFechar }: { alvo: Alvo; aoFechar: () => void }) {
  const equipes = useEquipesListar({ ativa: true, tamanho: 200 });
  const [equipe, setEquipe] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [prazo, setPrazo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const lote = useTarefasCriarEmLote<ErroApi>();
  const uma = useTarefasCriar<ErroApi>();
  const cliente = useQueryClient();
  const erro = lote.error ?? uma.error;
  const pendente = lote.isPending || uma.isPending;
  const membros = equipes.data?.data.results.find((e) => e.id === equipe)?.membros ?? [];

  const comum = {
    equipe_id: equipe || null,
    responsavel_id: responsavel || null,
    prazo: prazo || null,
    descricao,
  };
  const enviar = () => {
    const depois = async () => {
      await invalidarCaminhos(cliente, "/api/v1/tarefas");
    };
    if (alvo.tipo === "lote") {
      lote.mutate(
        { data: { ...comum, filtros_arvores: alvo.filtros } },
        { onSuccess: async (r) => (await depois(), setResultado(r.data)) },
      );
    } else {
      uma.mutate(
        {
          data: {
            ...comum,
            tipo: alvo.tipo === "arvore" ? "inspecao_arvore" : "atendimento_ocorrencia",
            ...(alvo.tipo === "arvore" ? { arvore_id: alvo.id } : { ocorrencia_id: alvo.id }),
          },
        },
        { onSuccess: async () => (await depois(), aoFechar()) },
      );
    }
  };

  const titulo =
    alvo.tipo === "lote"
      ? `Criar tarefas de inspeção para ${alvo.total} árvore(s)`
      : alvo.tipo === "arvore"
        ? `Tarefa de inspeção para ${alvo.codigo}`
        : `Tarefa de atendimento para ${alvo.codigo}`;

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={titulo}
      descricao={
        alvo.tipo === "lote"
          ? "Uma tarefa por árvore dos filtros atuais. Árvores que já têm tarefa de inspeção aberta são ignoradas."
          : undefined
      }
      rodape={
        resultado ? (
          <Botao onClick={aoFechar}>Fechar</Botao>
        ) : (
          <>
            <Botao variante="secundario" onClick={aoFechar}>
              Cancelar
            </Botao>
            <Botao disabled={pendente} onClick={enviar}>
              {pendente ? "Criando…" : "Criar"}
            </Botao>
          </>
        )
      }
    >
      {resultado ? (
        <div role="status" className="text-sm">
          <p>
            <strong>{resultado.criadas}</strong> tarefa(s) criada(s).
          </p>
          {resultado.ignoradas > 0 && (
            <p>{resultado.ignoradas} árvore(s) já tinham tarefa de inspeção aberta.</p>
          )}
          {resultado.fora_do_escopo_do_responsavel > 0 && (
            <p className="text-atencao">
              {resultado.fora_do_escopo_do_responsavel} árvore(s) ficaram de fora por estarem fora
              do escopo do responsável.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {erro && (
            <p className="text-sm text-perigo">
              {Object.values(erro.errosDeCampo).flat()[0] ?? erro.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Equipe">
              {(p) => (
                <Selecao
                  {...p}
                  value={equipe}
                  onChange={(e) => (setEquipe(e.target.value), setResponsavel(""))}
                >
                  <option value="">Sem equipe</option>
                  {equipes.data?.data.results.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.nome}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
            <Campo
              rotulo="Responsável"
              ajuda={equipe ? undefined : "Escolha a equipe para listar os membros."}
            >
              {(p) => (
                <Selecao
                  {...p}
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                  disabled={!equipe}
                >
                  <option value="">Sem responsável</option>
                  {membros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome || m.email}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
          </div>
          <Campo rotulo="Prazo">
            {(p) => (
              <Entrada
                {...p}
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
              />
            )}
          </Campo>
          <Campo rotulo="Orientações">
            {(p) => (
              <AreaTexto {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            )}
          </Campo>
        </div>
      )}
    </Dialogo>
  );
}
