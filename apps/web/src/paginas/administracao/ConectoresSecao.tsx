import {
  ErroApi,
  useConectoresAtualizar,
  useConectoresCriar,
  useConectoresExecucoes,
  useConectoresListar,
  useConectoresSincronizar,
  useConectoresTestar,
  useModelosImportacaoListar,
  type Conector,
  type ConectorRequest,
  type ResultadoTeste,
} from "@itree/api-client";
import {
  ROTULOS_DESTINO_CONECTOR,
  ROTULOS_MODO_CONECTOR,
  ROTULOS_PERIODICIDADE,
  ROTULOS_TIPO_CONECTOR,
  SITUACAO_CONECTOR,
} from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { descreverHa, formatarDataHora } from "../../util/formatos";
import { PARAMETROS_POR_TIPO, escreverRotulos, lerRotulos, resumoExecucao } from "./conectores";

const CAMINHO_CONECTORES = "/api/v1/conectores";

/** Conectores de fontes externas (RF-INT-006): lista, formulário com teste e histórico. */
export function ConectoresSecao() {
  const consulta = useConectoresListar({
    // Enquanto algum conector sincroniza, a lista se atualiza sozinha.
    query: {
      refetchInterval: (c) =>
        c.state.data?.data.some((x) => x.situacao === "sincronizando") ? 3000 : false,
    },
  });
  const [editando, setEditando] = useState<Conector | "novo" | null>(null);
  const [historico, setHistorico] = useState<Conector | null>(null);
  const cliente = useQueryClient();
  const sincronizar = useConectoresSincronizar<ErroApi>({
    mutation: { onSettled: () => invalidarCaminhos(cliente, CAMINHO_CONECTORES) },
  });
  return (
    <section aria-labelledby="titulo-conectores" className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="titulo-conectores" className="text-base font-semibold">
          Conectores
        </h2>
        <Botao variante="secundario" onClick={() => setEditando("novo")}>
          <Plus /> Novo conector
        </Botao>
      </div>
      <p className="mb-3 text-sm text-texto-suave">
        Buscam dados de fontes externas por endereço, com atribuição obrigatória. Uma camada de
        referência aparece no mapa como contexto; um lote de importação chega só como prévia e
        precisa ser confirmado por uma pessoa.
      </p>
      {sincronizar.error && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {sincronizar.error.message}
        </p>
      )}
      {consulta.isPending ? (
        <Carregando linhas={2} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhum conector cadastrado">
          Cadastre uma fonte para trazer camadas de referência ou prévias de importação.
        </Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Conector</Th>
              <Th>Destino</Th>
              <Th>Última execução</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.map((c) => (
              <LinhaConector
                key={c.id}
                conector={c}
                sincronizando={sincronizar.isPending && sincronizar.variables?.id === c.id}
                aoSincronizar={() => sincronizar.mutate({ id: c.id })}
                aoEditar={() => setEditando(c)}
                aoVerHistorico={() => setHistorico(c)}
              />
            ))}
          </tbody>
        </Tabela>
      )}
      {editando && (
        <ConectorDialogo
          conector={editando === "novo" ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      )}
      {historico && <HistoricoDialogo conector={historico} aoFechar={() => setHistorico(null)} />}
    </section>
  );
}

