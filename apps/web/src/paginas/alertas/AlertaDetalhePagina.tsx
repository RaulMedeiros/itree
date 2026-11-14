import {
  ErroApi,
  useAlertasArvoresProximas,
  useAlertasConverterOcorrencia,
  useAlertasHistorico,
  useAlertasObter,
  useAlertasTriagem,
  useTiposOcorrenciaListar,
  type Alerta as AlertaAmbiental,
  type ArvoreProxima,
  type StatusAlertaEnum,
} from "@itree/api-client";
import { ACOES_STATUS_ALERTA, ROTULOS_FONTE_ALERTA, ROTULOS_TIPO_ALERTA } from "@itree/domain";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { GeoJSONSource, LngLatBoundsLike, Map as MapaMapLibre } from "maplibre-gl";
import { ArrowLeft } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { CondicaoAparente } from "../../componentes/CondicaoAparente";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloStatusAlerta } from "../../componentes/selos";
import { Mapa } from "../../mapa/Mapa";
import {
  COR_ALERTA,
  camadasDoAlerta,
  pinturaArvores,
  registrarIcones,
} from "../../mapa/simbologia";
import { dadosDoMapaDoAlerta } from "./mapaAlerta";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { RAIO_PADRAO_M, type RaioM } from "./opcoesRaio";
import { SeletorRaio } from "./raio";
import { CabecalhoPagina } from "../../ui/pagina";
import { invalidarCaminhos } from "../../util/cache";
import { descreverAreaVerdeProxima, formatarDataHora, plural } from "../../util/formatos";

export function AlertaDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/alertas/$id" });
  const { raio = RAIO_PADRAO_M } = useSearch({ from: "/autenticado/alertas/$id" });
  // Ao trocar o raio, mantém a tela com os dados anteriores até chegarem os novos.
  const consulta = useAlertasObter(id, { raio }, { query: { placeholderData: keepPreviousData } });
  return (
    <div className="mx-auto max-w-6xl">
      {/* Com os dados carregados, as migalhas do cabeçalho já levam de volta; o link só fica no erro. */}
      {consulta.isError && (
        <Link
          to="/alertas"
          className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
        >
          <ArrowLeft className="size-4" aria-hidden /> Alertas ambientais
        </Link>
      )}
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <Detalhe alerta={consulta.data.data} raio={raio} />
      )}
    </div>
  );
}

