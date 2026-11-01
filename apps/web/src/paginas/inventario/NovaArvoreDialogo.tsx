import {
  ErroApi,
  getArvoresListarQueryKey,
  useArvoresCriar,
  useEspeciesListar,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { SeletorLocalizacao, type Ponto } from "../../componentes/SeletorLocalizacao";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";

export function NovaArvoreDialogo({ aoFechar }: { aoFechar: () => void }) {
  const [ponto, setPonto] = useState<Ponto | null>(null);
  const [especie, setEspecie] = useState("");
  const [endereco, setEndereco] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const especies = useEspeciesListar({ tamanho: 500, ativa: true });
  const criar = useArvoresCriar<ErroApi>();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const erros = criar.error?.errosDeCampo ?? {};

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate(
      {
        data: {
          localizacao: ponto,
          especie_id: especie || null,
          especie_estado: especie ? "informada" : "nao_identificada",
          endereco,
          observacoes,
        },
      },
      {
        onSuccess: async (r) => {
          await cliente.invalidateQueries({ queryKey: getArvoresListarQueryKey().slice(0, 1) });
          aoFechar();
          void navegar({ to: "/inventario/arvores/$id", params: { id: r.data.id } });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Nova árvore"
      descricao="Cadastro feito no painel. Espécie informada aqui fica como “não validada” até a revisão."
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-nova-arvore" disabled={!ponto || criar.isPending}>
            {criar.isPending ? "Salvando…" : "Cadastrar"}
          </Botao>
        </>
      }
    >
      <form id="form-nova-arvore" onSubmit={enviar} className="flex flex-col gap-4">
        {criar.error && Object.keys(erros).length === 0 && (
          <p role="alert" className="rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {criar.error.message}
          </p>
        )}
        <SeletorLocalizacao valor={ponto} aoMudar={setPonto} erros={erros.localizacao} />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Espécie (informada)" erros={erros.especie_id}>
            {(p) => (
              <Selecao {...p} value={especie} onChange={(e) => setEspecie(e.target.value)}>
                <option value="">Não identificada</option>
                {especies.data?.data.results.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome_cientifico}
                    {e.nomes_comuns?.length ? ` (${e.nomes_comuns[0]})` : ""}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
          <Campo rotulo="Endereço" erros={erros.endereco}>
            {(p) => (
              <Entrada {...p} value={endereco} onChange={(e) => setEndereco(e.target.value)} />
            )}
          </Campo>
        </div>
        <Campo rotulo="Observações" erros={erros.observacoes}>
          {(p) => (
            <AreaTexto
              {...p}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          )}
        </Campo>
      </form>
    </Dialogo>
  );
}
