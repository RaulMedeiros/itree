import {
  ErroApi,
  MetodoMedidaEnum,
  OrigemValorEnum,
  TipoMedidaEnum,
  getArvoresHistoricoQueryKey,
  getArvoresObterQueryKey,
  useArvoresAtualizar,
  useArvoresExcluir,
  useArvoresHistorico,
  useArvoresMedidasCriar,
  useArvoresObter,
  useEspeciesListar,
  useOcorrenciasListar,
  type Arvore,
} from "@itree/api-client";
import {
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_METODO_MEDIDA,
  ROTULOS_ORIGEM_REGISTRO,
  ROTULOS_ORIGEM_VALOR,
  ROTULOS_SITUACAO_ARVORE,
  ROTULOS_TIPO_MEDIDA,
  UNIDADES_MEDIDA,
} from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Map as IconeMapa, Pencil, Ruler, Trash2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Evidencias } from "../../componentes/Evidencias";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeletorLocalizacao, type Ponto } from "../../componentes/SeletorLocalizacao";
import {
  SeloEspecie,
  SeloEstadoOcorrencia,
  SeloLocalizacao,
  SeloOrigemValor,
  SeloPrioridade,
  nomeEspecie,
} from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { NovaOcorrenciaDialogo } from "../ocorrencias/NovaOcorrenciaDialogo";
import { invalidarCaminhos } from "../../util/cache";

type Aba = "resumo" | "medidas" | "ocorrencias" | "evidencias" | "historico";

export function ArvoreDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/inventario/arvores/$id" });
  const consulta = useArvoresObter(id);
  return (
    <>
      <Link
        to="/inventario/arvores"
        className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Árvores
      </Link>
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <Detalhe arvore={consulta.data.data} />
      )}
    </>
  );
}

