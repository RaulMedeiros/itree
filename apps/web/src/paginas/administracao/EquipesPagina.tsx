import {
  ErroApi,
  getEquipesListarQueryKey,
  useEquipesAtualizar,
  useEquipesCriar,
  useEquipesListar,
  type Equipe,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, ListaMarcavel, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { useOpcoesTerritorio, useOpcoesUsuario } from "./dados";

export function EquipesPagina() {
  const consulta = useEquipesListar({ tamanho: 200 });
  const [editando, setEditando] = useState<Equipe | "nova" | null>(null);

  return (
    <>
      <CabecalhoPagina
        titulo="Equipes"
        descricao="Agrupamentos operacionais de campo. Equipes são desativadas, não excluídas."
        acoes={
          <Botao onClick={() => setEditando("nova")}>
            <Plus /> Nova equipe
          </Botao>
        }
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio
          titulo="Nenhuma equipe cadastrada"
          acao={<Botao onClick={() => setEditando("nova")}>Nova equipe</Botao>}
        >
          Crie equipes para depois atribuir tarefas de campo a elas.
        </Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Equipe</Th>
              <Th>Coordenador</Th>
              <Th>Membros</Th>
              <Th>Territórios</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.results.map((e) => (
              <Linha key={e.id} className="hover:bg-fundo">
                <Td>
                  <button
                    className="text-left font-medium text-marca-escura hover:underline"
                    onClick={() => setEditando(e)}
                  >
                    {e.nome}
                  </button>
                  {e.descricao && <p className="text-xs text-texto-suave">{e.descricao}</p>}
                </Td>
                <Td>
                  {e.coordenador ? (
                    e.coordenador.nome || e.coordenador.email
                  ) : (
                    <span className="text-texto-suave">Não definido</span>
                  )}
                </Td>
                <Td>{e.membros.length}</Td>
                <Td>
                  {e.territorios.length ? (
                    e.territorios.map((t) => t.nome).join(", ")
                  ) : (
                    <span className="text-texto-suave">Nenhum</span>
                  )}
                </Td>
                <Td>{e.ativa ? <Selo tom="sucesso">Ativa</Selo> : <Selo>Desativada</Selo>}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {editando && (
        <EquipeDialogo
          key={editando === "nova" ? "nova" : editando.id}
          equipe={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  );
}

function EquipeDialogo({ equipe, aoFechar }: { equipe: Equipe | null; aoFechar: () => void }) {
  const [nome, setNome] = useState(equipe?.nome ?? "");
  const [descricao, setDescricao] = useState(equipe?.descricao ?? "");
  const [coordenador, setCoordenador] = useState(equipe?.coordenador?.id ?? "");
  const [membros, setMembros] = useState(equipe?.membros.map((m) => m.id) ?? []);
  const [territorios, setTerritorios] = useState(equipe?.territorios.map((t) => t.id) ?? []);
  const [ativa, setAtiva] = useState(equipe?.ativa ?? true);
  const usuarios = useOpcoesUsuario();
  const territoriosOpcoes = useOpcoesTerritorio();
  const cliente = useQueryClient();
  const criar = useEquipesCriar<ErroApi>();
  const atualizar = useEquipesAtualizar<ErroApi>();
  const mutacao = equipe ? atualizar : criar;
  const erros = mutacao.error instanceof ErroApi ? mutacao.error.errosDeCampo : {};

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const dados = {
      nome,
      descricao,
      ativa,
      coordenador_id: coordenador || null,
      membro_ids: membros,
      territorio_ids: territorios,
    };
    try {
      if (equipe) await atualizar.mutateAsync({ id: equipe.id, data: dados });
      else await criar.mutateAsync({ data: dados });
      await cliente.invalidateQueries({ queryKey: getEquipesListarQueryKey().slice(0, 1) });
      aoFechar();
    } catch {
      // Erro exibido no formulário.
    }
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={equipe ? `Editar equipe ${equipe.nome}` : "Nova equipe"}
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-equipe" disabled={mutacao.isPending}>
            {mutacao.isPending ? "Salvando…" : "Salvar"}
          </Botao>
        </>
      }
    >
      <form id="form-equipe" onSubmit={enviar} className="flex flex-col gap-4">
        {mutacao.error && Object.keys(erros).length === 0 && (
          <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {mutacao.error.message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Nome" obrigatorio erros={erros.nome}>
            {(p) => (
              <Entrada {...p} required value={nome} onChange={(e) => setNome(e.target.value)} />
            )}
          </Campo>
          <Campo rotulo="Coordenador" erros={erros.coordenador_id}>
            {(p) => (
              <Selecao {...p} value={coordenador} onChange={(e) => setCoordenador(e.target.value)}>
                <option value="">Não definido</option>
                {usuarios.opcoes.map((u) => (
                  <option key={u.valor} value={u.valor}>
                    {u.rotulo}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
        </div>
        <Campo rotulo="Descrição" erros={erros.descricao}>
          {(p) => (
            <AreaTexto {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <ListaMarcavel
            legenda="Membros"
            opcoes={usuarios.opcoes}
            selecionados={membros}
            aoAlterar={setMembros}
            erros={erros.membro_ids}
            className="max-h-56 overflow-y-auto"
          />
          <ListaMarcavel
            legenda="Territórios de atuação"
            opcoes={territoriosOpcoes.opcoes}
            selecionados={territorios}
            aoAlterar={setTerritorios}
            erros={erros.territorio_ids}
            vazio="Nenhum território importado ainda."
            className="max-h-56 overflow-y-auto"
          />
        </div>
        {equipe && (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-marca"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
            />
            Equipe ativa
          </label>
        )}
      </form>
    </Dialogo>
  );
}
