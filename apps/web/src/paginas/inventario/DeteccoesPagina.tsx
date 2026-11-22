import {
  ErroApi,
  useDeteccoesLotesEnviarPacote,
  useDeteccoesLotesListar,
  useDeteccoesRemocoesConfirmar,
  useDeteccoesRemocoesDescartar,
  useDeteccoesRemocoesListar,
  type LoteDeteccao,
  type SinalRemocao,
} from "@itree/api-client";
import {
  ROTULOS_CANAL_LOTE_DETECCAO,
  ROTULOS_SENSOR_DETECCAO,
  ROTULOS_SITUACAO_LOTE_DETECCAO,
  type SensorDeteccao,
} from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { FileUp } from "lucide-react";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { SeloOrigemDeteccao } from "../../componentes/selosDeteccao";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, EntradaArquivo } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { formatarData, formatarDataHora } from "../../util/formatos";

type Aba = "lotes" | "remocoes";

const TOM_SITUACAO = {
  recebido: "info",
  em_processamento: "info",
  concluido: "sucesso",
  falhou: "perigo",
} as const;

export function SeloSituacaoLote({ situacao }: { situacao: keyof typeof TOM_SITUACAO }) {
  return <Selo tom={TOM_SITUACAO[situacao]}>{ROTULOS_SITUACAO_LOTE_DETECCAO[situacao]}</Selo>;
}

export function DeteccoesPagina() {
  const { aba = "lotes" } = useSearch({ from: "/autenticado/inventario/deteccoes" });
  const navegar = useNavigate({ from: "/inventario/deteccoes" });
  const podeEnviar = usePermissao("deteccao.enviar");
  const [enviando, setEnviando] = useState(false);

  const abas: { id: Aba; rotulo: string }[] = [
    { id: "lotes", rotulo: "Lotes recebidos" },
    { id: "remocoes", rotulo: "Possíveis remoções" },
  ];
  return (
    <>
      <CabecalhoPagina
        titulo="Detecções"
        descricao="Árvores detectadas automaticamente em vídeo de rua e em imagens de satélite. Entram no inventário com origem e confiança, e só viram confirmadas por inspeção ou revisão. Nada é removido sozinho."
        acoes={
          podeEnviar && (
            <Botao onClick={() => setEnviando(true)}>
              <FileUp /> Enviar pacote
            </Botao>
          )
        }
      />
      <div
        role="tablist"
        aria-label="Seções das detecções"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-borda"
      >
        {abas.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => void navegar({ search: { aba: a.id === "lotes" ? undefined : a.id } })}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap max-md:min-h-11 ${aba === a.id ? "border-marca font-medium" : "border-transparent text-texto-suave hover:text-texto"}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel">{aba === "lotes" ? <Lotes /> : <Remocoes />}</div>
      {enviando && <PacoteDialogo aoFechar={() => setEnviando(false)} />}
    </>
  );
}

function Lotes() {
  // Lote em segundo plano: a lista se atualiza sozinha até terminar.
  const consulta = useDeteccoesLotesListar(undefined, {
    query: {
      refetchInterval: (c) =>
        c.state.data?.data.results.some(
          (l) => l.situacao === "em_processamento" || l.situacao === "recebido",
        )
          ? 2000
          : false,
    },
  });
  if (consulta.isPending) return <Carregando />;
  if (consulta.isError)
    return <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />;
  const lotes = consulta.data.data.results;
  if (lotes.length === 0)
    return (
      <Vazio titulo="Nenhum lote de detecção recebido">
        O projeto de detecção envia lotes pela API (com um token criado em Administração ›
        Integrações) ou em pacote ZIP, pelo botão &ldquo;Enviar pacote&rdquo;.
      </Vazio>
    );
  return (
    <Tabela>
      <thead>
        <tr>
          <Th>Lote</Th>
          <Th>Sensor</Th>
          <Th cartao="oculta">Captura</Th>
          <Th>Situação</Th>
          <Th dica="Árvores novas criadas pelo lote">Criadas</Th>
          <Th dica="Observações juntadas a árvores que já existiam">Juntadas</Th>
          <Th>Recusadas</Th>
          <Th dica="Árvores conhecidas na área coberta que o lote não viu">Possíveis remoções</Th>
          <Th cartao="oculta">Enviado por</Th>
        </tr>
      </thead>
      <tbody>
        {lotes.map((l) => (
          <LinhaDoLote key={l.id} lote={l} />
        ))}
      </tbody>
    </Tabela>
  );
}