function Detalhe({ arvore }: { arvore: Arvore }) {
  const [aba, setAba] = useState<Aba>("resumo");
  const [editando, setEditando] = useState(false);
  const [medindo, setMedindo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [ocorrencia, setOcorrencia] = useState(false);
  const podeEditar = usePermissao("inventario.editar") && arvore.situacao === "ativa";
  const podeExcluir = usePermissao("inventario.fundir_excluir") && arvore.situacao === "ativa";
  const podeOcorrencia =
    usePermissao("ocorrencias.editar") && arvore.situacao === "ativa" && !!arvore.localizacao;

  const abas: { id: Aba; rotulo: string }[] = [
    { id: "resumo", rotulo: "Resumo" },
    { id: "medidas", rotulo: "Medidas" },
    {
      id: "ocorrencias",
      rotulo: `Ocorrências${arvore.ocorrencias_abertas ? ` (${arvore.ocorrencias_abertas} abertas)` : ""}`,
    },
    { id: "evidencias", rotulo: "Evidências" },
    { id: "historico", rotulo: "Histórico" },
  ];

  return (
    <>
      <CabecalhoPagina
        titulo={arvore.codigo}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <span className={arvore.especie ? "italic" : ""}>{nomeEspecie(arvore)}</span>
            <SeloEspecie estado={arvore.especie_estado ?? "nao_identificada"} />
            {arvore.situacao !== "ativa" && (
              <Selo tom="perigo">{ROTULOS_SITUACAO_ARVORE[arvore.situacao]}</Selo>
            )}
          </span>
        }
        acoes={
          <>
            {arvore.localizacao && (
              <Botao variante="secundario" asChild>
                <Link
                  to="/mapa"
                  search={{
                    lon: arvore.localizacao.longitude,
                    lat: arvore.localizacao.latitude,
                    zoom: 18,
                    selecao: `arvore:${arvore.id}`,
                  }}
                >
                  <IconeMapa /> No mapa
                </Link>
              </Botao>
            )}
            {podeOcorrencia && (
              <Botao variante="secundario" onClick={() => setOcorrencia(true)}>
                <TriangleAlert /> Registrar ocorrência
              </Botao>
            )}
            {podeEditar && (
              <Botao variante="secundario" onClick={() => setEditando(true)}>
                <Pencil /> Editar
              </Botao>
            )}
            {podeExcluir && (
              <Botao variante="secundario" onClick={() => setExcluindo(true)}>
                <Trash2 /> Excluir
              </Botao>
            )}
          </>
        }
      />

      {arvore.situacao === "fundida" && arvore.fundida_em && (
        <p className="mb-4 rounded-md bg-info-clara px-3 py-2 text-sm text-info">
          Este registro foi fundido em{" "}
          <Link
            to="/inventario/arvores/$id"
            params={{ id: arvore.fundida_em }}
            className="font-medium underline"
          >
            outro registro
          </Link>
          . Histórico, medidas e evidências foram transferidos para ele.
        </p>
      )}
      {arvore.situacao === "excluida" && (
        <p className="mb-4 rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
          Registro excluído. Justificativa: {arvore.motivo_situacao}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Seções da árvore"
        className="mb-4 flex gap-1 border-b border-borda"
      >
        {abas.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.id ? "border-marca font-medium" : "border-transparent text-texto-suave hover:text-texto"}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {aba === "resumo" && <Resumo arvore={arvore} />}
        {aba === "medidas" && (
          <Medidas arvore={arvore} podeMedir={podeEditar} aoMedir={() => setMedindo(true)} />
        )}
        {aba === "ocorrencias" && <OcorrenciasDaArvore arvoreId={arvore.id} />}
        {aba === "evidencias" && (
          <Evidencias alvo={{ arvore: arvore.id }} podeEnviar={podeEditar} />
        )}
        {aba === "historico" && <Historico arvoreId={arvore.id} />}
      </div>

      {editando && <EditarDialogo arvore={arvore} aoFechar={() => setEditando(false)} />}
      {medindo && <MedidaDialogo arvore={arvore} aoFechar={() => setMedindo(false)} />}
      {excluindo && <ExcluirDialogo arvore={arvore} aoFechar={() => setExcluindo(false)} />}
      {ocorrencia && (
        <NovaOcorrenciaDialogo
          arvore={{ id: arvore.id, codigo: arvore.codigo }}
          aoFechar={() => setOcorrencia(false)}
        />
      )}
    </>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-texto-suave uppercase">{rotulo}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Resumo({ arvore }: { arvore: Arvore }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-lg border border-borda bg-superficie p-4 lg:col-span-2">
        <h2 className="mb-3 font-semibold">Identificação e localização</h2>
        <dl className="grid grid-cols-2 gap-4">
          <Item rotulo="Espécie">
            <span className={arvore.especie ? "italic" : ""}>{nomeEspecie(arvore)}</span>
            {arvore.especie?.nomes_comuns?.length ? (
              <span className="text-texto-suave"> · {arvore.especie.nomes_comuns.join(", ")}</span>
            ) : null}
            <div className="mt-1">
              <SeloEspecie estado={arvore.especie_estado ?? "nao_identificada"} />
            </div>
          </Item>
          <Item rotulo="Localização">
            {arvore.localizacao ? (
              <span className="font-mono text-xs">
                {arvore.localizacao.latitude.toFixed(6)}, {arvore.localizacao.longitude.toFixed(6)}
              </span>
            ) : (
              "Sem localização"
            )}
            <div className="mt-1">
              <SeloLocalizacao
                origem={arvore.localizacao_origem ?? ""}
                precisao={arvore.precisao_m}
              />
            </div>
            {!arvore.precisao_m && arvore.localizacao && (
              <p className="mt-1 text-xs text-texto-suave">Precisão não informada pela origem.</p>
            )}
          </Item>
          <Item rotulo="Endereço">{arvore.endereco || "—"}</Item>
          <Item rotulo="Bairro">{arvore.bairro?.nome ?? "Fora dos bairros cadastrados"}</Item>
          <Item rotulo="Identificadores externos">
            {arvore.identificadores.length
              ? arvore.identificadores.map((i) => (
                  <div key={`${i.fonte}-${i.valor}`}>
                    <span className="font-mono">{i.valor}</span>{" "}
                    <span className="text-texto-suave">({i.fonte})</span>
                  </div>
                ))
              : "—"}
          </Item>
          <Item rotulo="Observações">{arvore.observacoes || "—"}</Item>
        </dl>
      </section>
      <section className="rounded-lg border border-borda bg-superficie p-4">
        <h2 className="mb-3 font-semibold">Proveniência do cadastro</h2>
        <dl className="flex flex-col gap-3">
          <Item rotulo="Origem do registro">{ROTULOS_ORIGEM_REGISTRO[arvore.origem_registro]}</Item>
          {arvore.lote && (
            <Item rotulo="Lote de importação">
              <Link to="/inventario/importacoes" className="text-marca-escura hover:underline">
                Lote nº {String(arvore.lote.numero)}
              </Link>{" "}
              — {String(arvore.lote.fonte)}
            </Item>
          )}
          <Item rotulo="Cadastrado por">{arvore.criado_por_nome || "—"}</Item>
          <Item rotulo="Cadastrado em">{formatarDataHora(arvore.criado_em)}</Item>
          <Item rotulo="Última alteração">{formatarDataHora(arvore.atualizado_em)}</Item>
          <Item rotulo="Condição aparente">
            <span className="text-texto-suave">
              Sem avaliação registrada (inspeções chegam na F2).
            </span>
          </Item>
        </dl>
      </section>
    </div>
  );
}

function Medidas({
  arvore,
  podeMedir,
  aoMedir,
}: {
  arvore: Arvore;
  podeMedir: boolean;
  aoMedir: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {podeMedir && (
        <div>
          <Botao variante="secundario" onClick={aoMedir}>
            <Ruler /> Registrar medida
          </Botao>
        </div>
      )}
      {arvore.medidas_atuais.length === 0 ? (
        <Vazio titulo="Nenhuma medida registrada" />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Medida (mais recente)</Th>
              <Th>Valor</Th>
              <Th>Origem</Th>
              <Th>Método</Th>
              <Th>Data</Th>
              <Th>Responsável</Th>
            </tr>
          </thead>
          <tbody>
            {arvore.medidas_atuais.map((m) => (
              <Linha key={m.id}>
                <Td className="font-medium">{ROTULOS_TIPO_MEDIDA[m.tipo]}</Td>
                <Td className="font-mono">
                  {m.origem === "estimado" ? "≈ " : ""}
                  {Number(m.valor).toLocaleString("pt-BR")} {m.unidade}
                </Td>
                <Td>
                  <SeloOrigemValor origem={m.origem} />
                </Td>
                <Td>{ROTULOS_METODO_MEDIDA[m.metodo]}</Td>
                <Td>{formatarData(m.data_medicao) ?? "Não informada"}</Td>
                <Td>{m.responsavel_nome || "—"}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      <p className="text-xs text-texto-suave">
        Medidas anteriores ficam no histórico. Valores estimados aparecem com “≈” e não substituem
        medições.
      </p>
    </div>
  );
}

function OcorrenciasDaArvore({ arvoreId }: { arvoreId: string }) {
  const podeVer = usePermissao("ocorrencias.ler");
  const consulta = useOcorrenciasListar(
    { arvore: arvoreId, tamanho: 100 },
    { query: { enabled: podeVer } },
  );
  if (!podeVer) return <Vazio titulo="Você não tem acesso às ocorrências" />;
  if (consulta.isPending) return <Carregando linhas={3} />;
  if (consulta.isError) return <Erro erro={consulta.error} />;
  if (consulta.data.data.count === 0) return <Vazio titulo="Nenhuma ocorrência para esta árvore" />;
  return (
    <Tabela>
      <thead>
        <tr>
          <Th>Código</Th>
          <Th>Tipo</Th>
          <Th>Estado</Th>
          <Th>Prioridade</Th>
          <Th>Registrada em</Th>
        </tr>
      </thead>
      <tbody>
        {consulta.data.data.results.map((o) => (
          <Linha key={o.id}>
            <Td>
              <Link
                to="/ocorrencias/$id"
                params={{ id: o.id }}
                className="font-mono font-medium text-marca-escura hover:underline"
              >
                {o.codigo}
              </Link>
            </Td>
            <Td>{o.tipo.nome}</Td>
            <Td>
              <SeloEstadoOcorrencia estado={o.estado} />
            </Td>
            <Td>
              <SeloPrioridade prioridade={o.prioridade} />
            </Td>
            <Td>{formatarDataHora(o.criado_em)}</Td>
          </Linha>
        ))}
      </tbody>
    </Tabela>
  );
}

function Historico({ arvoreId }: { arvoreId: string }) {
  const consulta = useArvoresHistorico(arvoreId);
  return (
    <LinhaDoTempo
      eventos={consulta.data?.data}
      carregando={consulta.isPending}
      erro={consulta.error}
    />
  );
}

function useAtualizarArvore(id: string) {
  const cliente = useQueryClient();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: getArvoresObterQueryKey(id) }),
      cliente.invalidateQueries({ queryKey: getArvoresHistoricoQueryKey(id) }),
      invalidarCaminhos(cliente, "/api/v1/arvores"),
    ]);
}

function EditarDialogo({ arvore, aoFechar }: { arvore: Arvore; aoFechar: () => void }) {
  const especies = useEspeciesListar({ tamanho: 500, ativa: true });
  const podeConfirmar = usePermissao("inspecoes.validar");
  const [especie, setEspecie] = useState(arvore.especie?.id ?? "");
  const [estado, setEstado] = useState(arvore.especie_estado ?? "nao_identificada");
  const [endereco, setEndereco] = useState(arvore.endereco ?? "");
  const [observacoes, setObservacoes] = useState(arvore.observacoes ?? "");
  const [ponto, setPonto] = useState<Ponto | null>(arvore.localizacao ?? null);
  const [motivo, setMotivo] = useState("");
  const atualizar = useArvoresAtualizar<ErroApi>();
  const recarregar = useAtualizarArvore(arvore.id);
  const erros = atualizar.error?.errosDeCampo ?? {};
  const localMudou =
    ponto?.latitude !== arvore.localizacao?.latitude ||
    ponto?.longitude !== arvore.localizacao?.longitude;
  const exigeMotivo =
    (arvore.especie_estado === "confirmada" &&
      (especie !== (arvore.especie?.id ?? "") || estado !== "confirmada")) ||
    (arvore.localizacao_origem === "gps_campo" && localMudou);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    atualizar.mutate(
      {
        id: arvore.id,
        data: {
          especie_id: especie || null,
          especie_estado: estado === "sugerida_ia" ? undefined : estado,
          endereco,
          observacoes,
          ...(localMudou && ponto ? { localizacao: ponto } : {}),
          motivo: motivo.trim() || undefined,
        },
      },
      { onSuccess: async () => (await recarregar(), aoFechar()) },
    );
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Editar ${arvore.codigo}`}
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            type="submit"
            form="form-editar-arvore"
            disabled={atualizar.isPending || (exigeMotivo && !motivo.trim())}
          >
            Salvar
          </Botao>
        </>
      }
    >
      <form id="form-editar-arvore" onSubmit={enviar} className="flex flex-col gap-4">
        {atualizar.error && (
          <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {Object.values(erros).flat()[0] ?? atualizar.error.message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Espécie">
            {(p) => (
              <Selecao {...p} value={especie} onChange={(e) => setEspecie(e.target.value)}>
                <option value="">Não identificada</option>
                {especies.data?.data.results.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome_cientifico}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
          <Campo
            rotulo="Situação da identificação"
            ajuda={podeConfirmar ? undefined : "Só revisores podem confirmar a espécie."}
          >
            {(p) => (
              <Selecao
                {...p}
                value={estado}
                onChange={(e) => setEstado(e.target.value as typeof estado)}
              >
                {(["nao_identificada", "informada", "confirmada"] as const).map((v) => (
                  <option key={v} value={v} disabled={v === "confirmada" && !podeConfirmar}>
                    {ROTULOS_ESTADO_ESPECIE[v]}
                  </option>
                ))}
                {estado === "sugerida_ia" && (
                  <option value="sugerida_ia">{ROTULOS_ESTADO_ESPECIE.sugerida_ia}</option>
                )}
              </Selecao>
            )}
          </Campo>
        </div>
        <Campo rotulo="Endereço">
          {(p) => <Entrada {...p} value={endereco} onChange={(e) => setEndereco(e.target.value)} />}
        </Campo>
        <Campo rotulo="Observações">
          {(p) => (
            <AreaTexto
              {...p}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          )}
        </Campo>
        <SeletorLocalizacao valor={ponto} aoMudar={setPonto} erros={erros.localizacao} />
        <Campo
          rotulo="Justificativa"
          obrigatorio={exigeMotivo}
          ajuda={
            exigeMotivo
              ? "Obrigatória: você está alterando um dado validado."
              : "Opcional; fica registrada na auditoria."
          }
          erros={erros.motivo}
        >
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </form>
    </Dialogo>
  );
}

function MedidaDialogo({ arvore, aoFechar }: { arvore: Arvore; aoFechar: () => void }) {
  const [tipo, setTipo] = useState<TipoMedidaEnum>("altura");
  const [valor, setValor] = useState("");
  const [metodo, setMetodo] = useState<MetodoMedidaEnum>("trena");
  const [origem, setOrigem] = useState<OrigemValorEnum>("medido");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [observacao, setObservacao] = useState("");
  const criar = useArvoresMedidasCriar<ErroApi>();
  const recarregar = useAtualizarArvore(arvore.id);
  const erros = criar.error?.errosDeCampo ?? {};
  const estimativo = metodo === "visual" || metodo === "imagem";

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate(
      {
        id: arvore.id,
        data: {
          tipo,
          valor: valor.replace(",", "."),
          metodo,
          origem: estimativo ? "estimado" : origem,
          data_medicao: data,
          observacao,
        },
      },
      { onSuccess: async () => (await recarregar(), aoFechar()) },
    );
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Registrar medida"
      descricao="Toda medida guarda método, unidade, data, responsável e origem (RN-INV-002)."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-medida" disabled={!valor || criar.isPending}>
            Registrar
          </Botao>
        </>
      }
    >
      <form id="form-medida" onSubmit={enviar} className="grid grid-cols-2 gap-3">
        <Campo rotulo="Medida" erros={erros.tipo}>
          {(p) => (
            <Selecao
              {...p}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoMedidaEnum)}
            >
              {Object.values(TipoMedidaEnum).map((t) => (
                <option key={t} value={t}>
                  {ROTULOS_TIPO_MEDIDA[t]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo={`Valor (${UNIDADES_MEDIDA[tipo]})`} obrigatorio erros={erros.valor}>
          {(p) => (
            <Entrada
              {...p}
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          )}
        </Campo>
        <Campo rotulo="Método" erros={erros.metodo}>
          {(p) => (
            <Selecao
              {...p}
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as MetodoMedidaEnum)}
            >
              {Object.values(MetodoMedidaEnum)
                .filter((m) => m !== "desconhecido")
                .map((m) => (
                  <option key={m} value={m}>
                    {ROTULOS_METODO_MEDIDA[m]}
                  </option>
                ))}
            </Selecao>
          )}
        </Campo>
        <Campo
          rotulo="Origem do valor"
          erros={erros.origem}
          ajuda={
            estimativo
              ? "Estimativas visuais ou por imagem são sempre registradas como estimadas."
              : undefined
          }
        >
          {(p) => (
            <Selecao
              {...p}
              value={estimativo ? "estimado" : origem}
              disabled={estimativo}
              onChange={(e) => setOrigem(e.target.value as OrigemValorEnum)}
            >
              {(["medido", "estimado"] as const).map((o) => (
                <option key={o} value={o}>
                  {ROTULOS_ORIGEM_VALOR[o]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Data da medição" erros={erros.data_medicao}>
          {(p) => (
            <Entrada {...p} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          )}
        </Campo>
        <div className="col-span-2">
          <Campo rotulo="Observação">
            {(p) => (
              <AreaTexto
                {...p}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            )}
          </Campo>
        </div>
      </form>
    </Dialogo>
  );
}

function ExcluirDialogo({ arvore, aoFechar }: { arvore: Arvore; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const excluir = useArvoresExcluir<ErroApi>();
  const recarregar = useAtualizarArvore(arvore.id);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Excluir ${arvore.codigo}`}
      descricao="A exclusão é lógica: o registro e todo o histórico são preservados e a ação fica na auditoria."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={!motivo.trim() || excluir.isPending}
            onClick={() =>
              excluir.mutate(
                { id: arvore.id, data: { motivo: motivo.trim() } },
                { onSuccess: async () => (await recarregar(), aoFechar()) },
              )
            }
          >
            Excluir
          </Botao>
        </>
      }
    >
      {excluir.error && <p className="mb-3 text-sm text-perigo">{excluir.error.message}</p>}
      <Campo
        rotulo="Justificativa"
        obrigatorio
        ajuda="Ex.: supressão autorizada pelo processo nº …"
      >
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}
