import {
  EstadoOcorrenciaEnum,
  PrioridadeEnum,
  useEquipesListar,
  useOcorrenciasListar,
  useTerritoriosListar,
  useTiposOcorrenciaListar,
} from "@itree/api-client";
import { ROTULOS_ESTADO_OCORRENCIA, ROTULOS_PRIORIDADE } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Map as IconeMapa, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { BarraAcoesEmLote, CaixaDaPagina } from "../../componentes/lote";
import { SeloEstadoOcorrencia, SeloPrioridade } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { AjudaTermo } from "../../componentes/AjudaTermo";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { contarFiltros } from "../../util/filtros";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora, prazoRestante } from "../../util/formatos";
import { AbasOcorrencias } from "../alertas/AlertasPagina";
import { LIMITE_ACOES_EM_LOTE, useSelecaoEmLote } from "../../util/lote";
import { PrioridadeEmLoteDialogo, ReatribuirEmLoteDialogo } from "./AcoesEmLote";
import { NovaOcorrenciaDialogo } from "./NovaOcorrenciaDialogo";

const TAMANHO = 50;

const ESTADOS_ENCERRADOS = new Set<string>([
  EstadoOcorrenciaEnum.concluida,
  EstadoOcorrenciaEnum.cancelada,
]);

/** "vence em 3 dias", só para ocorrência ainda em aberto; atraso em vermelho. */
function PrazoRestante({ prazo, aberta }: { prazo?: string | null; aberta: boolean }) {
  const restante = aberta ? prazoRestante(prazo) : null;
  if (!restante) return null;
  return (
    <p
      className={restante.atrasado ? "text-xs font-medium text-perigo" : "text-xs text-texto-suave"}
    >
      {restante.texto}
    </p>
  );
}

export interface BuscaOcorrencias {
  busca?: string;
  estado?: string;
  tipo?: string;
  prioridade?: PrioridadeEnum | "sem";
  bairro?: string;
  equipe?: string;
  atrasadas?: "true";
  pagina?: number;
}