function limites(geometria: { type: string; coordinates: unknown }): LngLatBoundsLike {
  const pontos: [number, number][] = [];
  const coletar = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") pontos.push([c[0] as number, c[1] as number]);
    else if (Array.isArray(c)) c.forEach(coletar);
  };
  coletar(geometria.coordinates);
  const xs = pontos.map((p) => p[0]);
  const ys = pontos.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function Detalhe({ alerta: a, raio }: { alerta: AlertaAmbiental; raio: RaioM }) {
  const podeTriar = usePermissao("alertas.triar");
  const podeRegistrar = usePermissao("ocorrencias.editar");
  const podeConverter =
    podeTriar && podeRegistrar && !a.ocorrencia && a.transicoes_possiveis.length > 0;
  const [status, setStatus] = useState<StatusAlertaEnum | null>(null);
  const [convertendo, setConvertendo] = useState(false);
  const historico = useAlertasHistorico(a.id);
  const geometria = a.geometria as { type: string; coordinates: unknown };
  // As árvores a até `raio` m vão para a tabela e para o mapa (R3-24): uma consulta só.
  const proximas = useAlertasArvoresProximas(
    a.id,
    { raio },
    { query: { placeholderData: keepPreviousData } },
  );
  const mapa = useRef<MapaMapLibre | null>(null);
  const [mapaPronto, setMapaPronto] = useState(false);

  // Raio e árvores próximas acompanham a consulta e o seletor de raio.
  useEffect(() => {
    const m = mapa.current;
    if (!mapaPronto || !m) return;
    const dados = dadosDoMapaDoAlerta(geometria, proximas.data?.data ?? [], raio);
    (m.getSource("raio") as GeoJSONSource | undefined)?.setData(
      (dados.raio ?? { type: "FeatureCollection", features: [] }) as Parameters<
        GeoJSONSource["setData"]
      >[0],
    );
    (m.getSource("arvores-proximas") as GeoJSONSource | undefined)?.setData(
      dados.arvores as Parameters<GeoJSONSource["setData"]>[0],
    );
    if (a.tipo_geometria === "Point" && dados.caixa)
      m.fitBounds(dados.caixa, { padding: 32, duration: 0, maxZoom: 17 });
    // A geometria só muda com o alerta; o efeito refaz com a consulta e o raio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaPronto, proximas.data, raio]);

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    const vazio = { type: "FeatureCollection", features: [] } as const;
    m.addSource("raio", { type: "geojson", data: vazio });
    m.addLayer({
      id: "raio-preenchimento",
      type: "fill",
      source: "raio",
      paint: { "fill-color": COR_ALERTA, "fill-opacity": 0.06 },
    });
    m.addLayer({
      id: "raio-contorno",
      type: "line",
      source: "raio",
      paint: { "line-color": COR_ALERTA, "line-width": 1.5, "line-dasharray": [2, 2] },
    });
    m.addSource("arvores-proximas", { type: "geojson", data: vazio });
    m.addSource("alerta", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: geometria } as Parameters<
        GeoJSONSource["setData"]
      >[0],
    });
    registrarIcones(m);
    for (const camada of camadasDoAlerta("alerta", a.tipo_geometria === "Point"))
      m.addLayer(camada as Parameters<MapaMapLibre["addLayer"]>[0]);
    // As árvores ficam por cima do alerta: é a relação espacial que a tela quer mostrar.
    m.addLayer({
      id: "arvores-proximas",
      type: "circle",
      source: "arvores-proximas",
      paint: { ...pinturaArvores("condicao"), "circle-radius": 6 } as never,
    });
    setMapaPronto(true);
    if (a.tipo_geometria === "Point") {
      const [x1, y1] = (limites(geometria) as number[]).slice(0, 2);
      m.jumpTo({ center: [x1!, y1!], zoom: 14 });
    } else {
      m.fitBounds(limites(geometria), { padding: 40, duration: 0, maxZoom: 16 });
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo={`${a.codigo} · ${ROTULOS_TIPO_ALERTA[a.tipo]}`}
        migalhas={[{ rotulo: "Alertas ambientais", para: "/alertas" }, { rotulo: a.codigo }]}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <SeloStatusAlerta status={a.status ?? "detectado"} /> {ROTULOS_FONTE_ALERTA[a.fonte]} ·
            identificador na fonte: <span className="font-mono">{a.id_externo}</span>
          </span>
        }
        acoes={
          podeConverter && (
            <Botao variante="secundario" onClick={() => setConvertendo(true)}>
              Converter em ocorrência
            </Botao>
          )
        }
      />
      <p className="mb-4 rounded-md bg-info-clara px-3 py-2 text-sm text-info">
        Detecção por satélite ou foco de calor não prova, por si só, ilegalidade. A conclusão
        depende de análise e de confirmação formal da autoridade competente.
      </p>
      {podeTriar && a.transicoes_possiveis.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-borda bg-superficie px-4 py-3">
          <span className="text-sm text-texto-suave">Triagem:</span>
          {a.transicoes_possiveis.map((s) => (
            <Botao
              key={s}
              tamanho="pequeno"
              variante={s === "descartado" ? "secundario" : "primario"}
              onClick={() => setStatus(s)}
            >
              {ACOES_STATUS_ALERTA[s]}
            </Botao>
          ))}
        </div>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Mapa
            base="ruas"
            rotulo="Geometria do alerta"
            className="h-80 overflow-hidden rounded-lg border border-borda"
            aoCarregar={aoCarregar}
          />
          <p className="mt-1.5 text-xs text-texto-suave">
            {a.tipo_geometria === "Point" ? `Círculo tracejado: raio de ${raio} m. ` : ""}
            Pontos coloridos: as árvores listadas abaixo, pela condição aparente.
          </p>
        </div>
        <section className="rounded-lg border border-borda bg-superficie p-4 text-sm lg:col-span-2">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            <dt className="text-texto-suave">Detectado em (fonte)</dt>
            <dd>{formatarDataHora(a.data_deteccao)}</dd>
            <dt className="text-texto-suave">Ingerido em</dt>
            <dd>{formatarDataHora(a.ingerido_em)}</dd>
            <dt className="text-texto-suave">Geometria</dt>
            <dd>
              {a.tipo_geometria === "Point" ? "Ponto" : "Polígono"}
              {a.area_ha ? ` · ${a.area_ha.toLocaleString("pt-BR")} ha` : ""}
            </dd>
            {descreverAreaVerdeProxima(a.area_verde_proxima) && (
              <>
                <dt className="text-texto-suave">Área verde</dt>
                <dd>
                  <span className="font-medium text-atencao">
                    {descreverAreaVerdeProxima(a.area_verde_proxima)}
                  </span>
                </dd>
              </>
            )}
            <dt className="text-texto-suave">SRC original</dt>
            <dd>{a.src_original || "EPSG:4326"}</dd>
            <dt className="text-texto-suave">Bairros</dt>
            <dd>
              {(a.bairros as { nome: string }[]).map((b) => b.nome).join(", ") ||
                "Nenhum bairro cadastrado intersecta"}
            </dd>
            {a.referencia && (
              <>
                <dt className="text-texto-suave">Referência</dt>
                <dd>{a.referencia}</dd>
              </>
            )}
            {a.justificativa && (
              <>
                <dt className="text-texto-suave">Justificativa</dt>
                <dd>{a.justificativa}</dd>
              </>
            )}
            {a.analisado_por && (
              <>
                <dt className="text-texto-suave">Analisado por</dt>
                <dd>{a.analisado_por}</dd>
              </>
            )}
            {a.ocorrencia && (
              <>
                <dt className="text-texto-suave">Ocorrência</dt>
                <dd>
                  <Link
                    to="/ocorrencias/$id"
                    params={{ id: String(a.ocorrencia.id) }}
                    className="font-mono text-marca-escura hover:underline"
                  >
                    {String(a.ocorrencia.codigo)}
                  </Link>
                </dd>
              </>
            )}
          </dl>
          <p className="mt-3 text-xs text-texto-suave">
            A geometria é exibida como recebida da fonte; a precisão depende da resolução do sensor.
          </p>
        </section>
      </div>
      <ArvoresProximas alerta={a} raio={raio} consulta={proximas} />
      <details className="mb-6 rounded-lg border border-borda bg-superficie p-4">
        <summary className="cursor-pointer font-semibold">Atributos originais da fonte</summary>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {Object.entries(a.propriedades as Record<string, unknown>).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="font-mono text-xs text-texto-suave">{k}</dt>
              <dd className="break-all">{String(v)}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
      <h2 className="mb-3 font-semibold">Histórico da análise</h2>
      <LinhaDoTempo
        eventos={historico.data?.data}
        carregando={historico.isPending}
        erro={historico.error}
      />
      {status && <TriagemDialogo alerta={a} status={status} aoFechar={() => setStatus(null)} />}
      {convertendo && <ConverterDialogo alerta={a} aoFechar={() => setConvertendo(false)} />}
    </>
  );
}

/** O que a tabela usa da consulta das árvores próximas, feita em `Detalhe` e dividida com o mapa. */
interface ConsultaProximas {
  data?: { data: ArvoreProxima[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

function ArvoresProximas({
  alerta,
  raio,
  consulta,
}: {
  alerta: AlertaAmbiental;
  raio: RaioM;
  consulta: ConsultaProximas;
}) {
  const navegar = useNavigate({ from: "/alertas/$id" });
  const arvores = consulta.data?.data ?? [];
  return (
    <section className="mb-6" aria-labelledby="arvores-proximas">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="arvores-proximas" className="font-semibold">
          Árvores a até {raio} m
        </h2>
        <SeletorRaio
          valor={raio}
          aoMudar={(r) => void navegar({ search: (s: { raio?: RaioM }) => ({ ...s, raio: r }) })}
        />
      </div>
      <p className="mb-3 text-sm text-texto-suave">
        {plural(alerta.ocorrencias_proximas, "ocorrência aberta", "ocorrências abertas")} no mesmo
        raio. Distância medida até o ponto ou a borda do polígono; só entram árvores do seu escopo.
      </p>
      {consulta.isPending ? (
        <Carregando linhas={3} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : arvores.length === 0 ? (
        <p className="rounded-lg border border-borda bg-superficie px-4 py-3 text-sm text-texto-suave">
          Nenhuma árvore cadastrada a até {raio} m deste alerta.
        </p>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Árvore</Th>
              <Th>Espécie</Th>
              <Th>Condição aparente</Th>
              <Th className="text-right">Distância</Th>
            </tr>
          </thead>
          <tbody>
            {arvores.map((v) => (
              <Linha key={v.id}>
                <Td>
                  <Link
                    to="/inventario/arvores/$id"
                    params={{ id: v.id }}
                    className="font-mono font-medium text-marca-escura hover:underline"
                  >
                    {v.codigo}
                  </Link>
                </Td>
                <Td>{v.especie ?? <span className="text-texto-suave">Não identificada</span>}</Td>
                <Td>
                  <CondicaoAparente condicao={v.condicao_aparente} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {Math.round(v.distancia_m).toLocaleString("pt-BR")} m
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
    </section>
  );
}

const REFERENCIA: Partial<Record<StatusAlertaEnum, string>> = {
  encaminhado: "Protocolo de encaminhamento",
  confirmado: "Documento da autoridade (auto, parecer, processo)",
};
const EXIGEM_JUSTIFICATIVA: StatusAlertaEnum[] = [
  "descartado",
  "confirmado",
  "compativel_autorizacao",
  "encaminhado",
];

function TriagemDialogo({
  alerta,
  status,
  aoFechar,
}: {
  alerta: AlertaAmbiental;
  status: StatusAlertaEnum;
  aoFechar: () => void;
}) {
  const [justificativa, setJustificativa] = useState("");
  const [referencia, setReferencia] = useState("");
  const triar = useAlertasTriagem<ErroApi>();
  const cliente = useQueryClient();
  const exigeJustificativa = EXIGEM_JUSTIFICATIVA.includes(status);
  const rotuloReferencia = REFERENCIA[status];
  const ok =
    (!exigeJustificativa || justificativa.trim()) && (!rotuloReferencia || referencia.trim());
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`${ACOES_STATUS_ALERTA[status]} — ${alerta.codigo}`}
      descricao={
        status === "compativel_autorizacao"
          ? "Indica que foi localizada referência de licença potencialmente relacionada. Validade, polígono e condições ainda precisam ser verificados."
          : undefined
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!ok || triar.isPending}
            onClick={() =>
              triar.mutate(
                {
                  id: alerta.id,
                  data: {
                    status,
                    justificativa: justificativa.trim(),
                    referencia: referencia.trim(),
                  },
                },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/alertas"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Confirmar
          </Botao>
        </>
      }
    >
      {triar.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(triar.error.errosDeCampo).flat()[0] ?? triar.error.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Justificativa" obrigatorio={exigeJustificativa}>
          {(p) => (
            <AreaTexto
              {...p}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
            />
          )}
        </Campo>
        {rotuloReferencia && (
          <Campo rotulo={rotuloReferencia} obrigatorio>
            {(p) => (
              <Entrada {...p} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            )}
          </Campo>
        )}
      </div>
    </Dialogo>
  );
}

function ConverterDialogo({ alerta, aoFechar }: { alerta: AlertaAmbiental; aoFechar: () => void }) {
  const tipos = useTiposOcorrenciaListar({ ativo: true });
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState(
    `Verificação em campo do alerta ${alerta.codigo} (${ROTULOS_FONTE_ALERTA[alerta.fonte]}).`,
  );
  const converter = useAlertasConverterOcorrencia<ErroApi>();
  const cliente = useQueryClient();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Converter ${alerta.codigo} em ocorrência`}
      descricao="A ocorrência fica vinculada ao alerta. Prioridade e risco continuam a ser definidos por quem tem essa atribuição."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!tipo || !descricao.trim() || converter.isPending}
            onClick={() =>
              converter.mutate(
                { id: alerta.id, data: { tipo_id: tipo, descricao } },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/alertas", "/api/v1/ocorrencias"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Converter
          </Botao>
        </>
      }
    >
      {converter.error && <p className="mb-3 text-sm text-perigo">{converter.error.message}</p>}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Tipo de ocorrência" obrigatorio>
          {(p) => (
            <Selecao {...p} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Selecione</option>
              {tipos.data?.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Descrição" obrigatorio>
          {(p) => (
            <AreaTexto {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          )}
        </Campo>
      </div>
    </Dialogo>
  );
}