function LinhaConector({
  conector: c,
  sincronizando,
  aoSincronizar,
  aoEditar,
  aoVerHistorico,
}: {
  conector: Conector;
  sincronizando: boolean;
  aoSincronizar: () => void;
  aoEditar: () => void;
  aoVerHistorico: () => void;
}) {
  const situacao = SITUACAO_CONECTOR[c.situacao] ?? SITUACAO_CONECTOR.nunca!;
  const ultima = c.ultima_execucao;
  return (
    <Linha>
      <Td>
        <p className="font-medium">{c.nome}</p>
        <p className="text-xs text-texto-suave">
          {ROTULOS_TIPO_CONECTOR[c.tipo]} · {ROTULOS_PERIODICIDADE[c.periodicidade ?? "manual"]}
        </p>
        <p className="text-xs text-texto-suave">{c.orgao}</p>
        {!c.ativo && (
          <Selo tom="neutro" className="mt-1">
            Inativo
          </Selo>
        )}
      </Td>
      <Td>
        {ROTULOS_DESTINO_CONECTOR[c.destino]}
        {c.destino === "camada_referencia" && (
          <p className="text-xs text-texto-suave">{c.total_feicoes} feições</p>
        )}
        {c.previa_pendente != null && (
          <p className="mt-1">
            <Selo tom="atencao">Prévia aguardando</Selo>{" "}
            <Link to="/inventario/importacoes" className="text-xs text-marca underline">
              Lote {c.previa_pendente}: revisar e confirmar
            </Link>
          </p>
        )}
      </Td>
      <Td>
        <Selo tom={situacao.tom}>{situacao.rotulo}</Selo>
        {ultima && (
          <>
            <p
              className="mt-1 text-xs text-texto-suave"
              title={formatarDataHora(ultima.iniciada_em) ?? undefined}
            >
              {descreverHa(ultima.iniciada_em)}
            </p>
            <p className="text-xs text-texto-suave">
              {ultima.sucesso ? resumoExecucao(ultima) : ultima.erro}
            </p>
            {ultima.detalhe && <p className="text-xs text-texto-suave">{ultima.detalhe}</p>}
          </>
        )}
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          <Botao
            variante="secundario"
            tamanho="pequeno"
            disabled={sincronizando || c.situacao === "sincronizando"}
            onClick={aoSincronizar}
          >
            <RefreshCw /> {sincronizando ? "Enviando…" : "Sincronizar agora"}
          </Botao>
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={aoVerHistorico}
            aria-label={`Histórico de ${c.nome}`}
          >
            <History /> Histórico
          </Botao>
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={aoEditar}
            aria-label={`Editar ${c.nome}`}
          >
            <Pencil /> Editar
          </Botao>
        </div>
      </Td>
    </Linha>
  );
}

