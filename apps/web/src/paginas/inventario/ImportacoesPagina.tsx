import {
  ErroApi,
  importacoesColunas,
  useImportacoesConfirmar,
  useImportacoesCriar,
  useImportacoesDescartar,
  useImportacoesDesfazer,
  useImportacoesListar,
  useImportacoesObter,
  useModelosImportacaoApagar,
  useModelosImportacaoAtualizar,
  useModelosImportacaoCriar,
  useModelosImportacaoListar,
  type ColunasArquivo,
  type LoteImportacao,
  type ModeloImportacao,
  type ModoEnum,
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
import { Dica } from "../../ui/dica";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora, plural } from "../../util/formatos";
import { invalidarCaminhos } from "../../util/cache";

const CAMPOS = [
  { id: "latitude", rotulo: "Latitude (ou Y)", obrigatorioCsv: true },
  { id: "longitude", rotulo: "Longitude (ou X)", obrigatorioCsv: true },
  { id: "id_externo", rotulo: "Identificador na fonte" },
  { id: "especie", rotulo: "Espécie (nome científico ou popular)" },
  { id: "endereco", rotulo: "Endereço" },
  { id: "altura", rotulo: "Altura (m)" },
  { id: "dap", rotulo: "DAP (cm)" },
  { id: "precisao", rotulo: "Precisão da localização (m)" },
] as const;

