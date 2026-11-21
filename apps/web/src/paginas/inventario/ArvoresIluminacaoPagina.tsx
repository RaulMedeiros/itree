import {
  useIluminacaoArvoresProximas,
  useIluminacaoResumo,
  useTerritoriosListar,
} from "@itree/api-client";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { BotaoExportarCsv } from "../../componentes/BotaoExportarCsv";
import { SeloEspecie, nomeEspecie } from "../../componentes/selos";
import { useBairroDoFiltro } from "../../layout/territorio";
import { capitalizar } from "../../mapa/iluminacao";
import { BarraAcoesLote } from "../../ui/barraLote";
import { Botao } from "../../ui/botao";
import { contarFiltros } from "../../util/filtros";
import { BarraFiltros, Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, plural } from "../../util/formatos";
import { CriarTarefasDialogo } from "../tarefas/CriarTarefasDialogo";
import {
  AVISO_RAIO_PROVISORIO,
  descricaoDoPoste,
  formatarDistancia,
  rotuloDaAltura,
} from "./iluminacao";

const TAMANHO = 50;

export interface BuscaIluminacao {
  bairro?: string;
  altura_poste_max_m?: number;
  busca?: string;
  pagina?: number;
}

/**
 * Árvores ativas a até R metros de um ponto de iluminação pública (SEINF). É só proximidade:
 * não afirma conflito, dano nem risco. O raio é provisório até a URBFOR e a SEINF o definirem
 * (DP-22), e a tela o diz em todo lugar em que o mostra.
 */
