import {
  ErroApi,
  PrioridadeEnum,
  getOcorrenciasHistoricoQueryKey,
  getOcorrenciasObterQueryKey,
  useEquipesListar,
  useOcorrenciasAtualizar,
  useOcorrenciasHistorico,
  useOcorrenciasObter,
  useOcorrenciasPrioridade,
  useOcorrenciasRisco,
  useOcorrenciasTransicao,
  useUsuariosListar,
  type EstadoOcorrenciaEnum,
  type Ocorrencia,
} from "@itree/api-client";
import {
  ACOES_ESTADO_OCORRENCIA,
  ROTULOS_ORIGEM_OCORRENCIA,
  ROTULOS_PRIORIDADE,
} from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Map as IconeMapa, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Evidencias } from "../../componentes/Evidencias";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloEstadoOcorrencia, SeloPrioridade } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { invalidarCaminhos } from "../../util/cache";

export function OcorrenciaDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/ocorrencias/$id" });
  const consulta = useOcorrenciasObter(id);
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/ocorrencias"
        className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Ocorrências
      </Link>
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <Detalhe ocorrencia={consulta.data.data} />
      )}
    </div>
  );
}

function useRecarregar(id: string) {
  const cliente = useQueryClient();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: getOcorrenciasObterQueryKey(id) }),
      cliente.invalidateQueries({ queryKey: getOcorrenciasHistoricoQueryKey(id) }),
      invalidarCaminhos(cliente, "/api/v1/ocorrencias"),
    ]);
}

