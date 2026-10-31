import { ErroApi, PapelEnum, getUsuariosListarQueryKey, useUsuariosCriar } from "@itree/api-client";
import { DESCRICOES_PAPEL, ROTULOS_PAPEL } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Botao } from "../../ui/botao";
import { Campo, Entrada, ListaMarcavel } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { useOpcoesTerritorio } from "./dados";

export function PreCadastroDialogo({
  aberto,
  aoMudar,
}: {
  aberto: boolean;
  aoMudar: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papeis, setPapeis] = useState<string[]>([]);
  const [territorios, setTerritorios] = useState<string[]>([]);
  const territoriosOpcoes = useOpcoesTerritorio();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const criar = useUsuariosCriar<ErroApi>();
  const erros = criar.error instanceof ErroApi ? criar.error.errosDeCampo : {};

  const fechar = (valor: boolean) => {
    aoMudar(valor);
    if (!valor) {
      setEmail("");
      setNome("");
      setPapeis([]);
      setTerritorios([]);
      criar.reset();
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate(
      {
        data: {
          email,
          nome,
          papeis: papeis as PapelEnum[],
          territorio_ids: territorios,
          motivo: "Pré-cadastro",
        },
      },
      {
        onSuccess: async (resposta) => {
          await cliente.invalidateQueries({ queryKey: getUsuariosListarQueryKey().slice(0, 1) });
          fechar(false);
          void navegar({ to: "/administracao/usuarios/$id", params: { id: resposta.data.id } });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoMudar={fechar}
      titulo="Pré-cadastrar usuário"
      descricao="O usuário recebe estes papéis ao entrar pela primeira vez com este e-mail no provedor de login."
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={() => fechar(false)}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-pre-cadastro" disabled={criar.isPending}>
            {criar.isPending ? "Salvando…" : "Pré-cadastrar"}
          </Botao>
        </>
      }
    >
      <form id="form-pre-cadastro" onSubmit={enviar} className="flex flex-col gap-4">
        {criar.error && Object.keys(erros).length === 0 && (
          <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {criar.error.message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="E-mail" obrigatorio erros={erros.email}>
            {(p) => (
              <Entrada
                {...p}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Campo>
          <Campo rotulo="Nome" erros={erros.nome}>
            {(p) => <Entrada {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
          </Campo>
        </div>
        <ListaMarcavel
          legenda="Papéis"
          opcoes={Object.values(PapelEnum).map((p) => ({
            valor: p,
            rotulo: ROTULOS_PAPEL[p],
            descricao: DESCRICOES_PAPEL[p],
          }))}
          selecionados={papeis}
          aoAlterar={setPapeis}
          erros={erros.papeis}
        />
        <ListaMarcavel
          legenda="Escopo territorial"
          opcoes={territoriosOpcoes.opcoes}
          selecionados={territorios}
          aoAlterar={setTerritorios}
          erros={erros.territorio_ids}
          vazio="Nenhum território importado ainda. Sem escopo, o usuário não verá dados territoriais."
          className="max-h-56 overflow-y-auto"
        />
      </form>
    </Dialogo>
  );
}
