import {
  ErroApi,
  importacoesColunas,
  useImportacoesConfirmar,
  useImportacoesCriar,
  useImportacoesDescartar,
  useImportacoesDesfazer,
  useImportacoesListar,
  useImportacoesObter,
  type ColunasArquivo,
  type LoteImportacao,
} from "@itree/api-client";
import { ROTULOS_ESTADO_LOTE } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileUp, Undo2 } from "lucide-react";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, EntradaArquivo, EntradaData, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora, plural } from "../../util/formatos";
import { invalidarCaminhos } from "../../util/cache";

const CAMPOS = [
  { id: "latitude", rotulo: "Latitude (ou Y)", obrigatorioCsv: true },
  { id: "longitude", rotulo: "Longitude (ou X)", obrigatorioCsv: true },
  { id: "id_externo", rotulo: "Identificador na fonte" },
  { id: "especie", rotulo: "Nome científico" },
  { id: "endereco", rotulo: "Endereço" },
  { id: "altura", rotulo: "Altura (m)" },
  { id: "dap", rotulo: "DAP (cm)" },
  { id: "precisao", rotulo: "Precisão da localização (m)" },
] as const;

/** Sugere a coluna pelo nome (lat, lon, especie…). */
function sugerir(colunas: string[], campo: string): string {
  const padroes: Record<string, RegExp> = {
    latitude: /^(lat|latitude|y)$/i,
    longitude: /^(lon|lng|long|longitude|x)$/i,
    id_externo: /^(id|codigo|código|cod|identificador)$/i,
    especie: /(especie|espécie|cientific)/i,
    endereco: /(endere|logradouro|rua)/i,
    altura: /^altura/i,
    dap: /^dap/i,
    precisao: /precis/i,
  };
  const padrao = padroes[campo];
  return (padrao && colunas.find((c) => padrao.test(c))) || "";
}

