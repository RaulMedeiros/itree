import {
  ErroApi,
  useAlertasConverterOcorrencia,
  useAlertasHistorico,
  useAlertasObter,
  useAlertasTriagem,
  useTiposOcorrenciaListar,
  type Alerta as AlertaAmbiental,
  type StatusAlertaEnum,
} from "@itree/api-client";
import { ACOES_STATUS_ALERTA, ROTULOS_FONTE_ALERTA, ROTULOS_TIPO_ALERTA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { GeoJSONSource, LngLatBoundsLike, Map as MapaMapLibre } from "maplibre-gl";
import { ArrowLeft } from "lucide-react";
import { Fragment, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloStatusAlerta } from "../../componentes/selos";
import { Mapa } from "../../mapa/Mapa";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { invalidarCaminhos } from "../../util/cache";
import { formatarDataHora } from "../../util/formatos";

export function AlertaDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/alertas/$id" });
  const consulta = useAlertasObter(id);
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/alertas"
        className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" aria-hidden /> Alertas ambientais
      </Link>
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <Detalhe alerta={consulta.data.data} />
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

function Detalhe({ alerta: a }: { alerta: AlertaAmbiental }) {
  const podeTriar = usePermissao("alertas.triar");
  const podeRegistrar = usePermissao("ocorrencias.editar");
  const podeConverter =
    podeTriar && podeRegistrar && !a.ocorrencia && a.transicoes_possiveis.length > 0;
  const [status, setStatus] = useState<StatusAlertaEnum | null>(null);
  const [convertendo, setConvertendo] = useState(false);
  const historico = useAlertasHistorico(a.id);
  const geometria = a.geometria as { type: string; coordinates: unknown };

  const aoCarregar = (m: MapaMapLibre) => {
    m.addSource("alerta", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: geometria } as Parameters<
        GeoJSONSource["setData"]
      >[0],
    });
    if (a.tipo_geometria === "Point") {
      m.addLayer({
        id: "alerta",
        type: "circle",
        source: "alerta",
        paint: {
          "circle-radius": 9,
          "circle-color": "#d9480f",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      const [x1, y1] = (limites(geometria) as number[]).slice(0, 2);
      m.jumpTo({ center: [x1!, y1!], zoom: 14 });
    } else {
      m.addLayer({
        id: "alerta-area",
        type: "fill",
        source: "alerta",
        paint: { "fill-color": "#d9480f", "fill-opacity": 0.25 },
      });
      m.addLayer({
        id: "alerta-borda",
        type: "line",
        source: "alerta",
        paint: { "line-color": "#d9480f", "line-width": 2 },
      });
      m.fitBounds(limites(geometria), { padding: 40, duration: 0, maxZoom: 16 });
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo={`${a.codigo} · ${ROTULOS_TIPO_ALERTA[a.tipo]}`}
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
        <Mapa
          base="ruas"
          rotulo="Geometria do alerta"
          className="h-80 overflow-hidden rounded-lg border border-borda lg:col-span-3"
          aoCarregar={aoCarregar}
        />
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