function Cartao({
  titulo,
  subtitulo,
  children,
  acao,
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-borda bg-superficie p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          <p className="text-xs text-texto-suave">{subtitulo}</p>
        </div>
        {acao}
      </div>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function Detalhe({ ocorrencia: o }: { ocorrencia: Ocorrencia }) {
  const encerrada = o.estado === "concluida" || o.estado === "cancelada";
  const podeEditar = usePermissao("ocorrencias.editar") && !encerrada;
  const podePriorizar = usePermissao("ocorrencias.priorizar") && !encerrada;
  const podeRisco = usePermissao("ocorrencias.confirmar_risco") && !o.risco_confirmado;
  const [transicao, setTransicao] = useState<EstadoOcorrenciaEnum | null>(null);
  const [priorizando, setPriorizando] = useState(false);
  const [registrandoRisco, setRegistrandoRisco] = useState(false);
  const [atribuindo, setAtribuindo] = useState(false);
  const historico = useOcorrenciasHistorico(o.id);

  return (
    <>
      <CabecalhoPagina
        titulo={`${o.codigo} · ${o.tipo.nome}`}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <SeloEstadoOcorrencia estado={o.estado} />
            {o.atrasada && <Selo tom="perigo">Atrasada</Selo>}
            <span>
              Registrada em {formatarDataHora(o.criado_em)} por{" "}
              {o.registrada_por.nome || o.registrada_por.email} ·{" "}
              {ROTULOS_ORIGEM_OCORRENCIA[o.origem]}
            </span>
          </span>
        }
        acoes={
          o.localizacao && (
            <Botao variante="secundario" asChild>
              <Link
                to="/mapa"
                search={{
                  lon: o.localizacao.longitude,
                  lat: o.localizacao.latitude,
                  zoom: 18,
                  camada: "ocorrencias",
                  selecao: `ocorrencia:${o.id}`,
                }}
              >
                <IconeMapa /> No mapa
              </Link>
            </Botao>
          )
        }
      />

      {podeEditar && o.transicoes_possiveis.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-borda bg-superficie px-4 py-3">
          <span className="text-sm text-texto-suave">Próximo passo:</span>
          {o.transicoes_possiveis.map((estado) => (
            <Botao
              key={estado}
              tamanho="pequeno"
              variante={estado === "cancelada" ? "secundario" : "primario"}
              onClick={() => setTransicao(estado)}
            >
              {ACOES_ESTADO_OCORRENCIA[estado]}
            </Botao>
          ))}
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Cartao titulo="Condição aparente" subtitulo="O que foi observado. Não é diagnóstico.">
          <p className="whitespace-pre-wrap">
            {o.condicao_aparente || <span className="text-texto-suave">Não descrita.</span>}
          </p>
        </Cartao>
        <Cartao
          titulo="Prioridade operacional"
          subtitulo="Ordem de atendimento definida pela gestão."
          acao={
            podePriorizar && (
              <Botao tamanho="pequeno" variante="secundario" onClick={() => setPriorizando(true)}>
                Definir
              </Botao>
            )
          }
        >
          <SeloPrioridade prioridade={o.prioridade} />
          {o.prioridade_definida_por && (
            <p className="mt-2 text-xs text-texto-suave">
              Por {o.prioridade_definida_por.nome || o.prioridade_definida_por.email} em{" "}
              {formatarDataHora(o.prioridade_definida_em)}
            </p>
          )}
        </Cartao>
        <Cartao
          titulo="Risco confirmado"
          subtitulo="Conclusão de avaliação técnica competente."
          acao={
            podeRisco && (
              <Botao
                tamanho="pequeno"
                variante="secundario"
                onClick={() => setRegistrandoRisco(true)}
              >
                <ShieldAlert /> Registrar
              </Botao>
            )
          }
        >
          {o.risco_confirmado ? (
            <>
              <Selo tom="perigo">Risco confirmado</Selo>
              <p className="mt-2 whitespace-pre-wrap">{o.risco_descricao}</p>
              <p className="mt-2 text-xs text-texto-suave">
                Responsável técnico: {o.risco_responsavel?.nome || o.risco_responsavel?.email} ·{" "}
                {formatarDataHora(o.risco_registrado_em)}
              </p>
            </>
          ) : (
            <span className="text-texto-suave">Nenhuma avaliação técnica registrada.</span>
          )}
        </Cartao>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-borda bg-superficie p-4 lg:col-span-2">
          <h2 className="mb-2 font-semibold">Descrição</h2>
          <p className="text-sm whitespace-pre-wrap">{o.descricao}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-texto-suave uppercase">Árvore</dt>
              <dd>
                {o.arvore ? (
                  <Link
                    to="/inventario/arvores/$id"
                    params={{ id: String(o.arvore.id) }}
                    className="font-mono text-marca-escura hover:underline"
                  >
                    {String(o.arvore.codigo)}
                  </Link>
                ) : (
                  "Sem árvore vinculada"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-texto-suave uppercase">Local</dt>
              <dd>{[o.endereco, o.bairro?.nome].filter(Boolean).join(" · ") || "—"}</dd>
            </div>
          </dl>
        </section>
        <Cartao
          titulo="Atribuição"
          subtitulo="Responsável, equipe e prazo."
          acao={
            podeEditar && (
              <Botao tamanho="pequeno" variante="secundario" onClick={() => setAtribuindo(true)}>
                Alterar
              </Botao>
            )
          }
        >
          <dl className="flex flex-col gap-2">
            <div>
              <dt className="text-xs text-texto-suave">Responsável</dt>
              <dd>{o.responsavel ? o.responsavel.nome || o.responsavel.email : "Não atribuído"}</dd>
            </div>
            <div>
              <dt className="text-xs text-texto-suave">Equipe</dt>
              <dd>{o.equipe?.nome ?? "Não atribuída"}</dd>
            </div>
            <div>
              <dt className="text-xs text-texto-suave">Prazo</dt>
              <dd>{formatarData(o.prazo) ?? "Sem prazo"}</dd>
            </div>
          </dl>
        </Cartao>
      </div>

      <h2 className="mb-2 font-semibold">Evidências</h2>
      <div className="mb-6">
        <Evidencias alvo={{ ocorrencia: o.id }} podeEnviar={podeEditar} />
      </div>

      <h2 className="mb-3 font-semibold">Histórico de encaminhamentos</h2>
      <LinhaDoTempo
        eventos={historico.data?.data}
        carregando={historico.isPending}
        erro={historico.error}
      />

      {transicao && (
        <TransicaoDialogo ocorrencia={o} estado={transicao} aoFechar={() => setTransicao(null)} />
      )}
      {priorizando && <PrioridadeDialogo ocorrencia={o} aoFechar={() => setPriorizando(false)} />}
      {registrandoRisco && (
        <RiscoDialogo ocorrencia={o} aoFechar={() => setRegistrandoRisco(false)} />
      )}
      {atribuindo && <AtribuicaoDialogo ocorrencia={o} aoFechar={() => setAtribuindo(false)} />}
    </>
  );
}

function TransicaoDialogo({
  ocorrencia,
  estado,
  aoFechar,
}: {
  ocorrencia: Ocorrencia;
  estado: EstadoOcorrenciaEnum;
  aoFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const mutacao = useOcorrenciasTransicao<ErroApi>();
  const recarregar = useRecarregar(ocorrencia.id);
  const exige = estado === "cancelada";
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`${ACOES_ESTADO_OCORRENCIA[estado]} ${ocorrencia.codigo}`}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao
            variante={exige ? "perigo" : "primario"}
            disabled={(exige && !motivo.trim()) || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { id: ocorrencia.id, data: { estado, motivo: motivo.trim() } },
                { onSuccess: async () => (await recarregar(), aoFechar()) },
              )
            }
          >
            Confirmar
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <Campo
        rotulo={exige ? "Justificativa do cancelamento" : "Observação (opcional)"}
        obrigatorio={exige}
      >
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}

function PrioridadeDialogo({
  ocorrencia,
  aoFechar,
}: {
  ocorrencia: Ocorrencia;
  aoFechar: () => void;
}) {
  const [prioridade, setPrioridade] = useState<PrioridadeEnum>(
    (ocorrencia.prioridade as PrioridadeEnum) || "media",
  );
  const [motivo, setMotivo] = useState("");
  const mutacao = useOcorrenciasPrioridade<ErroApi>();
  const recarregar = useRecarregar(ocorrencia.id);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Definir prioridade operacional"
      descricao="A prioridade ordena o atendimento. Não é avaliação de risco."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { id: ocorrencia.id, data: { prioridade, motivo: motivo.trim() } },
                { onSuccess: async () => (await recarregar(), aoFechar()) },
              )
            }
          >
            Salvar
          </Botao>
        </>
      }
    >
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

function RiscoDialogo({ ocorrencia, aoFechar }: { ocorrencia: Ocorrencia; aoFechar: () => void }) {
  const [descricao, setDescricao] = useState("");
  const mutacao = useOcorrenciasRisco<ErroApi>();
  const recarregar = useRecarregar(ocorrencia.id);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Registrar risco confirmado"
      descricao="Use somente após avaliação técnica. O registro fica vinculado ao seu nome e registro profissional e não pode ser desfeito."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={!descricao.trim() || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { id: ocorrencia.id, data: { descricao: descricao.trim() } },
                { onSuccess: async () => (await recarregar(), aoFechar()) },
              )
            }
          >
            Registrar risco
          </Botao>
        </>
      }
    >
      {mutacao.error && <p className="mb-3 text-sm text-perigo">{mutacao.error.message}</p>}
      <Campo
        rotulo="Avaliação técnica"
        obrigatorio
        ajuda="Descreva método, achados e conclusão da avaliação."
      >
        {(p) => (
          <AreaTexto
            {...p}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="min-h-32"
          />
        )}
      </Campo>
    </Dialogo>
  );
}

