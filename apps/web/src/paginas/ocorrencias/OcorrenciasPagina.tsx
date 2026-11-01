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
import { Map as IconeMapa, Plus, Satellite } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { SeloEstadoOcorrencia, SeloPrioridade } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { NovaOcorrenciaDialogo } from "./NovaOcorrenciaDialogo";

const TAMANHO = 50;

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
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const tipos = useTiposOcorrenciaListar();
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
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
    estado,
    atrasadas: filtros.atrasadas === "true" ? true : undefined,
    tamanho: TAMANHO,
  });
  const filtrar = (parcial: Partial<BuscaOcorrencias>) =>
    void navegar({ search: (s: BuscaOcorrencias) => ({ ...s, ...parcial, pagina: undefined }) });

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
      <div
        className="mb-4 flex gap-1 border-b border-borda"
        role="tablist"
        aria-label="Tipo de registro"
      >
        <span
          role="tab"
          aria-selected
          className="-mb-px border-b-2 border-marca px-3 py-2 text-sm font-medium"
        >
          Ocorrências
        </span>
        <span
          role="tab"
          aria-selected={false}
          aria-disabled
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-texto-suave"
          title="Previsto para a F3 (W-08)"
        >
          <Satellite className="size-4" aria-hidden /> Alertas ambientais <Selo>F3</Selo>
        </span>
      </div>
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
          value={filtros.bairro ?? ""}
          onChange={(e) => filtrar({ bairro: e.target.value || undefined })}
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
        <Vazio titulo="Nenhuma ocorrência encontrada">
          Ajuste os filtros ou registre uma ocorrência.
        </Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Tipo e descrição</Th>
                <Th>Local</Th>
                <Th>Estado</Th>
                <Th>Prioridade</Th>
                <Th>Responsável</Th>
                <Th>Prazo</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((o) => (
                <Linha key={o.id} className="hover:bg-fundo">
                  <Td>
                    <Link
                      to="/ocorrencias/$id"
                      params={{ id: o.id }}
                      className="font-mono font-medium text-marca-escura hover:underline"
                    >
                      {o.codigo}
                    </Link>
                    <p className="text-xs text-texto-suave">{formatarDataHora(o.criado_em)}</p>
                  </Td>
                  <Td className="max-w-80">
                    <p className="font-medium">{o.tipo.nome}</p>
                    <p className="line-clamp-2 text-texto-suave">{o.descricao}</p>
                    {o.risco_confirmado && <Selo tom="perigo">Risco confirmado</Selo>}
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
    </>
  );
}