function HistoricoDialogo({ conector, aoFechar }: { conector: Conector; aoFechar: () => void }) {
  const consulta = useConectoresExecucoes(conector.id);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Histórico de ${conector.nome}`}
      descricao="Cada sincronização, da mais recente para a mais antiga."
      largura="max-w-3xl"
      rodape={
        <Botao variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      {consulta.isPending ? (
        <Carregando linhas={3} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhuma execução">Use “Sincronizar agora” para a primeira.</Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Início</Th>
              <Th>Resultado</Th>
              <Th>Quem</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.map((e) => (
              <Linha key={e.id}>
                <Td className="whitespace-nowrap">{formatarDataHora(e.iniciada_em)}</Td>
                <Td>
                  {e.concluida_em == null ? (
                    <Selo tom="info">Em andamento</Selo>
                  ) : e.sucesso ? (
                    <Selo tom="sucesso">Sucesso</Selo>
                  ) : (
                    <Selo tom="perigo">Falha</Selo>
                  )}
                  <p className="text-xs text-texto-suave">
                    {e.sucesso ? resumoExecucao(e) : e.erro}
                  </p>
                  {e.detalhe && <p className="text-xs text-texto-suave">{e.detalhe}</p>}
                  {e.lote_numero != null && (
                    <p className="text-xs">
                      <Link to="/inventario/importacoes" className="text-marca underline">
                        Prévia do lote {e.lote_numero}
                      </Link>
                    </p>
                  )}
                </Td>
                <Td>{e.usuario_nome ?? "Agendador"}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
    </Dialogo>
  );
}

const VAZIO: ConectorRequest = {
  nome: "",
  tipo: "geojson_url",
  url: "",
  parametros: {},
  destino: "camada_referencia",
  modelo_importacao: null,
  modo: "criar",
  periodicidade: "manual",
  ativo: false,
  orgao: "",
  licenca: "",
  url_origem: "",
  cor: "#b45f06",
  rotulos: {},
};

function ConectorDialogo({
  conector,
  aoFechar,
}: {
  conector: Conector | null;
  aoFechar: () => void;
}) {
  const [dados, setDados] = useState<ConectorRequest>(
    conector
      ? {
          nome: conector.nome,
          tipo: conector.tipo,
          url: conector.url,
          parametros: { ...conector.parametros },
          destino: conector.destino,
          modelo_importacao: conector.modelo_importacao ?? null,
          modo: conector.modo,
          periodicidade: conector.periodicidade,
          ativo: conector.ativo,
          orgao: conector.orgao,
          licenca: conector.licenca,
          url_origem: conector.url_origem,
          cor: conector.cor,
          rotulos: { ...conector.rotulos },
        }
      : VAZIO,
  );
  const [rotulosTexto, setRotulosTexto] = useState(escreverRotulos(dados.rotulos));
  const [teste, setTeste] = useState<ResultadoTeste | null>(null);
  const cliente = useQueryClient();
  const modelos = useModelosImportacaoListar(undefined, {
    query: { enabled: dados.destino === "lote_importacao" },
  });
  const criar = useConectoresCriar<ErroApi>();
  const atualizar = useConectoresAtualizar<ErroApi>();
  const testar = useConectoresTestar<ErroApi>();
  const gravando = criar.isPending || atualizar.isPending;
  const erro = criar.error ?? atualizar.error;
  const erros = erro?.errosDeCampo ?? {};

  const mudar = (parte: Partial<ConectorRequest>) => {
    setDados((d) => ({ ...d, ...parte }));
    setTeste(null);
  };
  const mudarParametro = (nome: string, valor: string) =>
    mudar({ parametros: { ...dados.parametros, [nome]: valor } });

  const salvar = () => {
    const corpo: ConectorRequest = { ...dados, rotulos: lerRotulos(rotulosTexto) };
    const aoGravar = {
      onSuccess: async () => {
        await invalidarCaminhos(cliente, CAMINHO_CONECTORES, "/api/v1/mapa/camadas-referencia");
        aoFechar();
      },
    };
    if (conector) atualizar.mutate({ id: conector.id, data: corpo }, aoGravar);
    else criar.mutate({ data: corpo }, aoGravar);
  };

  const testarConexao = () =>
    testar.mutate(
      { data: { tipo: dados.tipo, url: dados.url, parametros: dados.parametros } },
      { onSuccess: (r) => setTeste(r.data) },
    );

  const campos = PARAMETROS_POR_TIPO[dados.tipo];
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={conector ? `Editar ${conector.nome}` : "Novo conector"}
      descricao="O servidor só busca endereços HTTPS de hosts autorizados na configuração."
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao disabled={gravando} onClick={salvar}>
            {gravando ? "Salvando…" : "Salvar"}
          </Botao>
        </>
      }
    >
      {erro && !Object.keys(erros).length && (
        <p role="alert" className="mb-3 text-sm text-perigo">
          {erro.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Nome" obrigatorio erros={erros.nome}>
          {(p) => (
            <Entrada {...p} value={dados.nome} onChange={(e) => mudar({ nome: e.target.value })} />
          )}
        </Campo>
        <Campo rotulo="Tipo" erros={erros.tipo}>
          {(p) => (
            <Selecao
              {...p}
              value={dados.tipo}
              onChange={(e) =>
                mudar({ tipo: e.target.value as ConectorRequest["tipo"], parametros: {} })
              }
            >
              {Object.entries(ROTULOS_TIPO_CONECTOR).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo
          rotulo="Endereço"
          obrigatorio
          erros={erros.url}
          ajuda="Precisa ser HTTPS e de um host autorizado."
        >
          {(p) => (
            <Entrada
              {...p}
              type="url"
              value={dados.url}
              onChange={(e) => mudar({ url: e.target.value })}
            />
          )}
        </Campo>
        {campos.map((campo) => (
          <Campo
            key={campo.nome}
            rotulo={campo.rotulo}
            ajuda={campo.ajuda}
            obrigatorio={campo.obrigatorio}
            erros={campo.obrigatorio ? erros.parametros : undefined}
          >
            {(p) => (
              <Entrada
                {...p}
                value={dados.parametros?.[campo.nome] ?? ""}
                onChange={(e) => mudarParametro(campo.nome, e.target.value)}
              />
            )}
          </Campo>
        ))}
        <div className="rounded-md border border-borda p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-texto-suave">
              Busca a fonte sem gravar nada e mostra o que chegaria.
            </p>
            <Botao
              variante="secundario"
              disabled={!dados.url || testar.isPending}
              onClick={testarConexao}
            >
              {testar.isPending ? "Testando…" : "Testar conexão"}
            </Botao>
          </div>
          {testar.error && (
            <p role="alert" className="mt-2 text-sm text-perigo">
              {testar.error.message}
            </p>
          )}
          {teste && <ResultadoDoTeste resultado={teste} />}
        </div>
        <Campo rotulo="Destino" erros={erros.destino}>
          {(p) => (
            <Selecao
              {...p}
              value={dados.destino}
              onChange={(e) => mudar({ destino: e.target.value as ConectorRequest["destino"] })}
            >
              {Object.entries(ROTULOS_DESTINO_CONECTOR).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        {dados.destino === "lote_importacao" && (
          <>
            <Campo rotulo="Modelo de importação" obrigatorio erros={erros.modelo_importacao}>
              {(p) => (
                <Selecao
                  {...p}
                  value={dados.modelo_importacao ?? ""}
                  onChange={(e) => mudar({ modelo_importacao: e.target.value || null })}
                >
                  <option value="">Escolha um modelo</option>
                  {modelos.data?.data.results.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome} ({m.fonte})
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
            <Campo
              rotulo="Modo"
              ajuda="A prévia nunca é confirmada sozinha: uma pessoa revisa e confirma."
            >
              {(p) => (
                <Selecao
                  {...p}
                  value={dados.modo ?? "criar"}
                  onChange={(e) => mudar({ modo: e.target.value as ConectorRequest["modo"] })}
                >
                  {Object.entries(ROTULOS_MODO_CONECTOR).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
          </>
        )}
        <Campo rotulo="Periodicidade" erros={erros.periodicidade}>
          {(p) => (
            <Selecao
              {...p}
              value={dados.periodicidade ?? "manual"}
              onChange={(e) =>
                mudar({ periodicidade: e.target.value as ConectorRequest["periodicidade"] })
              }
            >
              {Object.entries(ROTULOS_PERIODICIDADE).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <fieldset className="flex flex-col gap-3 rounded-md border border-borda p-3">
          <legend className="px-1 text-sm font-medium">Atribuição da fonte</legend>
          <Campo rotulo="Órgão" obrigatorio erros={erros.orgao}>
            {(p) => (
              <Entrada
                {...p}
                value={dados.orgao}
                onChange={(e) => mudar({ orgao: e.target.value })}
              />
            )}
          </Campo>
          <Campo
            rotulo="Licença ou termos de uso"
            obrigatorio
            erros={erros.licenca}
            ajuda="Se a fonte não declara, registre isso."
          >
            {(p) => (
              <Entrada
                {...p}
                value={dados.licenca}
                onChange={(e) => mudar({ licenca: e.target.value })}
              />
            )}
          </Campo>
          <Campo rotulo="Página da fonte" obrigatorio erros={erros.url_origem}>
            {(p) => (
              <Entrada
                {...p}
                type="url"
                value={dados.url_origem}
                onChange={(e) => mudar({ url_origem: e.target.value })}
              />
            )}
          </Campo>
        </fieldset>
        {dados.destino === "camada_referencia" && (
          <>
            <Campo rotulo="Cor no mapa" erros={erros.cor}>
              {(p) => (
                <Entrada
                  {...p}
                  type="color"
                  className="h-9 w-20 p-1"
                  value={dados.cor ?? "#b45f06"}
                  onChange={(e) => mudar({ cor: e.target.value })}
                />
              )}
            </Campo>
            <Campo
              rotulo="Rótulos do popup"
              ajuda="Uma por linha, no formato propriedade: Rótulo legível. Com rótulos, só as propriedades listadas aparecem no popup; sem rótulos, todas aparecem."
              erros={erros.rotulos}
            >
              {(p) => (
                <AreaTexto
                  {...p}
                  rows={4}
                  value={rotulosTexto}
                  onChange={(e) => setRotulosTexto(e.target.value)}
                />
              )}
            </Campo>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-marca"
            checked={dados.ativo ?? false}
            onChange={(e) => mudar({ ativo: e.target.checked })}
          />
          Ativo (aparece no mapa e entra na sincronização agendada)
        </label>
      </div>
    </Dialogo>
  );
}

function ResultadoDoTeste({ resultado }: { resultado: ResultadoTeste }) {
  return (
    <div className="mt-3 text-sm" role="status">
      <p className="font-medium">
        {resultado.total === 1 ? "1 feição encontrada" : `${resultado.total} feições encontradas`}
        {resultado.paginas > 1 && ` em ${resultado.paginas} páginas`}
      </p>
      {resultado.colunas.length > 0 && (
        <p className="text-texto-suave">Colunas: {resultado.colunas.join(", ")}</p>
      )}
      {resultado.amostra.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-texto-suave">
          {resultado.amostra.map((linha, i) => (
            <li key={i}>
              {Object.entries(linha)
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(" · ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
