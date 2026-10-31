import {
  ErroApi,
  PapelEnum,
  getUsuariosListarQueryKey,
  getUsuariosObterQueryKey,
  useUsuariosAtualizar,
  useUsuariosObter,
  type PatchedUsuarioAdminRequest,
  type UsuarioAdmin,
} from "@itree/api-client";
import { DESCRICOES_PAPEL, ROTULOS_PAPEL } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, History } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useUsuario } from "../../acesso/ContextoUsuario";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, ListaMarcavel } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { formatarDataHora } from "../../util/formatos";
import { useOpcoesTerritorio } from "./dados";

export function UsuarioDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/administracao/usuarios/$id" });
  const consulta = useUsuariosObter(id);

  return (
    <>
      <Link
        to="/administracao/usuarios"
        className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Usuários
      </Link>
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <FormularioUsuario key={consulta.data.data.id} usuario={consulta.data.data} />
      )}
    </>
  );
}

const iguais = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Mudanças de acesso exigem confirmação com justificativa (RF-ADM-002). */
function exigeConfirmacao(original: UsuarioAdmin, mudancas: PatchedUsuarioAdminRequest): boolean {
  return (
    (mudancas.papeis !== undefined && !iguais(mudancas.papeis, original.papeis ?? [])) ||
    (mudancas.ativo !== undefined && mudancas.ativo !== original.ativo) ||
    (mudancas.territorio_ids !== undefined &&
      !iguais(
        mudancas.territorio_ids,
        original.territorios.map((t) => t.id),
      )) ||
    (mudancas.registro_profissional !== undefined &&
      mudancas.registro_profissional !== (original.registro_profissional ?? ""))
  );
}

function FormularioUsuario({ usuario }: { usuario: UsuarioAdmin }) {
  const eu = useUsuario();
  const ehVoce = eu.id === usuario.id;
  const [nome, setNome] = useState(usuario.nome ?? "");
  const [papeis, setPapeis] = useState<string[]>([...(usuario.papeis ?? [])]);
  const [registro, setRegistro] = useState(usuario.registro_profissional ?? "");
  const [territorios, setTerritorios] = useState(usuario.territorios.map((t) => t.id));
  const [ativo, setAtivo] = useState(usuario.ativo ?? true);
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvo, setSalvo] = useState(false);

  const territoriosOpcoes = useOpcoesTerritorio();
  const cliente = useQueryClient();
  const atualizar = useUsuariosAtualizar<ErroApi>();
  const erros = atualizar.error instanceof ErroApi ? atualizar.error.errosDeCampo : {};

  const mudancas: PatchedUsuarioAdminRequest = {
    nome,
    papeis: papeis as PapelEnum[],
    registro_profissional: registro,
    territorio_ids: territorios,
    ativo,
  };
  const alterado = nome !== (usuario.nome ?? "") || exigeConfirmacao(usuario, mudancas);

  const salvar = (comMotivo?: string) => {
    setSalvo(false);
    atualizar.mutate(
      { id: usuario.id, data: { ...mudancas, motivo: comMotivo } },
      {
        onSuccess: async () => {
          setConfirmando(false);
          setMotivo("");
          setSalvo(true);
          await Promise.all([
            cliente.invalidateQueries({ queryKey: getUsuariosObterQueryKey(usuario.id) }),
            cliente.invalidateQueries({ queryKey: getUsuariosListarQueryKey().slice(0, 1) }),
          ]);
        },
        onError: () => setConfirmando(false),
      },
    );
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (exigeConfirmacao(usuario, mudancas)) setConfirmando(true);
    else salvar();
  };

  return (
    <>
      <CabecalhoPagina
        titulo={usuario.nome || usuario.email}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {usuario.email}
            {usuario.vinculado ? (
              <Selo tom="sucesso">Vinculado ao provedor de login</Selo>
            ) : (
              <Selo tom="info">Aguardando primeiro acesso</Selo>
            )}
            <span>· Cadastrado em {formatarDataHora(usuario.date_joined)}</span>
            <span>· Último acesso: {formatarDataHora(usuario.last_login) ?? "nunca"}</span>
          </span>
        }
        acoes={
          <Botao variante="secundario" asChild>
            <Link to="/administracao/auditoria" search={{ objeto: usuario.id }}>
              <History /> Histórico
            </Link>
          </Botao>
        }
      />
      <form onSubmit={enviar} className="grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
        {atualizar.error && (
          <p
            role="alert"
            className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo lg:col-span-2"
          >
            {Object.values(erros).flat()[0] ?? atualizar.error.message}
          </p>
        )}
        {salvo && !alterado && (
          <p
            role="status"
            className="rounded-md bg-sucesso-clara px-3 py-2 text-sm text-sucesso lg:col-span-2"
          >
            Alterações salvas e registradas na auditoria.
          </p>
        )}
        <div className="flex flex-col gap-4">
          <Campo rotulo="Nome" erros={erros.nome}>
            {(p) => <Entrada {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
          </Campo>
          <Campo
            rotulo="Registro profissional"
            ajuda="Ex.: CREA. Necessário, junto do papel de revisor, para registrar risco confirmado."
            erros={erros.registro_profissional}
          >
            {(p) => (
              <Entrada {...p} value={registro} onChange={(e) => setRegistro(e.target.value)} />
            )}
          </Campo>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Situação</legend>
            <label className="flex items-start gap-2.5 rounded-md border border-borda bg-superficie px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-marca"
                checked={ativo}
                disabled={ehVoce}
                onChange={(e) => setAtivo(e.target.checked)}
              />
              <span className="flex flex-col">
                <span className="text-sm">Acesso ativo</span>
                <span className="text-xs text-texto-suave">
                  {ehVoce
                    ? "Você não pode desativar a si mesmo."
                    : "Ao desativar, o acesso termina na próxima requisição. Os registros do usuário são preservados."}
                </span>
              </span>
            </label>
          </fieldset>
          <ListaMarcavel
            legenda="Escopo territorial"
            opcoes={territoriosOpcoes.opcoes}
            selecionados={territorios}
            aoAlterar={setTerritorios}
            erros={erros.territorio_ids}
            vazio="Nenhum território importado ainda."
            className="max-h-64 overflow-y-auto"
          />
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
        <div className="flex gap-2 lg:col-span-2">
          <Botao type="submit" disabled={!alterado || atualizar.isPending}>
            {atualizar.isPending ? "Salvando…" : "Salvar alterações"}
          </Botao>
        </div>
      </form>

      <Dialogo
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Confirmar alteração de acesso"
        descricao="Mudanças de papéis, escopo, registro profissional ou situação ficam registradas na auditoria com a justificativa."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setConfirmando(false)}>
              Cancelar
            </Botao>
            <Botao
              disabled={!motivo.trim() || atualizar.isPending}
              onClick={() => salvar(motivo.trim())}
            >
              Confirmar
            </Botao>
          </>
        }
      >
        <Campo
          rotulo="Justificativa"
          obrigatorio
          ajuda="Ex.: número do ato de nomeação ou do chamado."
        >
          {(p) => (
            <AreaTexto
              {...p}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
            />
          )}
        </Campo>
      </Dialogo>
    </>
  );
}