function LinhaDoLote({ lote }: { lote: LoteDeteccao }) {
  return (
    <Linha>
      <Td>
        <Link
          to="/inventario/deteccoes/$id"
          params={{ id: lote.id }}
          className="font-medium text-marca-escura hover:underline"
        >
          {lote.id_externo}
        </Link>
        <p className="text-xs text-texto-suave">
          {lote.projeto_origem} · {lote.versao_modelo}
        </p>
      </Td>
      <Td>
        <SeloOrigemDeteccao sensor={lote.sensor} />
        <p className="mt-0.5 text-xs text-texto-suave">{ROTULOS_CANAL_LOTE_DETECCAO[lote.canal]}</p>
      </Td>
      <Td>{formatarData(lote.capturado_em)}</Td>
      <Td>
        <SeloSituacaoLote situacao={lote.situacao} />
        {lote.situacao === "em_processamento" && lote.total > 0 && (
          <p className="mt-0.5 text-xs text-texto-suave">{lote.total} detecções na fila</p>
        )}
      </Td>
      <Td>{lote.arvores_criadas}</Td>
      <Td>{lote.arvores_juntadas}</Td>
      <Td>{lote.recusadas}</Td>
      <Td>{lote.possiveis_remocoes}</Td>
      <Td>{lote.enviado_por_nome}</Td>
    </Linha>
  );
}

function Remocoes() {
  const consulta = useDeteccoesRemocoesListar();
  const podeRevisar = usePermissao("deteccao.revisar");
  const [decidindo, setDecidindo] = useState<{ sinal: SinalRemocao; confirmar: boolean } | null>(
    null,
  );
  if (consulta.isPending) return <Carregando />;
  if (consulta.isError)
    return <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />;
  const sinais = consulta.data.data.results;
  if (sinais.length === 0)
    return (
      <Vazio titulo="Nenhuma possível remoção para revisar">
        Quando um lote cobre uma área e não vê uma árvore já conhecida, ela aparece aqui para
        revisão. Nada é removido sem a sua confirmação.
      </Vazio>
    );
  return (
    <>
      <p className="mb-3 text-sm text-texto-suave">
        São árvores conhecidas, dentro da área coberta por um lote, que o lote não viu. Pode ser
        remoção, mas também pode ser copa escondida, imagem ruim ou erro do modelo: confira antes de
        confirmar.
      </p>
      <Tabela>
        <thead>
          <tr>
            <Th>Árvore</Th>
            <Th cartao="oculta">Bairro</Th>
            <Th>Lote que não a viu</Th>
            <Th cartao="oculta">Vista pela última vez</Th>
            {podeRevisar && <Th />}
          </tr>
        </thead>
        <tbody>
          {sinais.map((s) => (
            <Linha key={s.id}>
              <Td>
                <Link
                  to="/inventario/arvores/$id"
                  params={{ id: s.arvore_id }}
                  className="font-medium text-marca-escura hover:underline"
                >
                  {s.arvore_codigo}
                </Link>
                <p className="text-xs text-texto-suave">
                  {s.especie || "Espécie não identificada"}
                </p>
              </Td>
              <Td>{s.bairro?.nome ?? "—"}</Td>
              <Td>
                <Link
                  to="/inventario/deteccoes/$id"
                  params={{ id: s.lote_id }}
                  className="text-marca-escura hover:underline"
                >
                  {s.lote_id_externo}
                </Link>
                <p className="text-xs text-texto-suave">
                  {ROTULOS_SENSOR_DETECCAO[s.lote_sensor as SensorDeteccao] ?? s.lote_sensor} ·{" "}
                  {formatarData(s.lote_capturado_em)}
                </p>
              </Td>
              <Td>{s.ultima_vez_vista_em ? formatarDataHora(s.ultima_vez_vista_em) : "—"}</Td>
              {podeRevisar && (
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Botao
                      variante="perigoContorno"
                      tamanho="pequeno"
                      onClick={() => setDecidindo({ sinal: s, confirmar: true })}
                    >
                      Confirmar remoção
                    </Botao>
                    <Botao
                      variante="secundario"
                      tamanho="pequeno"
                      onClick={() => setDecidindo({ sinal: s, confirmar: false })}
                    >
                      Descartar
                    </Botao>
                  </div>
                </Td>
              )}
            </Linha>
          ))}
        </tbody>
      </Tabela>
      {decidindo && (
        <DecisaoDialogo
          sinal={decidindo.sinal}
          confirmar={decidindo.confirmar}
          aoFechar={() => setDecidindo(null)}
        />
      )}
    </>
  );
}

