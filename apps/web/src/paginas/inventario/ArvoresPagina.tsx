import {
  ErroApi,
  EstadoEspecieEnum,
  OrigemLocalizacaoEnum,
  baixarArquivo,
  useArvoresContadores,
  useArvoresListar,
  useEspeciesListar,
  useTerritoriosListar,
} from "@itree/api-client";
import {
  ROTULOS_CONDICAO,
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ORIGEM_LOCALIZACAO,
} from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Download, Map as IconeMapa, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { AjudaTermo } from "../../componentes/AjudaTermo";
import { SeloEspecie, SeloLocalizacao, nomeEspecie } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { contarFiltros } from "../../util/filtros";
import { MenuAgrupado } from "../../ui/menu";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th, ThOrdenavel } from "../../ui/tabela";
import { CORES_CONDICAO } from "../../mapa/simbologia";
import { formatarData, formatarDataHora, plural } from "../../util/formatos";
import { CriarTarefasDialogo } from "../tarefas/CriarTarefasDialogo";
import { NovaArvoreDialogo } from "./NovaArvoreDialogo";
import { direcaoDe, proximaOrdenacao, type CampoOrdenacao, type Ordenacao } from "./ordenacao";

const TAMANHO = 50;

export interface BuscaArvores {
  busca?: string;
  especie?: string;
  /** "nao_confirmada" reúne tudo o que não é "confirmada". */
  especie_estado?: EstadoEspecieEnum | "nao_confirmada";
  valida?: true;
  bairro?: string;
  localizacao_origem?: OrigemLocalizacaoEnum;
  situacao?: "ativa" | "excluida" | "fundida" | "todas";
  sem_inspecao_dias?: number;
  condicao_aparente?: string;
  ordenar?: Ordenacao;
  pagina?: number;
}

/** Ponto na cor do mapa mais o texto: a condição nunca depende só da cor (RNF-A11Y-002). */
function CondicaoAparente({ condicao }: { condicao?: string }) {
  const chave = (
    condicao && condicao in ROTULOS_CONDICAO ? condicao : "nao_avaliada"
  ) as keyof typeof ROTULOS_CONDICAO;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ backgroundColor: CORES_CONDICAO[chave] }}
      />
      <span className={chave === "nao_avaliada" ? "text-texto-suave" : undefined}>
        {ROTULOS_CONDICAO[chave]}
      </span>
    </span>
  );
}

