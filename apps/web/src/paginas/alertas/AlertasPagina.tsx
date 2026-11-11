import {
  FonteAlertaEnum,
  StatusAlertaEnum,
  useAlertasListar,
  useTerritoriosListar,
} from "@itree/api-client";
import { ROTULOS_FONTE_ALERTA, ROTULOS_STATUS_ALERTA, ROTULOS_TIPO_ALERTA } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { useBairroDoFiltro } from "../../layout/territorio";
import { RAIO_PADRAO_M, SeletorRaio, type RaioM } from "./raio";
import { SeloStatusAlerta } from "../../componentes/selos";
import { EntradaData, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Linha, Tabela, Td, Th, ThOrdenavel } from "../../ui/tabela";
import { descreverAreaVerdeProxima, formatarDataHora, plural } from "../../util/formatos";

const TAMANHO = 50;

export type OrdemAlertas =
  | "data_deteccao"
  | "arvores_proximas"
  | "-arvores_proximas"
  | "ocorrencias_proximas"
  | "-ocorrencias_proximas";

export interface BuscaAlertas {
  status?: string;
  fonte?: FonteAlertaEnum;
  bairro?: string;
  raio?: RaioM;
  deteccao_desde?: string;
  deteccao_ate?: string;
  /** Ausente = mais recentes primeiro. */
  ordem?: OrdemAlertas;
  pagina?: number;
}

/** Abas que separam ocorrências confirmadas de alertas externos (RN-OCO-002). */
export function AbasOcorrencias({ ativa }: { ativa: "ocorrencias" | "alertas" }) {
  const veOcorrencias = usePermissao("ocorrencias.ler");
  const veAlertas = usePermissao("alertas.ler");
  const classe = (aba: string) =>
    `-mb-px border-b-2 px-3 py-2 text-sm ${ativa === aba ? "border-marca font-medium" : "border-transparent text-texto-suave hover:text-texto"}`;
  return (
    <nav aria-label="Ocorrências e alertas" className="mb-4 flex gap-1 border-b border-borda">
      {veOcorrencias && (
        <Link
          to="/ocorrencias"
          className={classe("ocorrencias")}
          aria-current={ativa === "ocorrencias" ? "page" : undefined}
        >
          Ocorrências
        </Link>
      )}
      {veAlertas && (
        <Link
          to="/alertas"
          className={classe("alertas")}
          aria-current={ativa === "alertas" ? "page" : undefined}
        >
          Alertas ambientais
        </Link>
      )}
    </nav>
  );
}