function AtribuicaoDialogo({
  ocorrencia,
  aoFechar,
}: {
  ocorrencia: Ocorrencia;
  aoFechar: () => void;
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
  const [responsavel, setResponsavel] = useState(ocorrencia.responsavel?.id ?? "");
  const [equipe, setEquipe] = useState(ocorrencia.equipe?.id ?? "");
  const [prazo, setPrazo] = useState(ocorrencia.prazo ?? "");
  const mutacao = useOcorrenciasAtualizar<ErroApi>();
  const recarregar = useRecarregar(ocorrencia.id);
  // Sem acesso à lista de usuários, oferece ao menos os membros das equipes.
  const membros = equipes.data?.data.results.flatMap((e) => e.membros) ?? [];
  const opcoes = podeVerUsuarios
    ? (usuarios.data?.data.results ?? []).map((u) => ({ id: u.id, nome: u.nome || u.email }))
    : [...new Map(membros.map((m) => [m.id, { id: m.id, nome: m.nome || m.email }])).values()];

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Atribuição"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                {
                  id: ocorrencia.id,
                  data: {
                    responsavel_id: responsavel || null,
                    equipe_id: equipe || null,
                    prazo: prazo || null,
                  },
                },
                { onSuccess: async () => (await recarregar(), aoFechar()) },
              )
            }
          >
            Salvar
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Responsável">
          {(p) => (
            <Selecao {...p} value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Não atribuído</option>
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
              <option value="">Não atribuída</option>
              {equipes.data?.data.results.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Prazo">
          {(p) => (
            <Entrada {...p} type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          )}
        </Campo>
      </div>
    </Dialogo>
  );
}
