import {
  ErroApi,
  useEvidenciasListar,
  useInspecoesDevolver,
  useInspecoesHistorico,
  useInspecoesObter,
  useEquipesListar,
  useInspecoesValidar,
  useInspecoesValidarEEncaminhar,
  useTiposOcorrenciaListar,
  type Inspecao,
} from "@itree/api-client";
import {
  ROTULOS_CONDICAO,
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_METODO_MEDIDA,
  ROTULOS_ORIGEM_INSPECAO,
  ROTULOS_SINAL,
  ROTULOS_TIPO_MEDIDA,
} from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePermissao, useUsuario } from "../../acesso/ContextoUsuario";
import { Evidencias } from "../../componentes/Evidencias";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloEstadoInspecao, SeloLocalizacao, SeloOrigemValor } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, EntradaData, ListaMarcavel, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { cn } from "../../util/cn";
import { invalidarCaminhos } from "../../util/cache";
import {
  formatarData,
  formatarDataHora,
  formatarPontoGeografico,
  plural,
} from "../../util/formatos";
import { compararMedidas, descreverDiferenca, descreverMedidaAnterior } from "./medidas";

const ROTULOS_APLICAVEL: Record<string, string> = {
  especie: "espécie",
  condicao_aparente: "condição aparente",
  medidas: "medidas",
  localizacao: "localização GPS",
};

export function InspecaoDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/inspecoes/$id" });
  const consulta = useInspecoesObter(id);
  return (
    <div className="mx-auto max-w-6xl">
      {/* Com os dados carregados, as migalhas do cabeçalho já levam de volta; o link só fica no erro. */}
      {consulta.isError && (
        <Link
          to="/inspecoes"
          className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
        >
          <ArrowLeft className="size-4" aria-hidden /> Inspeções
        </Link>
      )}
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <Detalhe inspecao={consulta.data.data} />
      )}
    </div>
  );
}

function Linha3({
  campo,
  inspecao,
  cadastro,
  anterior,
  destaque,
}: {
  campo: string;
  inspecao: ReactNode;
  cadastro: ReactNode;
  anterior?: ReactNode;
  destaque?: boolean;
}) {
  return (
    <tr className="border-t border-borda align-top">
      <th scope="row" className="py-2 pr-4 text-left text-sm font-medium">
        {campo}
      </th>
      <td className={cn("py-2 pr-4 text-sm", destaque && "font-medium text-marca-escura")}>
        {inspecao}
      </td>
      <td className="py-2 pr-4 text-sm">{cadastro}</td>
      {anterior !== undefined && <td className="py-2 text-sm text-texto-suave">{anterior}</td>}
    </tr>
  );
}