export function AlertasPagina() {
  const filtros = useSearch({ from: "/autenticado/alertas/" });
  const navegar = useNavigate({ from: "/alertas/" });
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const raio = filtros.raio ?? RAIO_PADRAO_M;
  const consulta = useAlertasListar({
    ...filtros,
    bairro,
    raio,
    status: filtros.status ?? "abertos",
    ordem: filtros.ordem,
    tamanho: TAMANHO,
  });
  const direcaoDe = (campo: "arvores_proximas" | "ocorrencias_proximas") =>
    filtros.ordem === campo ? "asc" : filtros.ordem === `-${campo}` ? "desc" : undefined;
  // Primeiro clique: mais próximas/ocorrências primeiro (decrescente), depois alterna.
  const ordenarPor = (campo: "arvores_proximas" | "ocorrencias_proximas") =>
    filtrar({ ordem: filtros.ordem === `-${campo}` ? campo : (`-${campo}` as OrdemAlertas) });
  const filtrar = (parcial: Partial<BuscaAlertas>) =>
    void navegar({ search: (s: BuscaAlertas) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Alertas ambientais"
        descricao="Sinais de fontes externas para triagem humana. Um alerta não é confirmação de infração."
      />
      <AbasOcorrencias ativa="alertas" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Status"
          value={filtros.status ?? "abertos"}
          onChange={(e) => filtrar({ status: e.target.value })}
          className="max-w-64"
        >
          <option value="abertos">Em aberto</option>
          {Object.values(StatusAlertaEnum).map((s) => (
            <option key={s} value={s}>
              {ROTULOS_STATUS_ALERTA[s]}
            </option>
          ))}
          <option value="todos">Todos</option>
        </Selecao>
        <Selecao
          aria-label="Fonte"
          value={filtros.fonte ?? ""}
          onChange={(e) =>
            filtrar({ fonte: (e.target.value || undefined) as FonteAlertaEnum | undefined })
          }
          className="max-w-72"
        >
          <option value="">Todas as fontes</option>
          {Object.values(FonteAlertaEnum).map((f) => (
            <option key={f} value={f}>
              {ROTULOS_FONTE_ALERTA[f]}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Bairro"
          value={bairro ?? ""}
          onChange={(e) => {
            filtrar({ bairro: e.target.value || undefined });
            aoEscolherBairro(e.target.value);
          }}
          className="max-w-48"
        >
          <option value="">Todos os bairros</option>
          {bairros.data?.data.results.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </Selecao>
        <SeletorRaio valor={raio} aoMudar={(r) => filtrar({ raio: r })} />
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          Detectados de
          <EntradaData
            value={filtros.deteccao_desde ?? ""}
            onChange={(v) => filtrar({ deteccao_desde: v || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <EntradaData
            value={filtros.deteccao_ate ?? ""}
            onChange={(v) => filtrar({ deteccao_ate: v || undefined })}
            className="w-40"
          />
        </label>
      </div>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhum alerta encontrado">
          Alertas chegam pela ingestão das fontes configuradas em Administração → Integrações.
        </Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Alerta</Th>
                <Th>Fonte e tipo</Th>
                <Th>Detecção (fonte)</Th>
                <Th>Ingestão</Th>
                <Th>Bairros</Th>
                <ThOrdenavel
                  direcao={direcaoDe("arvores_proximas")}
                  aoOrdenar={() => ordenarPor("arvores_proximas")}
                >
                  {`Árvores a até ${raio} m`}
                </ThOrdenavel>
                <ThOrdenavel
                  direcao={direcaoDe("ocorrencias_proximas")}
                  aoOrdenar={() => ordenarPor("ocorrencias_proximas")}
                >
                  Ocorrências
                </ThOrdenavel>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((a) => (
                <Linha key={a.id} className="hover:bg-fundo">
                  <Td>
                    <Link
                      to="/alertas/$id"
                      params={{ id: a.id }}
                      className="font-mono font-medium text-marca-escura hover:underline"
                    >
                      {a.codigo}
                    </Link>
                    <p className="font-mono text-xs text-texto-suave">{a.id_externo}</p>
                  </Td>
                  <Td>
                    {ROTULOS_FONTE_ALERTA[a.fonte]}
                    <p className="text-xs text-texto-suave">
                      {ROTULOS_TIPO_ALERTA[a.tipo]}
                      {a.area_ha ? ` · ${a.area_ha.toLocaleString("pt-BR")} ha` : ""}
                    </p>
                    {descreverAreaVerdeProxima(a.area_verde_proxima) && (
                      <p className="text-xs font-medium text-atencao">
                        {descreverAreaVerdeProxima(a.area_verde_proxima)}
                      </p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatarDataHora(a.data_deteccao)}</Td>
                  <Td className="whitespace-nowrap">{formatarDataHora(a.ingerido_em)}</Td>
                  <Td>
                    {(a.bairros as { nome: string }[]).map((b) => b.nome).join(", ") || (
                      <span className="text-texto-suave">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{plural(a.arvores_proximas, "árvore")}</Td>
                  <Td>
                    {a.ocorrencia && (
                      <Link
                        to="/ocorrencias/$id"
                        params={{ id: String(a.ocorrencia.id) }}
                        className="font-mono text-marca-escura hover:underline"
                      >
                        {String(a.ocorrencia.codigo)}
                      </Link>
                    )}
                    <p className="text-xs text-texto-suave">
                      {a.ocorrencias_proximas === 0
                        ? `nenhuma aberta a até ${raio} m`
                        : `${plural(a.ocorrencias_proximas, "aberta", "abertas")} a até ${raio} m`}
                    </p>
                  </Td>
                  <Td>
                    <SeloStatusAlerta status={a.status ?? "detectado"} />
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) => void navegar({ search: (s: BuscaAlertas) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
    </div>
  );
}