export function ArvoresPagina() {
  const filtros = useSearch({ from: "/autenticado/inventario/arvores" });
  const navegar = useNavigate({ from: "/inventario/arvores" });
  const podeEditar = usePermissao("inventario.editar");
  const podeTarefas = usePermissao("tarefas.editar");
  const podeImportar = usePermissao("inventario.importar");
  const podeExportar = usePermissao("relatorios.exportar", "inventario.ler");
  const [criandoTarefas, setCriandoTarefas] = useState(false);
  const [tarefasDaSelecao, setTarefasDaSelecao] = useState(false);
  // Seleção em lote: atravessa as páginas, mas só vale para os filtros em que foi feita.
  // Com `todos`, vale para todas as árvores dos filtros, sem lista de ids.
  const [selecao, setSelecao] = useState<{ chave: string; ids: string[]; todos: boolean }>({
    chave: "",
    ids: [],
    todos: false,
  });
  const [baixando, setBaixando] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const especies = useEspeciesListar({ tamanho: 500, ativa: true });
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);

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

  const { pagina, ordenar, ...semPagina } = filtros;
  const consulta = useArvoresListar({ ...filtros, bairro, tamanho: TAMANHO });
  const contadores = useArvoresContadores({
    ...semPagina,
    bairro,
    situacao: filtros.situacao ?? "ativa",
  });

  const filtrar = (parcial: Partial<BuscaArvores>) =>
    void navegar({ search: (s: BuscaArvores) => ({ ...s, ...parcial, pagina: undefined }) });

  const ordenacao: Ordenacao = ordenar ?? "-numero";
  const ordenarPor = (campo: CampoOrdenacao) =>
    filtrar({ ordenar: proximaOrdenacao(ordenacao, campo) });

  // Filtros em texto, como a API espera (os mesmos da listagem, sem página nem ordem).
  const filtrosEmTexto: Record<string, string> = Object.fromEntries(
    Object.entries({ ...semPagina, bairro })
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const chaveDosFiltros = JSON.stringify(filtrosEmTexto);
  const total = consulta.data?.data.count ?? 0;
  const limiteLote = contadores.data?.data.limite_tarefas_em_lote;

  const selecaoVigente = selecao.chave === chaveDosFiltros;
  const todosFiltrados = selecaoVigente && selecao.todos;
  const selecionadas = selecaoVigente ? selecao.ids : [];
  const setSelecionadas = (ids: string[]) =>
    setSelecao({ chave: chaveDosFiltros, ids, todos: false });
  const marcarTodosFiltrados = () =>
    setSelecao({ chave: chaveDosFiltros, ids: selecionadas, todos: true });
  const totalSelecionado = todosFiltrados ? total : selecionadas.length;

  const itens = consulta.data?.data.results ?? [];
  const idsDaPagina = itens.map((a) => a.id);
  const marcadasNaPagina = idsDaPagina.filter((id) => todosFiltrados || selecionadas.includes(id));
  const paginaInteira = idsDaPagina.length > 0 && marcadasNaPagina.length === idsDaPagina.length;
  const alternar = (id: string, marcado: boolean) =>
    setSelecionadas(marcado ? [...selecionadas, id] : selecionadas.filter((x) => x !== id));
  const alternarPagina = (marcado: boolean) =>
    setSelecionadas(
      marcado
        ? [...selecionadas, ...idsDaPagina.filter((id) => !selecionadas.includes(id))]
        : selecionadas.filter((id) => !idsDaPagina.includes(id)),
    );
  const excedeLote = limiteLote !== undefined && totalSelecionado > limiteLote;

  const exportarSelecao = async (formato: "csv" | "xlsx" | "geojson") => {
    setBaixando(true);
    setErroArquivo(null);
    try {
      // POST com o corpo em JSON: a lista de ids não cabe numa URL.
      await baixarArquivo(
        "/api/v1/relatorios/exportar-arvores",
        {},
        {
          corpo: todosFiltrados
            ? { formato, todos_filtrados: true, filtros: filtrosEmTexto }
            : { formato, ids: selecionadas },
        },
      );
    } catch (e) {
      setErroArquivo(e instanceof ErroApi ? e.message : "Falha ao gerar o arquivo.");
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Árvores"
        descricao={
          contadores.data ? (
            <span>
              <strong>{contadores.data.data.total.toLocaleString("pt-BR")}</strong> registros ·{" "}
              <strong>{contadores.data.data.validos.toLocaleString("pt-BR")}</strong> válidos{" "}
              <AjudaTermo id="registro_valido" />
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
            {podeTarefas && (
              <Botao
                variante="secundario"
                disabled={!total || (limiteLote !== undefined && total > limiteLote)}
                title={
                  limiteLote !== undefined && total > limiteLote
                    ? `Os filtros alcançam mais de ${limiteLote.toLocaleString("pt-BR")} árvores, o limite por lote. Refine os filtros.`
                    : undefined
                }
                onClick={() => setCriandoTarefas(true)}
              >
                Criar tarefas de inspeção
              </Botao>
            )}
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
          placeholder="Código, ID externo ou endereço"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full sm:w-72"
        />
        <Selecao
          aria-label="Espécie"
          value={filtros.especie ?? ""}
          onChange={(e) => filtrar({ especie: e.target.value || undefined })}
          className="w-full sm:w-48"
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
              especie_estado: (e.target.value || undefined) as BuscaArvores["especie_estado"],
            })
          }
          className="w-full sm:w-48"
        >
          <option value="">Toda identificação</option>
          <option value="nao_confirmada">Não confirmada</option>
          {Object.entries(ROTULOS_ESTADO_ESPECIE).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
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
          className="w-full sm:w-48"
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
          className="w-full sm:w-48"
        >
          <option value="">Toda localização</option>
          {Object.entries(ROTULOS_ORIGEM_LOCALIZACAO).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Última inspeção"
          value={filtros.sem_inspecao_dias ? String(filtros.sem_inspecao_dias) : ""}
          onChange={(e) =>
            filtrar({ sem_inspecao_dias: e.target.value ? Number(e.target.value) : undefined })
          }
          className="w-full sm:w-48"
        >
          <option value="">Toda última inspeção</option>
          <option value="180">Sem inspeção há 6 meses</option>
          <option value="365">Sem inspeção há 1 ano</option>
          <option value="730">Sem inspeção há 2 anos</option>
        </Selecao>
        <Selecao
          aria-label="Situação do registro"
          value={filtros.situacao ?? "ativa"}
          onChange={(e) => filtrar({ situacao: e.target.value as BuscaArvores["situacao"] })}
          className="w-full sm:w-48"
        >
          <option value="ativa">Ativas</option>
          <option value="excluida">Excluídas</option>
          <option value="fundida">Fundidas</option>
          <option value="todas">Todas</option>
        </Selecao>
      </div>
      {filtros.valida && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-texto-suave">
          Só registros válidos: ativos, com localização e origem registradas (critério provisório),
          como na Visão geral.
          <Botao variante="fantasma" onClick={() => filtrar({ valida: undefined })}>
            Mostrar todos
          </Botao>
        </p>
      )}

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <ListaVazia
          filtrada={
            contarFiltros({ ...filtros, bairro, situacao: filtros.situacao ?? "ativa" }, [
              "situacao",
            ]) > 0 || (filtros.situacao ?? "ativa") !== "ativa"
          }
          aoLimparFiltros={() => {
            setBusca("");
            void navegar({ search: {} });
          }}
          titulo="Ainda não há árvores cadastradas"
          acao={
            (podeEditar || podeImportar) && (
              <div className="flex flex-wrap justify-center gap-2">
                {podeImportar && (
                  <Botao asChild>
                    <Link to="/inventario/importacoes">Importar inventário existente</Link>
                  </Botao>
                )}
                {podeEditar && (
                  <Botao variante="secundario" onClick={() => setNova(true)}>
                    <Plus /> Cadastrar árvore
                  </Botao>
                )}
              </div>
            )
          }
        >
          Importe o inventário que a prefeitura já tem (planilha ou GeoJSON) ou cadastre a primeira
          árvore. Elas aparecem aqui, no mapa e na visão geral.
        </ListaVazia>
      ) : (
        <>
          {totalSelecionado > 0 && (
            <div
              role="region"
              aria-label="Ações da seleção"
              className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-marca bg-marca-clara px-3 py-2"
            >
              <p role="status" className="mr-2 text-sm font-medium">
                {plural(totalSelecionado, "árvore selecionada", "árvores selecionadas")}
                {todosFiltrados && " (todas as dos filtros)"}
              </p>
              {!todosFiltrados && paginaInteira && total > idsDaPagina.length && (
                <Botao variante="fantasma" onClick={marcarTodosFiltrados}>
                  Selecionar todos os {total.toLocaleString("pt-BR")} filtrados
                </Botao>
              )}
              {podeTarefas && (
                <Botao
                  variante="secundario"
                  disabled={excedeLote}
                  onClick={() => setTarefasDaSelecao(true)}
                >
                  Criar tarefas de inspeção
                </Botao>
              )}
              {podeExportar && (
                <MenuAgrupado
                  rotulo="Exportar seleção"
                  icone={<Download />}
                  desabilitado={baixando}
                  grupos={[
                    {
                      titulo: "Formato do arquivo",
                      itens: (
                        [
                          ["csv", "CSV"],
                          ["xlsx", "XLSX"],
                          ["geojson", "GeoJSON"],
                        ] as const
                      ).map(([formato, rotulo]) => ({
                        rotulo,
                        aoEscolher: () => void exportarSelecao(formato),
                      })),
                    },
                  ]}
                />
              )}
              <Botao variante="fantasma" onClick={() => setSelecionadas([])}>
                Limpar seleção
              </Botao>
              {baixando && (
                <p role="status" className="text-xs text-texto-suave">
                  Gerando arquivo…
                </p>
              )}
              {erroArquivo && (
                <p role="alert" className="text-sm text-perigo">
                  {erroArquivo}
                </p>
              )}
              {excedeLote && podeTarefas && (
                <p role="status" className="basis-full text-xs text-texto-suave">
                  O limite é de {limiteLote.toLocaleString("pt-BR")} árvores por lote de tarefas.
                  Reduza a seleção ou refine os filtros para criar as tarefas.
                </p>
              )}
            </div>
          )}
          <Tabela>
            <thead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas as árvores da página"
                    className="size-4 accent-marca"
                    checked={paginaInteira}
                    ref={(el) => {
                      if (el) el.indeterminate = marcadasNaPagina.length > 0 && !paginaInteira;
                    }}
                    disabled={todosFiltrados}
                    onChange={(e) => alternarPagina(e.target.checked)}
                  />
                </Th>
                <ThOrdenavel
                  direcao={direcaoDe(ordenacao, "numero")}
                  aoOrdenar={() => ordenarPor("numero")}
                >
                  Código
                </ThOrdenavel>
                <Th>Espécie</Th>
                <Th>Localização</Th>
                <Th>Endereço / bairro</Th>
                <ThOrdenavel
                  direcao={direcaoDe(ordenacao, "condicao_aparente")}
                  aoOrdenar={() => ordenarPor("condicao_aparente")}
                >
                  Condição aparente
                </ThOrdenavel>
                <ThOrdenavel
                  direcao={direcaoDe(ordenacao, "ultima_inspecao_em")}
                  aoOrdenar={() => ordenarPor("ultima_inspecao_em")}
                >
                  Última inspeção
                </ThOrdenavel>
                <Th>Ocorrências abertas</Th>
                <ThOrdenavel
                  direcao={direcaoDe(ordenacao, "atualizado_em")}
                  aoOrdenar={() => ordenarPor("atualizado_em")}
                >
                  Atualizado em
                </ThOrdenavel>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((a) => (
                <Linha key={a.id} className="hover:bg-fundo">
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${a.codigo}`}
                      className="size-4 accent-marca"
                      checked={todosFiltrados || selecionadas.includes(a.id)}
                      disabled={todosFiltrados}
                      onChange={(e) => alternar(a.id, e.target.checked)}
                    />
                  </Td>
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
                    <CondicaoAparente condicao={a.condicao_aparente} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatarData(a.ultima_inspecao_em) ?? (
                      <span className="text-texto-suave">Nunca</span>
                    )}
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
      {tarefasDaSelecao && (
        <CriarTarefasDialogo
          alvo={
            todosFiltrados
              ? { tipo: "lote", filtros: filtrosEmTexto, total }
              : { tipo: "selecao", arvoreIds: selecionadas, origem: "lista" }
          }
          aoFechar={() => setTarefasDaSelecao(false)}
        />
      )}
      {criandoTarefas && (
        <CriarTarefasDialogo
          alvo={{
            tipo: "lote",
            filtros: filtrosEmTexto,
            total,
          }}
          aoFechar={() => setCriandoTarefas(false)}
        />
      )}
    </>
  );
}
