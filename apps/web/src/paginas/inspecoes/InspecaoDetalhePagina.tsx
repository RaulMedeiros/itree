import {
  ErroApi,
  useInspecoesDevolver,
  useInspecoesHistorico,
  useInspecoesObter,
  useInspecoesValidar,
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
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePermissao, useUsuario } from "../../acesso/ContextoUsuario";
import { Evidencias } from "../../componentes/Evidencias";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloEstadoInspecao, SeloLocalizacao, SeloOrigemValor } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, ListaMarcavel } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { cn } from "../../util/cn";
import { invalidarCaminhos } from "../../util/cache";
import { formatarDataHora } from "../../util/formatos";

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
      <Link
        to="/inspecoes"
        className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Inspeções
      </Link>
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
  anterior: ReactNode;
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
      <td className="py-2 text-sm text-texto-suave">{anterior}</td>
    </tr>
  );
}

function Detalhe({ inspecao: i }: { inspecao: Inspecao }) {
  const eu = useUsuario();
  const podeValidar =
    usePermissao("inspecoes.validar") && i.estado === "em_revisao" && i.tecnico.id !== eu.id;
  const [validando, setValidando] = useState(false);
  const [devolvendo, setDevolvendo] = useState(false);
  const historico = useInspecoesHistorico(i.id);
  const a = i.arvore;
  const condicao = ROTULOS_CONDICAO[i.condicao_aparente ?? "nao_avaliada"];

  return (
    <>
      <CabecalhoPagina
        titulo={`${i.codigo} · ${a.codigo}`}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <SeloEstadoInspecao estado={i.estado ?? "rascunho"} />
            <span>
              Realizada em {formatarDataHora(i.realizada_em)} por{" "}
              {i.tecnico.nome || i.tecnico.email} · {ROTULOS_ORIGEM_INSPECAO[i.origem ?? "app"]}
              {i.dispositivo ? ` (${i.dispositivo})` : ""} · recebida em{" "}
              {formatarDataHora(i.recebida_em)}
            </span>
          </span>
        }
        acoes={
          podeValidar && (
            <>
              <Botao variante="secundario" onClick={() => setDevolvendo(true)}>
                Devolver para correção
              </Botao>
              <Botao onClick={() => setValidando(true)}>Validar…</Botao>
            </>
          )
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
        </p>
      )}

      <section className="mb-6 overflow-x-auto rounded-lg border border-borda bg-superficie p-4">
        <h2 className="mb-2 font-semibold">Comparação</h2>
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
              <th className="pb-2">Inspeção anterior</th>
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
              anterior={i.anterior?.especie?.nome_cientifico ?? "—"}
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
                i.anterior ? ROTULOS_CONDICAO[i.anterior.condicao_aparente ?? "nao_avaliada"] : "—"
              }
              destaque={i.condicao_aparente !== a.condicao_aparente}
            />
            <Linha3
              campo="Localização"
              inspecao={
                i.localizacao ? (
                  <>
                    <span className="font-mono text-xs">
                      {i.localizacao.latitude.toFixed(6)}, {i.localizacao.longitude.toFixed(6)}
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
                      {a.localizacao.latitude.toFixed(6)}, {a.localizacao.longitude.toFixed(6)}
                    </span>
                    <br />
                    <SeloLocalizacao origem={a.localizacao_origem ?? ""} precisao={a.precisao_m} />
                  </>
                ) : (
                  "—"
                )
              }
              anterior="—"
            />
          </tbody>
        </table>
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
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
        <section className="rounded-lg border border-borda bg-superficie p-4">
          <h2 className="mb-2 font-semibold">Medidas registradas</h2>
          {i.medidas.length === 0 ? (
            <p className="text-sm text-texto-suave">Nenhuma medida.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {i.medidas.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{ROTULOS_TIPO_MEDIDA[m.tipo]}:</span>
                  <span className="font-mono">
                    {m.origem === "estimado" ? "≈ " : ""}
                    {Number(m.valor).toLocaleString("pt-BR")} {m.unidade}
                  </span>
                  <SeloOrigemValor origem={m.origem} />
                  <span className="text-texto-suave">{ROTULOS_METODO_MEDIDA[m.metodo]}</span>
                </li>
              ))}
            </ul>
          )}
          {i.tarefa && (
            <p className="mt-3 text-xs text-texto-suave">
              Vinculada à tarefa {String(i.tarefa.codigo)}.
            </p>
          )}
        </section>
      </div>

      <h2 className="mb-2 font-semibold">Evidências</h2>
      <div className="mb-6">
        <Evidencias alvo={{ inspecao: i.id }} podeEnviar={false} />
      </div>

      <h2 className="mb-3 font-semibold">Histórico</h2>
      <LinhaDoTempo
        eventos={historico.data?.data}
        carregando={historico.isPending}
        erro={historico.error}
      />

      {validando && <ValidarDialogo inspecao={i} aoFechar={() => setValidando(false)} />}
      {devolvendo && <DevolverDialogo inspecao={i} aoFechar={() => setDevolvendo(false)} />}
    </>
  );
}

function ValidarDialogo({ inspecao: i, aoFechar }: { inspecao: Inspecao; aoFechar: () => void }) {
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
      descricao: `${i.medidas.length} medida(s) passam a valer no cadastro.`,
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
  const cliente = useQueryClient();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Validar ${i.codigo}`}
      descricao="Escolha o que esta inspeção atualiza no cadastro da árvore. O que não for marcado fica só no registro da inspeção."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={validar.isPending}
            onClick={() =>
              validar.mutate(
                {
                  id: i.id,
                  data: {
                    aplicar: aplicar as (
                      "especie" | "condicao_aparente" | "medidas" | "localizacao"
                    )[],
                    motivo,
                  },
                },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/inspecoes", "/api/v1/arvores"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Validar
          </Botao>
        </>
      }
    >
      {validar.error && <p className="mb-3 text-sm text-perigo">{validar.error.message}</p>}
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