function DecisaoDialogo({
  sinal,
  confirmar,
  aoFechar,
}: {
  sinal: SinalRemocao;
  confirmar: boolean;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const confirmarRemocao = useDeteccoesRemocoesConfirmar<ErroApi>();
  const descartar = useDeteccoesRemocoesDescartar<ErroApi>();
  const acao = confirmar ? confirmarRemocao : descartar;
  const enviar = () =>
    acao.mutate(
      { id: sinal.id, data: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          void invalidarCaminhos(cliente, "/api/v1/deteccoes", "/api/v1/arvores");
          aoFechar();
        },
      },
    );
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={
        confirmar
          ? `Confirmar a remoção de ${sinal.arvore_codigo}`
          : `Descartar o sinal de ${sinal.arvore_codigo}`
      }
      descricao={
        confirmar
          ? "A árvore será excluída do inventário (exclusão lógica, com histórico). Informe a justificativa."
          : "A árvore continua no inventário. Informe por que o sinal não procede."
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante={confirmar ? "perigo" : "primario"}
            disabled={!motivo.trim() || acao.isPending}
            onClick={enviar}
          >
            {confirmar ? "Confirmar remoção" : "Descartar sinal"}
          </Botao>
        </>
      }
    >
      <Campo rotulo="Justificativa" obrigatorio>
        {(p) => (
          <AreaTexto {...p} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        )}
      </Campo>
      {acao.isError && (
        <p role="alert" className="mt-2 text-sm text-perigo">
          {acao.error.message}
        </p>
      )}
    </Dialogo>
  );
}

function PacoteDialogo({ aoFechar }: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const enviar = useDeteccoesLotesEnviarPacote<ErroApi>();
  const erros = enviar.error?.corpo as { erros?: string[]; detail?: string } | undefined;
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Enviar pacote de detecções"
      descricao="ZIP com lote.json, deteccoes.geojson (ou deteccoes.gpkg) e as fotos. Cada foto precisa declarar que rostos e placas foram borrados; sem isso a detecção é recusada."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!arquivo || enviar.isPending}
            onClick={() =>
              arquivo &&
              enviar.mutate(
                { data: { arquivo } },
                {
                  onSuccess: (r) => {
                    void invalidarCaminhos(cliente, "/api/v1/deteccoes", "/api/v1/arvores");
                    aoFechar();
                    void navegar({
                      to: "/inventario/deteccoes/$id",
                      params: { id: r.data.id },
                    });
                  },
                },
              )
            }
          >
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Botao>
        </>
      }
    >
      <Campo rotulo="Pacote (.zip)" obrigatorio>
        {(p) => <EntradaArquivo {...p} accept=".zip" onChange={setArquivo} />}
      </Campo>
      <p className="mt-3 text-xs text-texto-suave">
        O formato está em docs/integracoes/deteccao-automatica.md. O envio vale pelo seu escopo
        territorial; o que estiver fora dele é recusado.
      </p>
      {enviar.isError && (
        <div role="alert" className="mt-3 text-sm text-perigo">
          <p>{erros?.detail ?? enviar.error.message}</p>
          {erros?.erros && (
            <ul className="mt-1 list-disc pl-5">
              {erros.erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialogo>
  );
}