export function ImportacoesPagina() {
  const consulta = useImportacoesListar();
  const [assistente, setAssistente] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<LoteImportacao | null>(null);

  return (
    <>
      <CabecalhoPagina
        titulo="Importações"
        descricao="Importe inventários existentes (CSV ou GeoJSON). Nada é criado antes da confirmação, e cada registro guarda a fonte."
        acoes={
          <Botao onClick={() => setAssistente(true)}>
            <FileUp /> Nova importação
          </Botao>
        }
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio
          titulo="Nenhuma importação ainda"
          acao={<Botao onClick={() => setAssistente(true)}>Nova importação</Botao>}
        />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Lote</Th>
              <Th>Fonte</Th>
              <Th>Linhas</Th>
              <Th>Árvores criadas</Th>
              <Th>Situação</Th>
              <Th>Responsável</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.results.map((l) => (
              <Linha key={l.id}>
                <Td>
                  <p className="font-medium">nº {l.numero}</p>
                  <p className="text-xs text-texto-suave">{l.arquivo_nome}</p>
                </Td>
                <Td>
                  {l.fonte}
                  {l.data_referencia && (
                    <p className="text-xs text-texto-suave">
                      Dados de {formatarData(l.data_referencia)}
                    </p>
                  )}
                </Td>
                <Td>
                  {l.linhas_validas} de {l.total_linhas} válidas
                </Td>
                <Td>
                  {l.estado === "confirmado" ? (
                    <Link
                      to="/inventario/arvores"
                      search={{ situacao: "todas" }}
                      className="text-marca-escura hover:underline"
                    >
                      Ver {l.arvores_criadas} {l.arvores_criadas === 1 ? "árvore" : "árvores"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <Selo
                    tom={
                      l.estado === "confirmado"
                        ? "sucesso"
                        : l.estado === "pre_visualizado"
                          ? "info"
                          : "neutro"
                    }
                  >
                    {ROTULOS_ESTADO_LOTE[l.estado ?? "pre_visualizado"]}
                  </Selo>
                  <p className="text-xs text-texto-suave">
                    {formatarDataHora(l.confirmado_em ?? l.criado_em)}
                  </p>
                </Td>
                <Td>{l.usuario_nome}</Td>
                <Td className="text-right">
                  {l.estado === "pre_visualizado" && (
                    <Botao tamanho="pequeno" variante="secundario" onClick={() => setAberto(l.id)}>
                      Revisar
                    </Botao>
                  )}
                  {l.estado === "confirmado" && (
                    <>
                      <Botao
                        tamanho="pequeno"
                        variante="secundario"
                        disabled={!l.pode_desfazer}
                        onClick={() => setDesfazendo(l)}
                      >
                        <Undo2 /> Desfazer
                      </Botao>
                      {!l.pode_desfazer && (
                        <p className="mt-1 ml-auto max-w-56 text-xs text-texto-suave">
                          Desfazer indisponível:{" "}
                          {l.motivo_nao_desfazer ?? "o lote não pode ser desfeito."}
                        </p>
                      )}
                    </>
                  )}
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {assistente && (
        <AssistenteImportacao
          aoFechar={() => setAssistente(false)}
          aoCriar={(id) => {
            setAssistente(false);
            setAberto(id);
          }}
        />
      )}
      {aberto && <PreVisualizacao id={aberto} aoFechar={() => setAberto(null)} />}
      {desfazendo && <DesfazerDialogo lote={desfazendo} aoFechar={() => setDesfazendo(null)} />}
    </>
  );
}

/** Passos do assistente (R2-20): cada um corresponde a uma tela. */
const ETAPAS = ["Arquivo e fonte", "Colunas", "Revisão"];

/** Indicador 1-2-3: arquivo e fonte, correspondência de colunas e a revisão do lote. */
function Etapas({ atual }: { atual: number }) {
  return (
    <ol aria-label="Etapas da importação" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {ETAPAS.map((nome, i) => (
        <li
          key={nome}
          aria-current={atual === i + 1 ? "step" : undefined}
          className={atual === i + 1 ? "font-semibold" : "text-texto-suave"}
        >
          <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full border border-borda text-xs">
            {i + 1}
          </span>
          {nome}
        </li>
      ))}
    </ol>
  );
}

function AssistenteImportacao({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: (id: string) => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<ColunasArquivo | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [fonte, setFonte] = useState("");
  const [fonteUrl, setFonteUrl] = useState("");
  const [dataReferencia, setDataReferencia] = useState("");
  const [srid, setSrid] = useState("4326");
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({});
  const criar = useImportacoesCriar<ErroApi>();
  const erros = criar.error?.errosDeCampo ?? {};

  const escolher = async (f: File | null) => {
    setArquivo(f);
    setPasso(1);
    setLeitura(null);
    setErroLeitura(null);
    if (!f) return;
    try {
      const { data } = await importacoesColunas({ arquivo: f });
      setLeitura(data);
      setMapeamento(Object.fromEntries(CAMPOS.map((c) => [c.id, sugerir(data.colunas, c.id)])));
    } catch (e) {
      setErroLeitura(
        e instanceof ErroApi
          ? (Object.values(e.errosDeCampo).flat()[0] ?? e.message)
          : "Falha ao ler o arquivo.",
      );
    }
  };

  const faltando = !arquivo
    ? "Escolha um arquivo para continuar."
    : !leitura
      ? erroLeitura
        ? "Corrija o arquivo para continuar."
        : "Lendo o arquivo…"
      : !fonte.trim()
        ? "Preencha a fonte dos dados para continuar."
        : null;
  const [passo, setPasso] = useState<1 | 2>(1);
  const etapa = leitura ? passo : 1;

  const enviar = () => {
    if (!arquivo) return;
    const campos = Object.fromEntries(
      CAMPOS.filter(
        (c) => !(leitura?.tem_geometria && (c.id === "latitude" || c.id === "longitude")),
      ).map((c) => [`campo_${c.id}`, mapeamento[c.id] ?? ""]),
    );
    criar.mutate(
      {
        data: {
          arquivo,
          fonte,
          fonte_url: fonteUrl,
          data_referencia: dataReferencia || null,
          srid: Number(srid),
          ...campos,
        },
      },
      { onSuccess: (r) => aoCriar(r.data.id) },
    );
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Nova importação"
      descricao="Nada é criado antes da confirmação."
      largura="max-w-3xl"
      rodape={
        <>
          {etapa === 1 && faltando && (
            <p className="mr-auto self-center text-sm text-texto-suave">{faltando}</p>
          )}
          {etapa === 2 && (
            <Botao variante="secundario" className="mr-auto" onClick={() => setPasso(1)}>
              Voltar
            </Botao>
          )}
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          {etapa === 1 ? (
            <Botao onClick={() => setPasso(2)} disabled={!leitura || !fonte.trim()}>
              Próximo
            </Botao>
          ) : (
            <Botao onClick={enviar} disabled={!leitura || !fonte.trim() || criar.isPending}>
              {criar.isPending ? "Validando…" : "Pré-visualizar"}
            </Botao>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Etapas atual={etapa} />
        <div hidden={etapa === 2}>
          <Campo
            rotulo="Arquivo (.csv ou .geojson)"
            obrigatorio
            erros={erroLeitura ? [erroLeitura] : erros.arquivo}
          >
            {(p) => (
              <EntradaArquivo
                {...p}
                accept=".csv,.txt,.geojson,.json"
                onChange={(arquivo) => void escolher(arquivo)}
              />
            )}
          </Campo>
        </div>
        {leitura && etapa === 1 && (
          <>
            <p className="text-sm text-texto-suave">
              {leitura.total_linhas} linhas · formato {leitura.formato.toUpperCase()}
              {leitura.tem_geometria && " · geometria de pontos encontrada no arquivo"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Campo
                rotulo="Fonte dos dados"
                obrigatorio
                ajuda="Ex.: Inventário SEUMA 2019"
                erros={erros.fonte}
              >
                {(p) => <Entrada {...p} value={fonte} onChange={(e) => setFonte(e.target.value)} />}
              </Campo>
              <Campo rotulo="Data de referência dos dados" data erros={erros.data_referencia}>
                {(p) => (
                  <EntradaData
                    {...p}

                    value={dataReferencia}
                    onChange={(v) => setDataReferencia(v)}
                  />
                )}
              </Campo>
              <Campo rotulo="Endereço da fonte (URL)" erros={erros.fonte_url}>
                {(p) => (
                  <Entrada
                    {...p}
                    type="url"
                    value={fonteUrl}
                    onChange={(e) => setFonteUrl(e.target.value)}
                  />
                )}
              </Campo>
              <Campo rotulo="Sistema de coordenadas" erros={erros.srid}>
                {(p) => (
                  <Selecao {...p} value={srid} onChange={(e) => setSrid(e.target.value)}>
                    <option value="4326">WGS 84 (latitude/longitude) — EPSG:4326</option>
                    <option value="4674">SIRGAS 2000 geográfico — EPSG:4674</option>
                    <option value="31984">SIRGAS 2000 / UTM 24S — EPSG:31984</option>
                    <option value="31985">SIRGAS 2000 / UTM 25S — EPSG:31985</option>
                  </Selecao>
                )}
              </Campo>
            </div>
          </>
        )}
        {leitura && etapa === 2 && (
          <>
            {["arquivo", "fonte", "fonte_url", "data_referencia", "srid"].some(
              (c) => erros[c]?.length,
            ) && (
              <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
                Corrija no passo 1:{" "}
                {["arquivo", "fonte", "fonte_url", "data_referencia", "srid"]
                  .flatMap((c) => erros[c] ?? [])
                  .join(" ")}
              </p>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Correspondência de colunas</legend>
              <div className="grid grid-cols-2 gap-3">
                {CAMPOS.filter(
                  (c) => !(leitura.tem_geometria && (c.id === "latitude" || c.id === "longitude")),
                ).map((c) => (
                  <Campo
                    key={c.id}
                    rotulo={c.rotulo}
                    obrigatorio={"obrigatorioCsv" in c && leitura.formato === "csv"}
                    erros={erros[`campo_${c.id}`]}
                  >
                    {(p) => (
                      <Selecao
                        {...p}
                        value={mapeamento[c.id] ?? ""}
                        onChange={(e) => setMapeamento({ ...mapeamento, [c.id]: e.target.value })}
                      >
                        <option value="">Não importar</option>
                        {leitura.colunas.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </Selecao>
                    )}
                  </Campo>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </Dialogo>
  );
}

function PreVisualizacao({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const consulta = useImportacoesObter(id);
  const confirmar = useImportacoesConfirmar<ErroApi>();
  const descartar = useImportacoesDescartar<ErroApi>();
  const cliente = useQueryClient();
  const [filtro, setFiltro] = useState<"todas" | "erros" | "avisos">("todas");
  const atualizar = () => invalidarCaminhos(cliente, "/api/v1/importacoes");

  const lote = consulta.data?.data;
  const linhas = (lote?.linhas ?? []).filter((l) =>
    filtro === "erros" ? l.erros.length > 0 : filtro === "avisos" ? l.avisos.length > 0 : true,
  );

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={lote ? `Pré-visualização do lote nº ${lote.numero}` : "Pré-visualização"}
      descricao={lote ? `${lote.arquivo_nome} · fonte: ${lote.fonte}` : undefined}
      largura="max-w-5xl"
      rodape={
        lote?.estado === "pre_visualizado" && (
          <>
            <Botao
              variante="secundario"
              disabled={descartar.isPending}
              onClick={() =>
                descartar.mutate({ id }, { onSuccess: async () => (await atualizar(), aoFechar()) })
              }
            >
              Descartar
            </Botao>
            <Botao
              disabled={lote.linhas_validas === 0 || confirmar.isPending}
              onClick={() =>
                confirmar.mutate({ id }, { onSuccess: async () => (await atualizar(), aoFechar()) })
              }
            >
              {confirmar.isPending
                ? "Importando…"
                : `Importar ${plural(lote.linhas_validas ?? 0, "árvore")}`}
            </Botao>
          </>
        )
      }
    >
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <div className="flex flex-col gap-3">
          <Etapas atual={3} />
          {confirmar.error && <p className="text-sm text-perigo">{confirmar.error.message}</p>}
          <p className="text-sm">
            <strong>{lote!.linhas_validas}</strong> de {lote!.total_linhas} linhas serão importadas.
            Linhas com erro são ignoradas; avisos não impedem a importação. Todos os valores entram
            com origem <strong>Importado</strong>.
          </p>
          <div className="flex gap-2">
            {(["todas", "erros", "avisos"] as const).map((f) => (
              <Botao
                key={f}
                tamanho="pequeno"
                variante={filtro === f ? "primario" : "secundario"}
                onClick={() => setFiltro(f)}
              >
                {f === "todas" ? "Todas" : f === "erros" ? "Com erro" : "Com aviso"}
              </Botao>
            ))}
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <Tabela>
              <thead>
                <tr>
                  <Th>Linha</Th>
                  <Th>Dados interpretados</Th>
                  <Th>Problemas</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 500).map((l) => (
                  <Linha
                    key={l.indice}
                    className={l.erros.length ? "bg-perigo-clara/40" : undefined}
                  >
                    <Td>{l.indice}</Td>
                    <Td className="font-mono text-xs">
                      {Object.entries(l.dados)
                        .filter(([k]) => k !== "especie_id")
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ") || "—"}
                    </Td>
                    <Td className="text-xs">
                      {l.erros.map((e) => (
                        <p key={e} className="text-perigo">
                          {e}
                        </p>
                      ))}
                      {l.avisos.map((a) => (
                        <p key={a} className="text-atencao">
                          {a}
                        </p>
                      ))}
                      {!l.erros.length && !l.avisos.length && (
                        <span className="text-sucesso">OK</span>
                      )}
                    </Td>
                  </Linha>
                ))}
              </tbody>
            </Tabela>
          </div>
          {linhas.length > 500 && (
            <p className="text-xs text-texto-suave">Mostrando as primeiras 500 linhas.</p>
          )}
        </div>
      )}
    </Dialogo>
  );
}

function DesfazerDialogo({ lote, aoFechar }: { lote: LoteImportacao; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const desfazer = useImportacoesDesfazer<ErroApi>();
  const cliente = useQueryClient();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Desfazer lote nº ${lote.numero}`}
      descricao={`${lote.arvores_criadas === 1 ? "A árvore criada" : `As ${lote.arvores_criadas} árvores criadas`} por este lote ${lote.arvores_criadas === 1 ? "será removida" : "serão removidas"}. A ação fica registrada na auditoria.`}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={!motivo.trim() || desfazer.isPending}
            onClick={() =>
              desfazer.mutate(
                { id: lote.id, data: { motivo: motivo.trim() } },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/importacoes"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Desfazer
          </Botao>
        </>
      }
    >
      {desfazer.error && <p className="mb-3 text-sm text-perigo">{desfazer.error.message}</p>}
      <Campo rotulo="Justificativa" obrigatorio>
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}
