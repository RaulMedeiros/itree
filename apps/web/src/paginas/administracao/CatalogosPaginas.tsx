import {
  ErroApi,
  getEspeciesListarQueryKey,
  getTiposOcorrenciaListarQueryKey,
  useEspeciesAtualizar,
  useEspeciesAtualizarReferencias,
  useEspeciesCriar,
  useEspeciesListar,
  useTiposOcorrenciaAtualizar,
  useTiposOcorrenciaCriar,
  useTiposOcorrenciaListar,
  type Especie,
  type TipoOcorrencia,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";

export function EspeciesPagina() {
  const [busca, setBusca] = useState("");
  const consulta = useEspeciesListar({ busca: busca || undefined, tamanho: 500 });
  const [editando, setEditando] = useState<Especie | "nova" | null>(null);
  return (
    <>
      <CabecalhoPagina
        titulo="Catálogo de espécies"
        descricao="A taxonomia oficial ainda é decisão pendente (DP-02). Espécies não são excluídas: ficam inativas, com indicação do nome aceito."
        acoes={
          <Botao onClick={() => setEditando("nova")}>
            <Plus /> Nova espécie
          </Botao>
        }
      />
      <Entrada
        type="search"
        aria-label="Buscar espécie"
        placeholder="Nome científico, comum ou família"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="mb-3 max-w-80"
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhuma espécie no catálogo" />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome científico</Th>
              <Th>Nomes comuns</Th>
              <Th>Família</Th>
              <Th>Origem</Th>
              <Th>Situação</Th>
              <Th>Referências externas</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.results.map((e) => (
              <Linha key={e.id} className="hover:bg-fundo">
                <Td>
                  <button
                    className="text-left font-medium text-marca-escura italic hover:underline"
                    onClick={() => setEditando(e)}
                  >
                    {e.nome_cientifico}
                  </button>
                  {e.fonte_taxonomica && (
                    <p className="text-xs text-texto-suave">{e.fonte_taxonomica}</p>
                  )}
                </Td>
                <Td>{e.nomes_comuns?.join(", ") || "—"}</Td>
                <Td>{e.familia || "—"}</Td>
                <Td>
                  {e.nativa_brasil === true
                    ? "Nativa do Brasil"
                    : e.nativa_brasil === false
                      ? "Exótica"
                      : "Não informada"}
                </Td>
                <Td>{e.ativa ? <Selo tom="sucesso">Ativa</Selo> : <Selo>Inativa</Selo>}</Td>
                <Td>
                  <ReferenciasEspecie especie={e} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {editando && (
        <EspecieDialogo
          especie={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  );
}

function EspecieDialogo({ especie, aoFechar }: { especie: Especie | null; aoFechar: () => void }) {
  const [nome, setNome] = useState(especie?.nome_cientifico ?? "");
  const [comuns, setComuns] = useState(especie?.nomes_comuns?.join(", ") ?? "");
  const [familia, setFamilia] = useState(especie?.familia ?? "");
  const [nativa, setNativa] = useState(
    especie?.nativa_brasil === null || especie?.nativa_brasil === undefined
      ? ""
      : String(especie.nativa_brasil),
  );
  const [fonte, setFonte] = useState(especie?.fonte_taxonomica ?? "");
  const [ativa, setAtiva] = useState(especie?.ativa ?? true);
  const criar = useEspeciesCriar<ErroApi>();
  const atualizar = useEspeciesAtualizar<ErroApi>();
  const mutacao = especie ? atualizar : criar;
  const erros = mutacao.error?.errosDeCampo ?? {};
  const cliente = useQueryClient();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const dados = {
      nome_cientifico: nome.trim(),
      nomes_comuns: comuns
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      familia,
      nativa_brasil: nativa === "" ? null : nativa === "true",
      fonte_taxonomica: fonte,
      ativa,
    };
    try {
      if (especie) await atualizar.mutateAsync({ id: especie.id, data: dados });
      else await criar.mutateAsync({ data: dados });
      await cliente.invalidateQueries({ queryKey: getEspeciesListarQueryKey().slice(0, 1) });
      aoFechar();
    } catch {
      /* exibido no formulário */
    }
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={especie ? `Editar ${especie.nome_cientifico}` : "Nova espécie"}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-especie" disabled={!nome.trim() || mutacao.isPending}>
            Salvar
          </Botao>
        </>
      }
    >
      <form id="form-especie" onSubmit={enviar} className="flex flex-col gap-3">
        <Campo rotulo="Nome científico" obrigatorio erros={erros.nome_cientifico}>
          {(p) => <Entrada {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Campo>
        <Campo rotulo="Nomes comuns" ajuda="Separados por vírgula." erros={erros.nomes_comuns}>
          {(p) => <Entrada {...p} value={comuns} onChange={(e) => setComuns(e.target.value)} />}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Família">
            {(p) => <Entrada {...p} value={familia} onChange={(e) => setFamilia(e.target.value)} />}
          </Campo>
          <Campo rotulo="Origem">
            {(p) => (
              <Selecao {...p} value={nativa} onChange={(e) => setNativa(e.target.value)}>
                <option value="">Não informada</option>
                <option value="true">Nativa do Brasil</option>
                <option value="false">Exótica</option>
              </Selecao>
            )}
          </Campo>
        </div>
        <Campo rotulo="Fonte taxonômica" ajuda="Ex.: Flora e Funga do Brasil.">
          {(p) => <Entrada {...p} value={fonte} onChange={(e) => setFonte(e.target.value)} />}
        </Campo>
        {especie && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-marca"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
            />{" "}
            Ativa
          </label>
        )}
      </form>
    </Dialogo>
  );
}

export function TiposOcorrenciaPagina() {
  const consulta = useTiposOcorrenciaListar();
  const [editando, setEditando] = useState<TipoOcorrencia | "novo" | null>(null);
  return (
    <>
      <CabecalhoPagina
        titulo="Tipos de ocorrência"
        descricao="A lista oficial e os prazos ainda são decisão pendente (DP-17). Tipos não são excluídos: ficam inativos."
        acoes={
          <Botao onClick={() => setEditando("novo")}>
            <Plus /> Novo tipo
          </Botao>
        }
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio
          titulo="Nenhum tipo cadastrado"
          acao={<Botao onClick={() => setEditando("novo")}>Novo tipo</Botao>}
        >
          Cadastre os tipos antes de registrar ocorrências.
        </Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Tipo</Th>
              <Th>Prazo padrão</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.map((t) => (
              <Linha key={t.id}>
                <Td>
                  <button
                    className="text-left font-medium text-marca-escura hover:underline"
                    onClick={() => setEditando(t)}
                  >
                    {t.nome}
                  </button>
                  {t.descricao && <p className="text-xs text-texto-suave">{t.descricao}</p>}
                </Td>
                <Td>{t.prazo_padrao_dias ? `${t.prazo_padrao_dias} dias` : "Sem prazo padrão"}</Td>
                <Td>{t.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {editando && (
        <TipoDialogo
          tipo={editando === "novo" ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  );
}

function TipoDialogo({ tipo, aoFechar }: { tipo: TipoOcorrencia | null; aoFechar: () => void }) {
  const [nome, setNome] = useState(tipo?.nome ?? "");
  const [descricao, setDescricao] = useState(tipo?.descricao ?? "");
  const [prazo, setPrazo] = useState(tipo?.prazo_padrao_dias ? String(tipo.prazo_padrao_dias) : "");
  const [ativo, setAtivo] = useState(tipo?.ativo ?? true);
  const criar = useTiposOcorrenciaCriar<ErroApi>();
  const atualizar = useTiposOcorrenciaAtualizar<ErroApi>();
  const mutacao = tipo ? atualizar : criar;
  const erros = mutacao.error?.errosDeCampo ?? {};
  const cliente = useQueryClient();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const dados = {
      nome: nome.trim(),
      descricao,
      prazo_padrao_dias: prazo ? Number(prazo) : null,
      ativo,
    };
    try {
      if (tipo) await atualizar.mutateAsync({ id: tipo.id, data: dados });
      else await criar.mutateAsync({ data: dados });
      await cliente.invalidateQueries({ queryKey: getTiposOcorrenciaListarQueryKey().slice(0, 1) });
      aoFechar();
    } catch {
      /* exibido no formulário */
    }
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={tipo ? `Editar ${tipo.nome}` : "Novo tipo de ocorrência"}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-tipo" disabled={!nome.trim() || mutacao.isPending}>
            Salvar
          </Botao>
        </>
      }
    >
      <form id="form-tipo" onSubmit={enviar} className="flex flex-col gap-3">
        <Campo rotulo="Nome" obrigatorio erros={erros.nome}>
          {(p) => <Entrada {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Campo>
        <Campo rotulo="Descrição">
          {(p) => (
            <AreaTexto {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          )}
        </Campo>
        <Campo rotulo="Prazo padrão (dias)" erros={erros.prazo_padrao_dias}>
          {(p) => (
            <Entrada
              {...p}
              type="number"
              min={1}
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
            />
          )}
        </Campo>
        {tipo && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-marca"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />{" "}
            Ativo
          </label>
        )}
      </form>
    </Dialogo>
  );
}

const TONS_REFERENCIA = {
  encontradas: ["sucesso", "Encontradas"],
  nao_encontradas: ["atencao", "Não encontradas"],
  erro: ["perigo", "Erro"],
  nao_consultada: ["neutro", "Não consultadas"],
} as const;

/** Situação das referências (Wikidata/Wikipedia/Commons) e consulta sob demanda. */
function ReferenciasEspecie({ especie }: { especie: Especie }) {
  const cliente = useQueryClient();
  const atualizar = useEspeciesAtualizarReferencias({
    mutation: {
      onSuccess: () => cliente.invalidateQueries({ queryKey: getEspeciesListarQueryKey() }),
    },
  });
  const [tom, rotulo] = TONS_REFERENCIA[especie.referencias_situacao ?? "nao_consultada"];
  return (
    <div className="flex items-center gap-2">
      <span title={especie.referencias_mensagem || undefined}>
        <Selo tom={tom}>{rotulo}</Selo>
      </span>
      <Botao
        variante="fantasma"
        tamanho="pequeno"
        disabled={atualizar.isPending}
        aria-label={`Atualizar referências de ${especie.nome_cientifico}`}
        onClick={() => atualizar.mutate({ id: especie.id })}
      >
        <RefreshCw className={atualizar.isPending ? "animate-spin" : ""} />
      </Botao>
    </div>
  );
}
