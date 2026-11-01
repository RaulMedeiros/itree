import { ErroApi, useOcorrenciasCriar, useTiposOcorrenciaListar } from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { SeletorLocalizacao, type Ponto } from "../../componentes/SeletorLocalizacao";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { invalidarCaminhos } from "../../util/cache";

/** Registro de ocorrência (W-04). Se vier de uma árvore, herda a localização dela. */
export function NovaOcorrenciaDialogo({
  arvore,
  pontoInicial,
  aoFechar,
}: {
  arvore?: { id: string; codigo: string };
  pontoInicial?: Ponto;
  aoFechar: () => void;
}) {
  const tipos = useTiposOcorrenciaListar({ ativo: true });
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [condicao, setCondicao] = useState("");
  const [endereco, setEndereco] = useState("");
  const [ponto, setPonto] = useState<Ponto | null>(pontoInicial ?? null);
  const criar = useOcorrenciasCriar<ErroApi>();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const erros = criar.error?.errosDeCampo ?? {};

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate(
      {
        data: {
          tipo_id: tipo,
          descricao,
          condicao_aparente: condicao,
          endereco,
          arvore_id: arvore?.id ?? null,
          localizacao: arvore ? null : ponto,
        },
      },
      {
        onSuccess: async (r) => {
          await invalidarCaminhos(cliente, "/api/v1/ocorrencias", "/api/v1/arvores");
          aoFechar();
          void navegar({ to: "/ocorrencias/$id", params: { id: r.data.id } });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={arvore ? `Registrar ocorrência em ${arvore.codigo}` : "Registrar ocorrência"}
      descricao="Descreva o que foi observado. Prioridade e risco são definidos depois, por quem tem essa atribuição."
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            type="submit"
            form="form-ocorrencia"
            disabled={!tipo || !descricao.trim() || (!arvore && !ponto) || criar.isPending}
          >
            {criar.isPending ? "Registrando…" : "Registrar"}
          </Botao>
        </>
      }
    >
      <form id="form-ocorrencia" onSubmit={enviar} className="flex flex-col gap-4">
        {criar.error && (
          <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {Object.values(erros).flat()[0] ?? criar.error.message}
          </p>
        )}
        <Campo rotulo="Tipo" obrigatorio erros={erros.tipo_id}>
          {(p) => (
            <Selecao {...p} value={tipo} onChange={(e) => setTipo(e.target.value)} required>
              <option value="">Selecione</option>
              {tipos.data?.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.prazo_padrao_dias ? ` (prazo ${t.prazo_padrao_dias} dias)` : ""}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Descrição" obrigatorio erros={erros.descricao}>
          {(p) => (
            <AreaTexto
              {...p}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
            />
          )}
        </Campo>
        <Campo
          rotulo="Condição aparente"
          ajuda="O que foi observado, sem diagnóstico. Ex.: “galho aparentemente quebrado sobre a calçada”."
          erros={erros.condicao_aparente}
        >
          {(p) => (
            <AreaTexto {...p} value={condicao} onChange={(e) => setCondicao(e.target.value)} />
          )}
        </Campo>
        <Campo rotulo="Endereço / referência" erros={erros.endereco}>
          {(p) => <Entrada {...p} value={endereco} onChange={(e) => setEndereco(e.target.value)} />}
        </Campo>
        {!arvore && (
          <SeletorLocalizacao valor={ponto} aoMudar={setPonto} erros={erros.localizacao} />
        )}
      </form>
    </Dialogo>
  );
}