export function ArvoresIluminacaoPagina() {
  const filtros = useSearch({ from: "/autenticado/inventario/iluminacao" });
  const navegar = useNavigate({ from: "/inventario/iluminacao" });
  const podeTarefas = usePermissao("tarefas.editar");
  const resumo = useIluminacaoResumo();
  const bairros = useTerritoriosListar({ tipo: "bairro", tamanho: 500 });
  const { bairro, aoEscolher: aoEscolherBairro } = useBairroDoFiltro(filtros.bairro);
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const [criandoTarefas, setCriandoTarefas] = useState(false);
  // A seleção vale só para os filtros em que foi feita e atravessa as páginas.
  const [selecao, setSelecao] = useState<{ chave: string; ids: string[] }>({ chave: "", ids: [] });

  const { pagina, ...semPagina } = filtros;
  const consulta = useIluminacaoArvoresProximas({ ...filtros, bairro, tamanho: TAMANHO });
  const r = resumo.data?.data;
  const filtrar = (parcial: Partial<BuscaIluminacao>) =>
    void navegar({ search: (s: BuscaIluminacao) => ({ ...s, ...parcial, pagina: undefined }) });

  const chave = JSON.stringify({ ...semPagina, bairro });
  const selecionadas = selecao.chave === chave ? selecao.ids : [];
  const definir = (ids: string[]) => setSelecao({ chave, ids });
  const itens = consulta.data?.data.results ?? [];
  const idsDaPagina = itens.map((a) => a.id);
  const marcadasNaPagina = idsDaPagina.filter((id) => selecionadas.includes(id));
  const paginaInteira = idsDaPagina.length > 0 && marcadasNaPagina.length === idsDaPagina.length;
  const raio = r?.raio_conflito_m;

  return (
    <>
      <CabecalhoPagina
        titulo="Árvores próximas à iluminação"
        descricao={
          <span>
            Árvores ativas a até {raio !== undefined ? `${raio.toLocaleString("pt-BR")} m` : "R m"}{" "}
            de um ponto de iluminação pública, no seu escopo. <Selo tom="atencao">Provisório</Selo>
          </span>
        }
        acoes={
          <BotaoExportarCsv
            conjunto="arvores_iluminacao"
            filtros={{ ...semPagina, bairro }}
            leitura="inventario.ler"
          />
        }
      />
      <p
        role="note"
        className="mb-3 rounded-lg border border-borda bg-fundo px-3 py-2 text-sm text-texto-suave"
      >
        Proximidade não é conflito comprovado: a lista aponta onde olhar, não afirma dano nem risco
        ({AVISO_RAIO_PROVISORIO}).{" "}
        {r?.importada ? (
          <>
            Postes: {r.fonte}
            {r.licenca ? ` · ${r.licenca}` : ""}
            {r.data_referencia ? ` · dados de ${formatarData(r.data_referencia)}` : ""}.
          </>
        ) : null}{" "}
        <Link to="/mapa" search={{ iluminacao: "1", zoom: 16 }} className="text-marca underline">
          Ver a iluminação no mapa
        </Link>
      </p>
      <BarraFiltros
        principais={[
          <Entrada
            key="busca"
            type="search"
            aria-label="Buscar"
            placeholder="Código ou endereço da árvore"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && filtrar({ busca: busca || undefined })}
            onBlur={() => (filtros.busca ?? "") !== busca && filtrar({ busca: busca || undefined })}
          />,
          <Selecao
            key="bairro"
            aria-label="Bairro"
            value={bairro ?? ""}
            onChange={(e) => {
              filtrar({ bairro: e.target.value || undefined });
              aoEscolherBairro(e.target.value);
            }}
          >
            <option value="">Todos os bairros</option>
            {bairros.data?.data.results.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </Selecao>,
          <Selecao
            key="altura"
            aria-label="Altura do poste"
            value={filtros.altura_poste_max_m ? String(filtros.altura_poste_max_m) : ""}
            onChange={(e) =>
              filtrar({ altura_poste_max_m: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">Qualquer altura de poste</option>
            {(r?.alturas_maximas_m ?? []).map((m) => (
              <option key={m} value={m}>
                Poste de {rotuloDaAltura(m)}
              </option>
            ))}
          </Selecao>,
        ]}
        ativos={contarFiltros({ ...filtros, bairro })}
      />

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <ListaVazia
          filtrada={Boolean(bairro || filtros.altura_poste_max_m || filtros.busca)}
          aoLimparFiltros={() => {
            setBusca("");
            void navegar({ search: {} });
          }}
          titulo={
            r && !r.importada
              ? "Os pontos de iluminação ainda não foram importados"
              : "Nenhuma árvore próxima à iluminação"
          }
        >
          {r && !r.importada
            ? "Quem administra o sistema importa a fonte da SEINF com o comando importar_iluminacao_publica."
            : `Nenhuma árvore ativa do seu escopo está a até ${raio?.toLocaleString("pt-BR") ?? "R"} m de um ponto de iluminação (${AVISO_RAIO_PROVISORIO}).`}
        </ListaVazia>
      ) : (
        <>
          {selecionadas.length > 0 && (
            <BarraAcoesLote>
              <p role="status" className="mr-2 text-sm font-medium">
                {plural(selecionadas.length, "árvore selecionada", "árvores selecionadas")}
              </p>
              {podeTarefas && (
                <Botao variante="secundario" onClick={() => setCriandoTarefas(true)}>
                  Criar tarefas de inspeção
                </Botao>
              )}
              <Botao variante="fantasma" onClick={() => definir([])}>
                Limpar seleção
              </Botao>
            </BarraAcoesLote>
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
                    onChange={(e) =>
                      definir(
                        e.target.checked
                          ? [
                              ...selecionadas,
                              ...idsDaPagina.filter((i) => !selecionadas.includes(i)),
                            ]
                          : selecionadas.filter((i) => !idsDaPagina.includes(i)),
                      )
                    }
                  />
                </Th>
                <Th>Código</Th>
                <Th>Espécie</Th>
                <Th>Endereço / bairro</Th>
                <Th>Distância do poste</Th>
                <Th cartao="oculta">Poste mais próximo</Th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <Linha key={a.id} className="hover:bg-fundo">
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${a.codigo}`}
                      className="size-4 accent-marca"
                      checked={selecionadas.includes(a.id)}
                      onChange={(e) =>
                        definir(
                          e.target.checked
                            ? [...selecionadas, a.id]
                            : selecionadas.filter((i) => i !== a.id),
                        )
                      }
                    />
                  </Td>
                  <Td>
                    <Link
                      to="/inventario/arvores/$id"
                      params={{ id: a.id }}
                      className="font-mono font-medium whitespace-nowrap text-marca-escura hover:underline"
                    >
                      {a.codigo}
                    </Link>
                  </Td>
                  <Td>
                    <p className={a.especie ? "italic" : "text-texto-suave"}>{nomeEspecie(a)}</p>
                    <SeloEspecie estado={a.especie_estado ?? "nao_identificada"} />
                  </Td>
                  <Td className="min-w-56">
                    {a.endereco || <span className="text-texto-suave">—</span>}
                    {a.bairro && <p className="text-xs text-texto-suave">{a.bairro.nome}</p>}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {a.poste ? formatarDistancia(a.poste.distancia_m) : "—"}
                  </Td>
                  <Td className="min-w-56">
                    {a.poste ? (
                      <>
                        {descricaoDoPoste(a.poste)}
                        <p className="text-xs text-texto-suave">
                          Ponto {a.poste.codigo}
                          {a.poste.logradouro ? ` · ${capitalizar(a.poste.logradouro)}` : ""}
                        </p>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) => void navegar({ search: (s: BuscaIluminacao) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
      {criandoTarefas && (
        <CriarTarefasDialogo
          alvo={{ tipo: "selecao", arvoreIds: selecionadas, origem: "lista" }}
          aoFechar={() => setCriandoTarefas(false)}
        />
      )}
    </>
  );
}
