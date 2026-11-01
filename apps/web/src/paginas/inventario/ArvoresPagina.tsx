import {
  EstadoEspecieEnum,
  OrigemLocalizacaoEnum,
  useArvoresContadores,
  useArvoresListar,
  useEspeciesListar,
  useTerritoriosListar,
} from "@itree/api-client";
import { ROTULOS_ESTADO_ESPECIE, ROTULOS_ORIGEM_LOCALIZACAO } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Map as IconeMapa, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { SeloEspecie, SeloLocalizacao, nomeEspecie } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarDataHora } from "../../util/formatos";
import { NovaArvoreDialogo } from "./NovaArvoreDialogo";

const TAMANHO = 50;

export interface BuscaArvores {
  busca?: string;
  especie?: string;
  especie_estado?: EstadoEspecieEnum;
  bairro?: string;
  localizacao_origem?: OrigemLocalizacaoEnum;
  situacao?: "ativa" | "excluida" | "fundida" | "todas";
  pagina?: number;
}

export function ArvoresPagina() {
  const filtros = useSearch({ from: "/autenticado/inventario/arvores" });
  const navegar = useNavigate({ from: "/inventario/arvores" });
  const podeEditar = usePermissao("inventario.editar");
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const especies = useEspeciesListar({ tamanho: 500, ativa: true });
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });

  useEffect(() => {
    const id = setTimeout(() => {
      if ((filtros.busca ?? "") !== busca) {
        void navegar({
          search: (s: BuscaArvores) => ({ ...s, busca: busca || undefined, pagina: undefined }),
        });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [busca, filtros.busca, navegar]);

  const { pagina, ...semPagina } = filtros;
  const consulta = useArvoresListar({ ...filtros, tamanho: TAMANHO });
  const contadores = useArvoresContadores({ ...semPagina, situacao: filtros.situacao ?? "ativa" });

  const filtrar = (parcial: Partial<BuscaArvores>) =>
    void navegar({ search: (s: BuscaArvores) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <>
      <CabecalhoPagina
        titulo="Árvores"
        descricao={
          contadores.data ? (
            <span>
              <strong>{contadores.data.data.total.toLocaleString("pt-BR")}</strong> registros ·{" "}
              <strong>{contadores.data.data.validos.toLocaleString("pt-BR")}</strong> válidos{" "}
              <span title="Válido: ativo, com localização e origem da localização conhecida (RN-INV-001, provisório até DP-14).">
                (o que é válido?)
              </span>
            </span>
          ) : (
            "Cadastro individual georreferenciado, no seu escopo territorial."
          )
        }
        acoes={
          <>
            <Botao variante="secundario" asChild>
              <Link to="/mapa" search={{ camada: "arvores" }}>
                <IconeMapa /> Ver no mapa
              </Link>
            </Botao>
            {podeEditar && (
              <Botao onClick={() => setNova(true)}>
                <Plus /> Nova árvore
              </Botao>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Entrada
          type="search"
          aria-label="Buscar"
          placeholder="Código, identificador externo ou endereço"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-72"
        />
        <Selecao
          aria-label="Espécie"
          value={filtros.especie ?? ""}
          onChange={(e) => filtrar({ especie: e.target.value || undefined })}
          className="max-w-60"
        >
          <option value="">Todas as espécies</option>
          {especies.data?.data.results.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome_cientifico}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Situação da identificação"
          value={filtros.especie_estado ?? ""}
          onChange={(e) =>
            filtrar({
              especie_estado: (e.target.value || undefined) as EstadoEspecieEnum | undefined,
            })
          }
          className="max-w-52"
        >
          <option value="">Qualquer identificação</option>
          {Object.entries(ROTULOS_ESTADO_ESPECIE).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Bairro"
          value={filtros.bairro ?? ""}
          onChange={(e) => filtrar({ bairro: e.target.value || undefined })}
          className="max-w-52"
        >
          <option value="">Todos os bairros</option>
          {bairros.data?.data.results.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Origem da localização"
          value={filtros.localizacao_origem ?? ""}
          onChange={(e) =>
            filtrar({
              localizacao_origem: (e.target.value || undefined) as
                OrigemLocalizacaoEnum | undefined,
            })
          }
          className="max-w-52"
        >
          <option value="">Qualquer localização</option>
          {Object.entries(ROTULOS_ORIGEM_LOCALIZACAO).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Situação do registro"
          value={filtros.situacao ?? "ativa"}
          onChange={(e) => filtrar({ situacao: e.target.value as BuscaArvores["situacao"] })}
          className="max-w-44"
        >
          <option value="ativa">Ativas</option>
          <option value="excluida">Excluídas</option>
          <option value="fundida">Fundidas</option>
          <option value="todas">Todas</option>
        </Selecao>
      </div>

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhuma árvore encontrada">
          Ajuste os filtros, cadastre uma árvore ou importe um inventário existente.
        </Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Espécie</Th>
                <Th>Localização</Th>
                <Th>Endereço / bairro</Th>
                <Th>Ocorrências abertas</Th>
                <Th>Atualizado em</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((a) => (
                <Linha key={a.id} className="hover:bg-fundo">
                  <Td>
                    <Link
                      to="/inventario/arvores/$id"
                      params={{ id: a.id }}
                      className="font-mono font-medium text-marca-escura hover:underline"
                    >
                      {a.codigo}
                    </Link>
                    {a.situacao !== "ativa" && (
                      <div>
                        <Selo tom="perigo">
                          {a.situacao === "excluida" ? "Excluída" : "Fundida"}
                        </Selo>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <p className={a.especie ? "italic" : "text-texto-suave"}>{nomeEspecie(a)}</p>
                    <SeloEspecie estado={a.especie_estado ?? "nao_identificada"} />
                  </Td>
                  <Td>
                    <SeloLocalizacao origem={a.localizacao_origem ?? ""} precisao={a.precisao_m} />
                  </Td>
                  <Td>
                    {a.endereco || <span className="text-texto-suave">—</span>}
                    {a.bairro && <p className="text-xs text-texto-suave">{a.bairro.nome}</p>}
                  </Td>
                  <Td>
                    {a.ocorrencias_abertas ? (
                      <Selo tom="atencao">{a.ocorrencias_abertas}</Selo>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatarDataHora(a.atualizado_em)}</Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) => void navegar({ search: (s: BuscaArvores) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
      {nova && <NovaArvoreDialogo aoFechar={() => setNova(false)} />}
    </>
  );
}