export function OcorrenciasPagina() {
  const filtros = useSearch({ from: "/autenticado/ocorrencias/" });
  const navegar = useNavigate({ from: "/ocorrencias/" });
  const podeRegistrar = usePermissao("ocorrencias.editar");
  const podePriorizar = usePermissao("ocorrencias.priorizar");
  const [nova, setNova] = useState(false);
  const [acaoEmLote, setAcaoEmLote] = useState<"reatribuir" | "prioridade" | null>(null);
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const tipos = useTiposOcorrenciaListar();
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const equipes = useEquipesListar(
    { ativa: true, tamanho: 200 },
    { query: { enabled: usePermissao("tarefas.ler") } },
  );

  useEffect(() => {
    const id = setTimeout(() => {
      if ((filtros.busca ?? "") !== busca) {
        void navegar({
          search: (s: BuscaOcorrencias) => ({ ...s, busca: busca || undefined, pagina: undefined }),
        });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [busca, filtros.busca, navegar]);

  const estado = filtros.estado ?? "abertas";
  const consulta = useOcorrenciasListar({
    ...filtros,
    bairro,
    estado,
    atrasadas: filtros.atrasadas === "true" ? true : undefined,
    // Na fila de abertas, o que vence primeiro e é mais urgente vem no topo.
    ordenar: estado === "abertas" ? "urgencia" : undefined,
    tamanho: TAMANHO,
  });
  const filtrar = (parcial: Partial<BuscaOcorrencias>) =>
    void navegar({ search: (s: BuscaOcorrencias) => ({ ...s, ...parcial, pagina: undefined }) });
  // A seleção atravessa as páginas, mas só vale para os filtros em que foi feita.
  const selecao = useSelecaoEmLote(
    JSON.stringify({ ...filtros, pagina: undefined, bairro, estado }),
    consulta.data?.data.results.map((o) => o.id) ?? [],
  );

  return (
    <>
      <CabecalhoPagina
        titulo="Ocorrências"
        descricao="Situações registradas que demandam avaliação ou ação municipal. Alertas ambientais ficam separados."
        acoes={
          <>
            <Botao variante="secundario" asChild>
              <Link to="/mapa" search={{ camada: "ocorrencias" }}>
                <IconeMapa /> Ver no mapa
              </Link>
            </Botao>
            {podeRegistrar && (
              <Botao onClick={() => setNova(true)}>
                <Plus /> Registrar ocorrência
              </Botao>
            )}
          </>
        }
      />
      <AbasOcorrencias ativa="ocorrencias" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Entrada
          type="search"
          aria-label="Buscar"
          placeholder="Código, descrição ou endereço"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-64"
        />
        <Selecao
          aria-label="Estado"
          value={estado}
          onChange={(e) => filtrar({ estado: e.target.value })}
          className="max-w-48"
        >
          <option value="abertas">Em aberto (não encerradas)</option>
          {Object.values(EstadoOcorrenciaEnum).map((v) => (
            <option key={v} value={v}>
              {ROTULOS_ESTADO_OCORRENCIA[v]}
            </option>
          ))}
          <option value={Object.values(EstadoOcorrenciaEnum).join(",")}>Todas</option>
        </Selecao>
        <Selecao
          aria-label="Tipo"
          value={filtros.tipo ?? ""}
          onChange={(e) => filtrar({ tipo: e.target.value || undefined })}
          className="max-w-52"
        >
          <option value="">Todos os tipos</option>
          {tipos.data?.data.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Prioridade"
          value={filtros.prioridade ?? ""}
          onChange={(e) =>
            filtrar({ prioridade: (e.target.value || undefined) as BuscaOcorrencias["prioridade"] })
          }
          className="max-w-48"
        >
          <option value="">Qualquer prioridade</option>
          <option value="sem">Sem prioridade definida</option>
          {Object.values(PrioridadeEnum).map((v) => (
            <option key={v} value={v}>
              {ROTULOS_PRIORIDADE[v]}
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
        {equipes.data && (
          <Selecao
            aria-label="Equipe"
            value={filtros.equipe ?? ""}
            onChange={(e) => filtrar({ equipe: e.target.value || undefined })}
            className="max-w-48"
          >
            <option value="">Todas as equipes</option>
            {equipes.data.data.results.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </Selecao>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-marca"
            checked={filtros.atrasadas === "true"}
            onChange={(e) => filtrar({ atrasadas: e.target.checked ? "true" : undefined })}
          />
          Só atrasadas
        </label>
      </div>

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <ListaVazia
          filtrada={contarFiltros({ ...filtros, bairro }) > 0}
          aoLimparFiltros={() => {
            setBusca("");
            void navegar({ search: {} });
          }}
          titulo="Ainda não há ocorrências registradas"
          acao={
            podeRegistrar && (
              <Botao onClick={() => setNova(true)}>
                <Plus /> Registrar ocorrência
              </Botao>
            )
          }
        >
          Ocorrências são problemas observados em uma árvore ou num ponto da cidade, como galho
          caído ou risco de queda. Registre a primeira para abrir o atendimento.
        </ListaVazia>
      ) : (
        <>
          <BarraAcoesEmLote
            total={selecao.selecionadas.length}
            singular="ocorrência selecionada"
            plural="ocorrências selecionadas"
            aoLimpar={selecao.limpar}
          >
            {podeRegistrar && (
              <Botao
                variante="secundario"
                disabled={selecao.selecionadas.length > LIMITE_ACOES_EM_LOTE}
                onClick={() => setAcaoEmLote("reatribuir")}
              >
                Reatribuir
              </Botao>
            )}
            {podePriorizar && (
              <Botao
                variante="secundario"
                disabled={selecao.selecionadas.length > LIMITE_ACOES_EM_LOTE}
                onClick={() => setAcaoEmLote("prioridade")}
              >
                Alterar prioridade
              </Botao>
            )}
          </BarraAcoesEmLote>
          <Tabela>
            <thead>
              <tr>
                {(podeRegistrar || podePriorizar) && (
                  <Th className="w-10">
                    <CaixaDaPagina
                      rotulo="Selecionar todas as ocorrências da página"
                      inteira={selecao.paginaInteira}
                      parcial={selecao.paginaParcial}
                      aoAlternar={selecao.alternarPagina}
                    />
                  </Th>
                )}
                <Th>Código</Th>
                <Th>Tipo e descrição</Th>
                <Th>Local</Th>
                <Th>Estado</Th>
                <Th>
                  Prioridade <AjudaTermo id="prioridade_operacional" />
                </Th>
                <Th>Responsável</Th>
                <Th>Prazo</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((o) => (
                <Linha key={o.id} className="hover:bg-fundo">
                  {(podeRegistrar || podePriorizar) && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${o.codigo}`}
                        className="size-4 accent-marca"
                        checked={selecao.marcada(o.id)}
                        onChange={(e) => selecao.alternar(o.id, e.target.checked)}
                      />
                    </Td>
                  )}
                  <Td>
                    <Link
                      to="/ocorrencias/$id"
                      params={{ id: o.id }}
                      className="font-mono font-medium whitespace-nowrap text-marca-escura hover:underline"
                    >
                      {o.codigo}
                    </Link>
                    <p className="text-xs whitespace-nowrap text-texto-suave">
                      {formatarDataHora(o.criado_em)}
                    </p>
                  </Td>
                  <Td className="max-w-80">
                    <p className="font-medium">{o.tipo.nome}</p>
                    <p className="line-clamp-2 text-texto-suave">{o.descricao}</p>
                    {o.risco_confirmado && (
                      <Selo tom="perigo" className="mt-1">
                        <ShieldAlert className="size-3" aria-hidden /> Risco confirmado
                      </Selo>
                    )}
                  </Td>
                  <Td>
                    {o.arvore && <p className="font-mono text-xs">{String(o.arvore.codigo)}</p>}
                    {o.endereco || o.bairro?.nome || "—"}
                  </Td>
                  <Td>
                    <SeloEstadoOcorrencia estado={o.estado} />
                  </Td>
                  <Td>
                    <SeloPrioridade prioridade={o.prioridade} />
                  </Td>
                  <Td>
                    {o.responsavel?.nome || o.equipe?.nome || (
                      <span className="text-texto-suave">Não atribuída</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatarData(o.prazo) ?? "—"}
                    <PrazoRestante prazo={o.prazo} aberta={!ESTADOS_ENCERRADOS.has(o.estado)} />
                    {o.atrasada && (
                      <div>
                        <Selo tom="perigo">Atrasada</Selo>
                      </div>
                    )}
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) =>
              void navegar({ search: (s: BuscaOcorrencias) => ({ ...s, pagina: p }) })
            }
          />
        </>
      )}
      {nova && <NovaOcorrenciaDialogo aoFechar={() => setNova(false)} />}
      {acaoEmLote === "reatribuir" && (
        <ReatribuirEmLoteDialogo
          ids={selecao.selecionadas}
          aoFechar={(alterou) => {
            setAcaoEmLote(null);
            if (alterou) selecao.limpar();
          }}
        />
      )}
      {acaoEmLote === "prioridade" && (
        <PrioridadeEmLoteDialogo
          ids={selecao.selecionadas}
          aoFechar={(alterou) => {
            setAcaoEmLote(null);
            if (alterou) selecao.limpar();
          }}
        />
      )}
    </>
  );
}