const ROTULOS_FORMATO: Record<string, string> = {
  csv: "CSV",
  xlsx: "XLSX",
  geojson: "GeoJSON",
  shapefile: "Shapefile",
  geopackage: "GeoPackage",
  kml: "KML",
  kmz: "KMZ",
};
/** Planilhas não trazem geometria: as colunas de latitude e longitude são obrigatórias. */
const FORMATOS_TABULARES = ["csv", "xlsx"];
/** Formatos em que uma feição pode ser polígono: a opção do ponto interior só vale aqui. */
const FORMATOS_COM_POLIGONO = ["shapefile", "geopackage", "kml", "kmz"];

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
  // Enquanto algum lote é confirmado em segundo plano, a lista se atualiza sozinha.
  const consulta = useImportacoesListar(undefined, {
    query: {
      refetchInterval: (c) =>
        c.state.data?.data.results.some((l) => l.estado === "em_processamento") ? 1500 : false,
    },
  });
  const retomar = useImportacoesConfirmar<ErroApi>();
  const cliente = useQueryClient();
  const [falhas, setFalhas] = useState<LoteImportacao | null>(null);
  const [assistente, setAssistente] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<LoteImportacao | null>(null);

  return (
    <>
      <CabecalhoPagina
        titulo="Importações"
        descricao="Importe inventários existentes (CSV, XLSX, GeoJSON, Shapefile, GeoPackage ou KML). Nada é criado ou alterado antes da confirmação, e cada registro guarda a fonte."
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
              <Th>Árvores</Th>
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
                    <>
                      <Link
                        to="/inventario/arvores"
                        search={{ situacao: "todas" }}
                        className="text-marca-escura hover:underline"
                      >
                        Ver {l.arvores_criadas} {l.arvores_criadas === 1 ? "árvore" : "árvores"}
                      </Link>
                      {(l.linhas_atualizadas ?? 0) > 0 && (
                        <p className="text-xs text-texto-suave">
                          {plural(l.linhas_atualizadas ?? 0, "atualizada", "atualizadas")}
                        </p>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <Selo
                    tom={
                      l.estado === "confirmado"
                        ? "sucesso"
                        : l.estado === "pre_visualizado" || l.estado === "em_processamento"
                          ? "info"
                          : l.estado === "interrompido"
                            ? "perigo"
                            : "neutro"
                    }
                  >
                    {ROTULOS_ESTADO_LOTE[l.estado ?? "pre_visualizado"]}
                  </Selo>
                  {l.estado === "em_processamento" && <AndamentoDoLote lote={l} />}
                  {l.estado === "interrompido" && (
                    <p role="alert" className="mt-1 max-w-64 text-xs text-perigo">
                      {l.erro}
                    </p>
                  )}
                  <p className="text-xs text-texto-suave">
                    {formatarDataHora(l.confirmado_em ?? l.criado_em)}
                  </p>
                  {l.estado === "confirmado" && (l.linhas_com_falha ?? 0) > 0 && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-perigo hover:underline"
                      onClick={() => setFalhas(l)}
                    >
                      {plural(
                        l.linhas_com_falha ?? 0,
                        "linha não virou árvore",
                        "linhas não viraram árvore",
                      )}
                      : ver detalhes
                    </button>
                  )}
                </Td>
                <Td>{l.usuario_nome}</Td>
                <Td className="text-right">
                  {l.estado === "pre_visualizado" && (
                    <Botao tamanho="pequeno" variante="secundario" onClick={() => setAberto(l.id)}>
                      Revisar
                    </Botao>
                  )}
                  {l.estado === "interrompido" && (
                    <Botao
                      tamanho="pequeno"
                      variante="secundario"
                      disabled={retomar.isPending}
                      onClick={() =>
                        retomar.mutate(
                          { id: l.id },
                          { onSuccess: () => invalidarCaminhos(cliente, "/api/v1/importacoes") },
                        )
                      }
                    >
                      Retomar
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
                        <Dica
                          texto={`Desfazer indisponível: ${l.motivo_nao_desfazer ?? "o lote não pode ser desfeito."}`}
                        />
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
      {falhas && <FalhasDialogo lote={falhas} aoFechar={() => setFalhas(null)} />}
    </>
  );
}

/** Andamento da confirmação em segundo plano; a janela de revisão pode ter sido fechada. */
function AndamentoDoLote({ lote }: { lote: LoteImportacao }) {
  return (
    <div role="status" className="mt-1 max-w-56 text-xs text-texto-suave">
      <p>
        {(lote.linhas_processadas ?? 0).toLocaleString("pt-BR")} de{" "}
        {(lote.total_linhas ?? 0).toLocaleString("pt-BR")} linhas processadas.
      </p>
      <progress
        className="mt-1 h-2 w-full accent-marca"
        aria-label={`Andamento da importação do lote nº ${lote.numero}`}
        max={lote.total_linhas ?? 0}
        value={lote.linhas_processadas ?? 0}
      />
    </div>
  );
}

function FalhasDialogo({ lote, aoFechar }: { lote: LoteImportacao; aoFechar: () => void }) {
  const consulta = useImportacoesObter(lote.id);
  const falhas = consulta.data?.data.falhas ?? [];
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Linhas que não viraram árvore (lote nº ${lote.numero})`}
      descricao="As demais linhas do lote foram importadas normalmente."
      rodape={<Botao onClick={aoFechar}>Fechar</Botao>}
    >
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <>
          <ul className="max-h-64 list-disc overflow-y-auto pl-5 text-sm">
            {falhas.map((f) => (
              <li key={f.indice}>
                Linha {f.indice}: {f.motivo}
              </li>
            ))}
          </ul>
          {(lote.linhas_com_falha ?? 0) > falhas.length && (
            <p className="mt-2 text-xs text-texto-suave">
              E mais {(lote.linhas_com_falha ?? 0) - falhas.length}, sem o motivo guardado.
            </p>
          )}
        </>
      )}
    </Dialogo>
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
  const [pontoInterior, setPontoInterior] = useState(false);
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
          usar_ponto_interior: pontoInterior,
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
            rotulo="Arquivo"
            ajuda="CSV, XLSX, GeoJSON, Shapefile (ZIP), GeoPackage, KML ou KMZ."
            obrigatorio
            erros={erroLeitura ? [erroLeitura] : erros.arquivo}
          >
            {(p) => (
              <EntradaArquivo
                {...p}
                accept=".csv,.txt,.geojson,.json,.xlsx,.zip,.gpkg,.kml,.kmz"
                onChange={(arquivo) => void escolher(arquivo)}
              />
            )}
          </Campo>
        </div>
        {leitura && etapa === 1 && (
          <>
            <p className="text-sm text-texto-suave">
              {leitura.total_linhas} linhas · formato{" "}
              {ROTULOS_FORMATO[leitura.formato] ?? leitura.formato.toUpperCase()}
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
            <ModelosDeMapeamento
              fonte={fonte}
              colunas={leitura.colunas}
              mapeamento={mapeamento}
              srid={srid}
              pontoInterior={pontoInterior}
              aoAplicar={(m) => {
                setMapeamento((atual) => ({
                  ...atual,
                  ...Object.fromEntries(
                    CAMPOS.map((c) => [
                      c.id,
                      leitura.colunas.includes(m.mapeamento[c.id] ?? "")
                        ? (m.mapeamento[c.id] ?? "")
                        : "",
                    ]),
                  ),
                }));
                if (m.srid) setSrid(String(m.srid));
                setPontoInterior(Boolean(m.usar_ponto_interior));
              }}
            />
            {FORMATOS_COM_POLIGONO.includes(leitura.formato) && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-marca"
                  checked={pontoInterior}
                  onChange={(e) => setPontoInterior(e.target.checked)}
                />
                <span>
                  Aceitar polígonos pelo ponto interior
                  <span className="block text-xs text-texto-suave">
                    Sem isto, só feições de ponto são importadas e as demais são recusadas com o
                    motivo.
                  </span>
                </span>
              </label>
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
                    obrigatorio={
                      "obrigatorioCsv" in c && FORMATOS_TABULARES.includes(leitura.formato)
                    }
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

/** Modelos de importação: o mapeamento de colunas salvo, por fonte, para a próxima vez. */
function ModelosDeMapeamento({
  fonte,
  colunas,
  mapeamento,
  srid,
  pontoInterior,
  aoAplicar,
}: {
  fonte: string;
  colunas: string[];
  mapeamento: Record<string, string>;
  srid: string;
  pontoInterior: boolean;
  aoAplicar: (modelo: ModeloImportacao) => void;
}) {
  const cliente = useQueryClient();
  const consulta = useModelosImportacaoListar({ fonte: fonte.trim() });
  const criar = useModelosImportacaoCriar<ErroApi>();
  const atualizar = useModelosImportacaoAtualizar<ErroApi>();
  const apagar = useModelosImportacaoApagar<ErroApi>();
  const [nome, setNome] = useState("");
  const [escolhido, setEscolhido] = useState("");
  const [apagando, setApagando] = useState(false);
  const modelos = consulta.data?.data.results ?? [];
  const atual = modelos.find((m) => m.id === escolhido) ?? modelos[0];
  const corpo = {
    mapeamento: Object.fromEntries(Object.entries(mapeamento).filter(([, coluna]) => coluna)),
    srid: Number(srid),
    usar_ponto_interior: pontoInterior,
  };
  const refazer = () => invalidarCaminhos(cliente, "/api/v1/modelos-importacao");
  const erro = criar.error ?? atualizar.error ?? apagar.error;
  const faltantes = atual
    ? Object.values(atual.mapeamento).filter((coluna) => !colunas.includes(coluna))
    : [];

  return (
    <section
      aria-label="Modelos de importação"
      className="flex flex-col gap-2 rounded-md border border-borda p-3 text-sm"
    >
      <h3 className="font-medium">Modelos de mapeamento desta fonte</h3>
      {consulta.isPending ? (
        <p className="text-texto-suave">Procurando modelos salvos…</p>
      ) : atual ? (
        <>
          <p role="status">
            Há {plural(modelos.length, "modelo salvo", "modelos salvos")} para “{fonte.trim()}”: use
            um para preencher as colunas.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {modelos.length > 1 && (
              <Selecao
                aria-label="Modelo salvo"
                className="max-w-56"
                value={atual.id}
                onChange={(e) => (setEscolhido(e.target.value), setApagando(false))}
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Selecao>
            )}
            <Botao tamanho="pequeno" onClick={() => aoAplicar(atual)}>
              Usar o modelo “{atual.nome}”
            </Botao>
            <Botao
              tamanho="pequeno"
              variante="secundario"
              disabled={atualizar.isPending}
              onClick={() =>
                atualizar.mutate({ id: atual.id, data: corpo }, { onSuccess: () => refazer() })
              }
            >
              Atualizar com as colunas atuais
            </Botao>
            <Botao tamanho="pequeno" variante="perigoContorno" onClick={() => setApagando(true)}>
              Apagar
            </Botao>
          </div>
          {faltantes.length > 0 && (
            <p className="text-xs text-atencao">
              Este arquivo não tem as colunas {faltantes.map((c) => `“${c}”`).join(", ")} do modelo;
              esses campos ficam sem correspondência.
            </p>
          )}
          {apagando && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-md bg-perigo-clara px-3 py-2"
            >
              <span>Apagar o modelo “{atual.nome}”? As importações já feitas não mudam.</span>
              <Botao
                tamanho="pequeno"
                variante="perigo"
                disabled={apagar.isPending}
                onClick={() =>
                  apagar.mutate(
                    { id: atual.id },
                    { onSuccess: () => (setApagando(false), setEscolhido(""), refazer()) },
                  )
                }
              >
                Confirmar exclusão
              </Botao>
              <Botao tamanho="pequeno" variante="secundario" onClick={() => setApagando(false)}>
                Manter
              </Botao>
            </div>
          )}
        </>
      ) : (
        <p className="text-texto-suave">Nenhum modelo salvo para esta fonte ainda.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Campo rotulo="Salvar o mapeamento atual como modelo">
          {(p) => (
            <Entrada
              {...p}
              placeholder="Nome do modelo"
              maxLength={100}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          )}
        </Campo>
        <Botao
          variante="secundario"
          disabled={!nome.trim() || criar.isPending}
          onClick={() =>
            criar.mutate(
              { data: { nome: nome.trim(), fonte: fonte.trim(), ...corpo } },
              { onSuccess: () => (setNome(""), setEscolhido(""), refazer()) },
            )
          }
        >
          Salvar modelo
        </Botao>
      </div>
      {erro && (
        <p role="alert" className="text-xs text-perigo">
          {Object.values(erro.errosDeCampo).flat()[0] ?? erro.message}
        </p>
      )}
    </section>
  );
}

function PreVisualizacao({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const consulta = useImportacoesObter(id);
  const confirmar = useImportacoesConfirmar<ErroApi>();
  const descartar = useImportacoesDescartar<ErroApi>();
  const cliente = useQueryClient();
  const [filtro, setFiltro] = useState<"todas" | "erros" | "avisos" | "atualizacoes">("todas");
  const [modo, setModo] = useState<ModoEnum>("criar");
  const [ignorarDuplicatas, setIgnorarDuplicatas] = useState(false);
  const atualizar = () => invalidarCaminhos(cliente, "/api/v1/importacoes");

  const lote = consulta.data?.data;
  const resumo = lote?.resumo;
  const existentes = resumo ? resumo.a_atualizar + resumo.sem_mudanca : 0;
  const duplicatas = resumo?.duplicatas ?? 0;
  const aCriar = Math.max(
    (resumo?.a_criar ?? lote?.linhas_validas ?? 0) - (ignorarDuplicatas ? duplicatas : 0),
    0,
  );
  const aAtualizar = modo === "atualizar" ? (resumo?.a_atualizar ?? 0) : 0;
  const linhas = (lote?.linhas ?? []).filter((l) =>
    filtro === "erros"
      ? l.erros.length > 0 && !l.existente
      : filtro === "avisos"
        ? l.avisos.length > 0
        : filtro === "atualizacoes"
          ? (l.existente?.diferencas.length ?? 0) > 0
          : true,
  );
  const comErro = (lote?.linhas ?? []).filter((l) => l.erros.length > 0 && !l.existente).length;
  const rotuloImportar =
    modo === "atualizar" && existentes > 0
      ? `Importar ${plural(aCriar, "nova")} e atualizar ${plural(aAtualizar, "árvore")}`
      : `Importar ${plural(aCriar, "árvore")}`;

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
              disabled={aCriar + aAtualizar === 0 || confirmar.isPending}
              onClick={() =>
                confirmar.mutate(
                  { id, data: { modo, ignorar_duplicatas: ignorarDuplicatas } },
                  { onSuccess: async () => (await atualizar(), aoFechar()) },
                )
              }
            >
              {confirmar.isPending ? "Importando…" : rotuloImportar}
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
            <strong>{resumo?.a_criar ?? lote!.linhas_validas}</strong> de {lote!.total_linhas}{" "}
            linhas viram árvores novas
            {existentes > 0 && (
              <>
                ; <strong>{existentes}</strong> já existem na fonte ({resumo?.a_atualizar ?? 0} com
                mudanças e {resumo?.sem_mudanca ?? 0} sem mudança)
              </>
            )}
            . {plural(comErro, "linha com erro é ignorada", "linhas com erro são ignoradas")};
            avisos não impedem a importação. Os valores entram com origem <strong>Importado</strong>
            . Lotes grandes são importados em segundo plano: você pode fechar esta janela e
            acompanhar o andamento na lista.
          </p>
          {lote!.estado === "pre_visualizado" && existentes > 0 && (
            <fieldset className="rounded-md border border-borda p-3 text-sm">
              <legend className="px-1 font-medium">Se o identificador já existir na fonte</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="modo-importacao"
                  className="mt-0.5 size-4 accent-marca"
                  checked={modo === "criar"}
                  onChange={() => setModo("criar")}
                />
                <span>
                  Criar só as novas
                  <span className="block text-xs text-texto-suave">
                    As árvores que já existem ficam como estão.
                  </span>
                </span>
              </label>
              <label className="mt-2 flex items-start gap-2">
                <input
                  type="radio"
                  name="modo-importacao"
                  className="mt-0.5 size-4 accent-marca"
                  checked={modo === "atualizar"}
                  onChange={() => setModo("atualizar")}
                />
                <span>
                  Criar as novas e atualizar as existentes
                  <span className="block text-xs text-texto-suave">
                    Só muda o que aparece no relatório de diferenças abaixo. Localização só muda se
                    a origem atual for “importada”, e altura e DAP entram como novas medidas. Lotes
                    que atualizam árvores não podem ser desfeitos.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {lote!.estado === "pre_visualizado" && duplicatas > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-marca"
                checked={ignorarDuplicatas}
                onChange={(e) => setIgnorarDuplicatas(e.target.checked)}
              />
              <span>
                Ignorar {plural(duplicatas, "linha apontada", "linhas apontadas")} como possível
                duplicata
                <span className="block text-xs text-texto-suave">
                  São linhas novas a poucos metros de uma árvore ativa já cadastrada. Sem marcar,
                  elas são criadas mesmo assim.
                </span>
              </span>
            </label>
          )}
          {(resumo?.ambiguas ?? 0) > 0 && (
            <p className="text-sm text-atencao">
              {plural(
                resumo?.ambiguas ?? 0,
                "linha tem nome popular ambíguo e ficará",
                "linhas têm nome popular ambíguo e ficarão",
              )}{" "}
              sem espécie (veja os avisos).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(["todas", "erros", "avisos", "atualizacoes"] as const).map((f) => (
              <Botao
                key={f}
                tamanho="pequeno"
                variante={filtro === f ? "primario" : "secundario"}
                onClick={() => setFiltro(f)}
              >
                {f === "todas"
                  ? "Todas"
                  : f === "erros"
                    ? "Com erro"
                    : f === "avisos"
                      ? "Com aviso"
                      : "Atualizações"}
              </Botao>
            ))}
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <Tabela>
              <thead>
                <tr>
                  <Th>Linha</Th>
                  <Th>Dados interpretados</Th>
                  <Th>Problemas e diferenças</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 500).map((l) => (
                  <Linha
                    key={l.indice}
                    className={l.erros.length && !l.existente ? "bg-perigo-clara/40" : undefined}
                  >
                    <Td>{l.indice}</Td>
                    <Td className="font-mono text-xs">
                      {Object.entries(l.dados)
                        .filter(([k]) => k !== "especie_id")
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ") || "—"}
                    </Td>
                    <Td className="text-xs">
                      {l.existente ? (
                        <div>
                          <p className="font-medium">Já existe: {l.existente.codigo}</p>
                          {l.existente.diferencas.length === 0 ? (
                            <p className="text-texto-suave">Sem mudanças.</p>
                          ) : (
                            <ul aria-label={`Diferenças da linha ${l.indice}`}>
                              {l.existente.diferencas.map((d) => (
                                <li key={d.campo}>
                                  <strong>{d.rotulo}:</strong>{" "}
                                  <span className="text-texto-suave line-through">
                                    {d.antigo || "vazio"}
                                  </span>{" "}
                                  → <span className="font-medium">{d.novo}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        l.erros.map((e) => (
                          <p key={e} className="text-perigo">
                            {e}
                          </p>
                        ))
                      )}
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
