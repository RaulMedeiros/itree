import { useDeteccoesLotesObter, type LoteDeteccaoDetalhe } from "@itree/api-client";
import {
  ROTULOS_CANAL_LOTE_DETECCAO,
  ROTULOS_SENSOR_DETECCAO,
  type SensorDeteccao,
} from "@itree/domain";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { SeloOrigemDeteccao } from "../../componentes/selosDeteccao";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { SeloSituacaoLote } from "./DeteccoesPagina";
import { MapaDoLote } from "./MapaDoLote";

export function LoteDeteccaoPagina() {
  const { id } = useParams({ from: "/autenticado/inventario/deteccoes/$id" });
  const consulta = useDeteccoesLotesObter(id, {
    query: {
      refetchInterval: (c) =>
        c.state.data?.data.situacao === "em_processamento" ||
        c.state.data?.data.situacao === "recebido"
          ? 2000
          : false,
    },
  });
  if (consulta.isPending) return <Carregando linhas={8} />;
  if (consulta.isError)
    return (
      <>
        <Link
          to="/inventario/deteccoes"
          className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
        >
          <ArrowLeft className="size-4" aria-hidden /> Detecções
        </Link>
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      </>
    );
  return <Detalhe lote={consulta.data.data} />;
}

function Numero({ rotulo, valor, dica }: { rotulo: string; valor: number; dica: string }) {
  return (
    <div className="rounded-lg border border-borda bg-superficie p-3" title={dica}>
      <dt className="text-xs font-medium tracking-wide text-texto-suave uppercase">{rotulo}</dt>
      <dd className="mt-1 text-2xl font-semibold">{valor.toLocaleString("pt-BR")}</dd>
    </div>
  );
}

function Detalhe({ lote }: { lote: LoteDeteccaoDetalhe }) {
  const andamento =
    lote.situacao === "em_processamento" && lote.total_grupos
      ? `${lote.processadas} de ${lote.total_grupos} grupos tratados`
      : null;
  return (
    <>
      <CabecalhoPagina
        titulo={`Lote ${lote.id_externo}`}
        migalhas={[
          { rotulo: "Inventário", para: "/inventario" },
          { rotulo: "Detecções", para: "/inventario/deteccoes" },
          { rotulo: lote.id_externo },
        ]}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {lote.projeto_origem} · modelo {lote.versao_modelo}
            </span>
            <SeloOrigemDeteccao sensor={lote.sensor} />
            <SeloSituacaoLote situacao={lote.situacao} />
          </span>
        }
      />
      {lote.situacao === "falhou" && (
        <p role="alert" className="mb-4 rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
          O processamento foi interrompido: {lote.erro || "erro inesperado"}. Reenvie o lote.
        </p>
      )}
      {andamento && (
        <p role="status" className="mb-4 rounded-md bg-info-clara px-3 py-2 text-sm text-info">
          Processando em segundo plano: {andamento}.
        </p>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Numero rotulo="Recebidas" valor={lote.total} dica="Detecções no lote" />
        <Numero
          rotulo="Árvores criadas"
          valor={lote.arvores_criadas}
          dica="Árvores novas, não confirmadas, criadas pelo lote"
        />
        <Numero
          rotulo="Árvores atualizadas"
          valor={lote.arvores_juntadas}
          dica="Árvores que já existiam e receberam observações (várias detecções podem cair na mesma árvore)"
        />
        <Numero rotulo="Recusadas" valor={lote.recusadas} dica="Detecções que não passaram" />
        <Numero
          rotulo="Possíveis remoções"
          valor={lote.possiveis_remocoes}
          dica="Árvores conhecidas na área coberta que o lote não viu"
        />
      </dl>
      <section className="mb-4 rounded-lg border border-borda bg-superficie p-4">
        <h2 className="mb-3 font-semibold">Origem do lote</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Item rotulo="Sensor">
            {ROTULOS_SENSOR_DETECCAO[lote.sensor as SensorDeteccao] ?? lote.sensor}
          </Item>
          <Item rotulo="Capturado em">{formatarData(lote.capturado_em)}</Item>
          <Item rotulo="Recebido por">{ROTULOS_CANAL_LOTE_DETECCAO[lote.canal]}</Item>
          <Item rotulo="Enviado por">{lote.integracao_nome || lote.enviado_por_nome}</Item>
          <Item rotulo="Recebido em">{formatarDataHora(lote.criado_em)}</Item>
          <Item rotulo="Processado em">
            {lote.processado_em ? formatarDataHora(lote.processado_em) : "—"}
          </Item>
          <Item rotulo="Pontos de plantio novos">{String(lote.pontos_criados)}</Item>
          <Item rotulo="Arquivo">{lote.arquivo_nome || "—"}</Item>
        </dl>
        {!lote.area_coberta && (
          <p className="mt-3 text-xs text-texto-suave">
            Este lote não informou a área coberta; por isso não gera sinais de possível remoção.
          </p>
        )}
      </section>
      <div className="mb-4">
        <MapaDoLote loteId={lote.id} />
      </div>
      <section
        aria-label="Detecções recusadas"
        className="rounded-lg border border-borda bg-superficie p-4"
      >
        <h2 className="mb-2 font-semibold">Recusas e avisos</h2>
        {lote.erros.length === 0 ? (
          <p className="text-sm text-texto-suave">Nenhuma recusa nem aviso neste lote.</p>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Detecção</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {lote.erros.map((e, n) => (
                <Linha key={`${e.id}-${n}`}>
                  <Td semQuebra>{e.id}</Td>
                  <Td>{e.motivo}</Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
        )}
      </section>
    </>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-texto-suave uppercase">{rotulo}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