function Detalhe({ inspecao: i }: { inspecao: Inspecao }) {
  const eu = useUsuario();
  const podeValidar =
    usePermissao("inspecoes.validar") && i.estado === "em_revisao" && i.tecnico.id !== eu.id;
  const podeRegistrarOcorrencia = usePermissao("ocorrencias.editar");
  const podeEncaminhar = podeValidar && podeRegistrarOcorrencia;
  const [validando, setValidando] = useState<"validar" | "encaminhar" | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);
  const historico = useInspecoesHistorico(i.id);
  // Mesma consulta da seção de evidências: o aviso e a lista nunca divergem.
  const evidencias = useEvidenciasListar({ inspecao: i.id });
  const semEvidencias = evidencias.isSuccess && evidencias.data.data.length === 0;
  const a = i.arvore;
  const comparacoes = compararMedidas(i.medidas, i.medidas_do_cadastro);
  const condicao = ROTULOS_CONDICAO[i.condicao_aparente ?? "nao_avaliada"];

  return (
    <>
      <CabecalhoPagina
        titulo={`${i.codigo} · ${a.codigo}`}
        migalhas={[{ rotulo: "Inspeções", para: "/inspecoes" }, { rotulo: i.codigo }]}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <SeloEstadoInspecao estado={i.estado ?? "rascunho"} />
            <span>
              Realizada em {formatarDataHora(i.realizada_em)} por{" "}
              {i.tecnico.nome || i.tecnico.email} · {ROTULOS_ORIGEM_INSPECAO[i.origem ?? "app"]}
              {i.dispositivo ? ` (${i.dispositivo})` : ""} · recebida em{" "}
              {formatarDataHora(i.recebida_em)}
              {i.tarefa && (
                <>
                  {" · tarefa "}
                  <Link
                    to="/equipes-tarefas/$id"
                    params={{ id: String(i.tarefa.id) }}
                    className="font-mono text-marca-escura hover:underline"
                  >
                    {String(i.tarefa.codigo)}
                  </Link>
                </>
              )}
            </span>
          </span>
        }
      />
      {i.estado === "em_revisao" && i.tecnico.id === eu.id && (
        <p className="mb-4 rounded-md bg-info-clara px-3 py-2 text-sm text-info">
          Esta inspeção é sua: a validação deve ser feita por outra pessoa.
        </p>
      )}
      {i.motivo_devolucao && i.estado === "devolvida" && (
        <p className="mb-4 rounded-md bg-atencao-clara px-3 py-2 text-sm text-atencao">
          Devolvida: {i.motivo_devolucao}
        </p>
      )}
      {!i.arvore_confirmada && (
        <p className="mb-4 rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
          O técnico indicou que o registro pode não corresponder à árvore observada.
        </p>
      )}
      {i.estado === "validada" && (
        <p className="mb-4 rounded-md bg-sucesso-clara px-3 py-2 text-sm text-sucesso">
          Validada por {i.revisor?.nome || i.revisor?.email} em {formatarDataHora(i.validada_em)}.
          Aplicado ao cadastro:{" "}
          {i.aplicado_ao_cadastro?.length
            ? i.aplicado_ao_cadastro.map((c) => ROTULOS_APLICAVEL[c] ?? c).join(", ")
            : "nada (somente registro da inspeção)"}
          .
          {i.ocorrencias_geradas.length > 0 && (
            <>
              {" "}
              Ocorrência aberta:{" "}
              {i.ocorrencias_geradas.map((o, n) => (
                <span key={o.id}>
                  {n > 0 && ", "}
                  <Link
                    to="/ocorrencias/$id"
                    params={{ id: o.id }}
                    className="font-mono font-medium underline"
                  >
                    {o.codigo}
                  </Link>
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}

      <section className="mb-6 overflow-x-auto rounded-lg border border-borda bg-superficie p-4">
        <h2 className="mb-2 font-semibold">Comparação</h2>
        {!i.anterior && (
          <p className="mb-2 text-xs text-texto-suave">Não há inspeção anterior desta árvore.</p>
        )}
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs tracking-wide text-texto-suave uppercase">
              <th className="pb-2" />
              <th className="pb-2">Esta inspeção</th>
              <th className="pb-2">
                Cadastro atual (
                <Link
                  to="/inventario/arvores/$id"
                  params={{ id: a.id }}
                  className="text-marca-escura normal-case hover:underline"
                >
                  {a.codigo}
                </Link>
                )
              </th>
              {i.anterior && <th className="pb-2">Inspeção anterior</th>}
            </tr>
          </thead>
          <tbody>
            <Linha3
              campo="Espécie"
              inspecao={
                i.especie ? <i>{i.especie.nome_cientifico}</i> : i.especie_texto || "Não informada"
              }
              cadastro={
                a.especie ? (
                  <>
                    <i>{a.especie.nome_cientifico}</i>{" "}
                    <Selo>{ROTULOS_ESTADO_ESPECIE[a.especie_estado ?? "nao_identificada"]}</Selo>
                  </>
                ) : (
                  "Não identificada"
                )
              }
              anterior={i.anterior ? (i.anterior.especie?.nome_cientifico ?? "—") : undefined}
              destaque={!!i.especie && i.especie.id !== a.especie?.id}
            />
            <Linha3
              campo="Condição aparente"
              inspecao={condicao}
              cadastro={
                a.condicao_aparente
                  ? ROTULOS_CONDICAO[a.condicao_aparente as keyof typeof ROTULOS_CONDICAO]
                  : "Sem avaliação registrada"
              }
              anterior={
                i.anterior
                  ? ROTULOS_CONDICAO[i.anterior.condicao_aparente ?? "nao_avaliada"]
                  : undefined
              }
              destaque={i.condicao_aparente !== a.condicao_aparente}
            />
            <Linha3
              campo="Localização"
              inspecao={
                i.localizacao ? (
                  <>
                    <span className="font-mono text-xs">
                      {formatarPontoGeografico(i.localizacao.latitude, i.localizacao.longitude)}
                    </span>
                    <br />
                    <SeloLocalizacao origem="gps_campo" precisao={i.precisao_m} />
                  </>
                ) : (
                  "Sem GPS"
                )
              }
              cadastro={
                a.localizacao ? (
                  <>
                    <span className="font-mono text-xs">
                      {formatarPontoGeografico(a.localizacao.latitude, a.localizacao.longitude)}
                    </span>
                    <br />
                    <SeloLocalizacao origem={a.localizacao_origem ?? ""} precisao={a.precisao_m} />
                  </>
                ) : (
                  "—"
                )
              }
              anterior={i.anterior ? "—" : undefined}
            />
            {comparacoes.length === 0 ? (
              <Linha3
                campo="Medidas"
                inspecao={<span className="text-texto-suave">Nenhuma medida</span>}
                cadastro="—"
                anterior={i.anterior ? "—" : undefined}
              />
            ) : (
              comparacoes.map((c) => (
                <Linha3
                  key={c.proposta.id}
                  campo={ROTULOS_TIPO_MEDIDA[c.proposta.tipo]}
                  inspecao={
                    <>
                      <span className="font-mono">
                        {c.proposta.origem === "estimado" ? "≈ " : ""}
                        {Number(c.proposta.valor).toLocaleString("pt-BR")} {c.proposta.unidade}
                      </span>{" "}
                      <SeloOrigemValor origem={c.proposta.origem} />
                      <p className="text-xs font-normal text-texto-suave">
                        {ROTULOS_METODO_MEDIDA[c.proposta.metodo]}
                      </p>
                      <p className="text-xs">{descreverDiferenca(c)}</p>
                    </>
                  }
                  cadastro={
                    c.cadastro ? (
                      <>
                        <span className="font-mono">
                          {c.cadastro.origem === "estimado" ? "≈ " : ""}
                          {Number(c.cadastro.valor).toLocaleString("pt-BR")} {c.cadastro.unidade}
                        </span>
                        {c.cadastro.data_medicao && (
                          <p className="text-xs text-texto-suave">
                            em {formatarData(c.cadastro.data_medicao)}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-texto-suave">Sem valor no cadastro</span>
                    )
                  }
                  anterior={
                    i.anterior
                      ? descreverMedidaAnterior(i.anterior.medidas, c.proposta.tipo)
                      : undefined
                  }
                  destaque={c.diferenca !== 0}
                />
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="mb-6">
        <section className="rounded-lg border border-borda bg-superficie p-4">
          <h2 className="mb-1 font-semibold">Sinais visuais observados</h2>
          <p className="mb-2 text-xs text-texto-suave">
            Sinais possíveis apontados em campo. Requerem avaliação; não são diagnóstico.
          </p>
          {i.sinais?.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {i.sinais.map((s) => (
                <li key={s}>
                  <Selo tom="atencao">{ROTULOS_SINAL[s]}</Selo>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-texto-suave">Nenhum sinal registrado.</p>
          )}
          {i.requer_encaminhamento && (
            <p className="mt-3 text-sm font-medium text-atencao">
              O técnico indicou que requer encaminhamento.
            </p>
          )}
          <h3 className="mt-4 mb-1 text-sm font-medium">Observações técnicas</h3>
          <p className="text-sm whitespace-pre-wrap">
            {i.observacoes || <span className="text-texto-suave">—</span>}
          </p>
        </section>
      </div>

      <h2 className="mb-2 font-semibold">Evidências</h2>
      <div className="mb-6">
        <Evidencias alvo={{ inspecao: i.id }} podeEnviar={false} />
      </div>

      <details className="mb-6 rounded-lg border border-borda bg-superficie p-4">
        <summary className="cursor-pointer font-semibold">Histórico técnico</summary>
        <div className="mt-3">
          <LinhaDoTempo
            eventos={historico.data?.data}
            carregando={historico.isPending}
            erro={historico.error}
          />
        </div>
      </details>

      {podeValidar && (
        <>
          {/* A barra é fixa na base da janela: este espaço impede que ela cubra o fim do conteúdo. */}
          <div aria-hidden data-reserva-barra className="h-20" />
          <div
            role="region"
            aria-label="Decisão da revisão"
            className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-borda bg-superficie px-6 py-3"
          >
            {semEvidencias && (
              <p className="mr-auto text-sm font-medium text-atencao">
                Sem evidências anexadas: confira com o técnico antes de validar.
              </p>
            )}
            <Botao variante="secundario" onClick={() => setDevolvendo(true)}>
              Devolver para correção
            </Botao>
            {podeEncaminhar && (
              <Botao
                variante={i.requer_encaminhamento ? "primario" : "secundario"}
                onClick={() => setValidando("encaminhar")}
              >
                Validar e encaminhar…
              </Botao>
            )}
            <Botao
              variante={podeEncaminhar && i.requer_encaminhamento ? "secundario" : "primario"}
              onClick={() => setValidando("validar")}
            >
              Validar…
            </Botao>
          </div>
        </>
      )}

      {validando && (
        <ValidarDialogo
          inspecao={i}
          encaminhar={validando === "encaminhar"}
          aoFechar={() => setValidando(null)}
        />
      )}
      {devolvendo && <DevolverDialogo inspecao={i} aoFechar={() => setDevolvendo(false)} />}
    </>
  );
}

function ValidarDialogo({
  inspecao: i,
  encaminhar,
  aoFechar,
}: {
  inspecao: Inspecao;
  /** Valida e abre a ocorrência de origem nesta inspeção (G-01). */
  encaminhar: boolean;
  aoFechar: () => void;
}) {
  const opcoes = [
    {
      valor: "condicao_aparente",
      rotulo: "Condição aparente",
      descricao: `Atualiza para “${ROTULOS_CONDICAO[i.condicao_aparente ?? "nao_avaliada"]}”.`,
      disponivel: i.condicao_aparente !== "nao_avaliada",
    },
    {
      valor: "medidas",
      rotulo: "Medidas",
      descricao: `${plural(i.medidas.length, "medida")} ${i.medidas.length === 1 ? "passa" : "passam"} a valer no cadastro.`,
      disponivel: i.medidas.length > 0,
    },
    {
      valor: "especie",
      rotulo: "Espécie",
      descricao: i.especie
        ? `Confirma ${i.especie.nome_cientifico}.`
        : "A inspeção não informou espécie do catálogo.",
      disponivel: !!i.especie,
    },
    {
      valor: "localizacao",
      rotulo: "Localização GPS",
      descricao: i.localizacao
        ? `Substitui a localização do cadastro (precisão ${i.precisao_m ? `±${Math.round(i.precisao_m)} m` : "não informada"}).`
        : "A inspeção não tem GPS.",
      disponivel: !!i.localizacao,
    },
  ];
  const [aplicar, setAplicar] = useState<string[]>(
    opcoes.filter((o) => o.disponivel && o.valor !== "localizacao").map((o) => o.valor),
  );
  const [motivo, setMotivo] = useState("");
  const validar = useInspecoesValidar<ErroApi>();
  const encaminhamento = useInspecoesValidarEEncaminhar<ErroApi>();
  const mutacao = encaminhar ? encaminhamento : validar;
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const podeTarefa = usePermissao("tarefas.editar");
  const tipos = useTiposOcorrenciaListar({ ativo: true }, { query: { enabled: encaminhar } });
  const equipes = useEquipesListar(
    { ativa: true, tamanho: 200 },
    { query: { enabled: encaminhar && podeTarefa } },
  );
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState(i.observacoes ?? "");
  const [prazo, setPrazo] = useState("");
  const [criarTarefa, setCriarTarefa] = useState(false);
  const [equipe, setEquipe] = useState("");
  const aplicarSelecionado = aplicar as (
    "especie" | "condicao_aparente" | "medidas" | "localizacao"
  )[];
  const erros = encaminhamento.error?.errosDeCampo ?? {};
  const enviar = () => {
    if (!encaminhar) {
      validar.mutate(
        { id: i.id, data: { aplicar: aplicarSelecionado, motivo } },
        {
          onSuccess: async () => (
            await invalidarCaminhos(cliente, "/api/v1/inspecoes", "/api/v1/arvores"),
            aoFechar()
          ),
        },
      );
      return;
    }
    encaminhamento.mutate(
      {
        id: i.id,
        data: {
          aplicar: aplicarSelecionado,
          motivo,
          tipo_id: tipo,
          descricao: descricao.trim(),
          prazo: prazo || null,
          criar_tarefa: criarTarefa,
          equipe_id: criarTarefa ? equipe || null : null,
        },
      },
      {
        onSuccess: async (r) => {
          await invalidarCaminhos(
            cliente,
            "/api/v1/inspecoes",
            "/api/v1/arvores",
            "/api/v1/ocorrencias",
            "/api/v1/tarefas",
          );
          aoFechar();
          void navegar({ to: "/ocorrencias/$id", params: { id: r.data.ocorrencia.id } });
        },
      },
    );
  };
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`${encaminhar ? "Validar e encaminhar" : "Validar"} ${i.codigo}`}
      descricao={
        encaminhar
          ? "Valida a inspeção e abre uma ocorrência vinculada a ela e à árvore. Prioridade e risco ficam para quem tem essa atribuição."
          : "Escolha o que esta inspeção atualiza no cadastro da árvore. O que não for marcado fica só no registro da inspeção."
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={mutacao.isPending || (encaminhar && (!tipo || !descricao.trim()))}
            onClick={enviar}
          >
            {encaminhar ? "Validar e encaminhar" : "Validar"}
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo ?? {}).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <ListaMarcavel
          legenda="Aplicar ao cadastro"
          opcoes={opcoes
            .filter((o) => o.disponivel)
            .map(({ valor, rotulo, descricao }) => ({ valor, rotulo, descricao }))}
          selecionados={aplicar}
          aoAlterar={setAplicar}
          vazio="Nada a aplicar: a validação só registra a inspeção."
        />
        <Campo rotulo="Observação da revisão (opcional)">
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
        {encaminhar && (
          <fieldset className="flex flex-col gap-3 rounded-md border border-borda p-3">
            <legend className="px-1 text-sm font-medium">Ocorrência a abrir</legend>
            <Campo rotulo="Tipo" obrigatorio erros={erros.tipo_id}>
              {(p) => (
                <Selecao {...p} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="">Selecione</option>
                  {tipos.data?.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                      {t.prazo_padrao_dias ? ` (prazo ${plural(t.prazo_padrao_dias, "dia")})` : ""}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
            <Campo
              rotulo="O que deve ser atendido"
              obrigatorio
              ajuda="Começa com as observações da inspeção; ajuste se precisar."
              erros={erros.descricao}
            >
              {(p) => (
                <AreaTexto
                  {...p}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              )}
            </Campo>
            <Campo
              rotulo="Prazo (opcional)"
              ajuda="Vazio usa o prazo padrão do tipo."
              erros={erros.prazo}
            >
              {(p) => <EntradaData {...p} value={prazo} onChange={setPrazo} />}
            </Campo>
            {podeTarefa && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-marca"
                    checked={criarTarefa}
                    onChange={(e) => setCriarTarefa(e.target.checked)}
                  />
                  Criar também a tarefa de atendimento
                </label>
                {criarTarefa && (
                  <Campo rotulo="Equipe (opcional)">
                    {(p) => (
                      <Selecao {...p} value={equipe} onChange={(e) => setEquipe(e.target.value)}>
                        <option value="">Sem equipe</option>
                        {equipes.data?.data.results.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.nome}
                          </option>
                        ))}
                      </Selecao>
                    )}
                  </Campo>
                )}
              </>
            )}
          </fieldset>
        )}
      </div>
    </Dialogo>
  );
}

function DevolverDialogo({ inspecao: i, aoFechar }: { inspecao: Inspecao; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const devolver = useInspecoesDevolver<ErroApi>();
  const cliente = useQueryClient();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Devolver ${i.codigo}`}
      descricao="A inspeção volta ao técnico, que corrige no aplicativo e reenvia."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!motivo.trim() || devolver.isPending}
            onClick={() =>
              devolver.mutate(
                { id: i.id, data: { motivo: motivo.trim() } },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/inspecoes"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Devolver
          </Botao>
        </>
      }
    >
      <Campo rotulo="O que precisa ser corrigido" obrigatorio>
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}
