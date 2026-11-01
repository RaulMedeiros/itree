import {
  ErroApi,
  useArvoresDuplicidades,
  useArvoresFundir,
  useArvoresNaoDuplicadas,
  type ArvoreResumo,
  type ParDuplicidade,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { SeloEspecie, SeloLocalizacao, nomeEspecie } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { formatarDataHora } from "../../util/formatos";
import { invalidarCaminhos } from "../../util/cache";

function Ficha({ a }: { a: ArvoreResumo }) {
  return (
    <div className="flex-1 rounded-md border border-borda p-3">
      <Link
        to="/inventario/arvores/$id"
        params={{ id: a.id }}
        className="font-mono font-medium text-marca-escura hover:underline"
      >
        {a.codigo}
      </Link>
      <p className={a.especie ? "italic" : "text-texto-suave"}>{nomeEspecie(a)}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <SeloEspecie estado={a.especie_estado ?? "nao_identificada"} />
        <SeloLocalizacao origem={a.localizacao_origem ?? ""} precisao={a.precisao_m} />
      </div>
      <p className="mt-1 text-xs text-texto-suave">
        {a.endereco || "Sem endereço"} · cadastrada em {formatarDataHora(a.criado_em)}
      </p>
    </div>
  );
}

/** Pares suspeitos para revisão humana. Nunca há fusão automática (RN-INV-004). */
export function DuplicidadesPagina() {
  const consulta = useArvoresDuplicidades();
  const podeDecidir = usePermissao("inventario.fundir_excluir");
  const naoDuplicadas = useArvoresNaoDuplicadas<ErroApi>();
  const cliente = useQueryClient();
  const [fundindo, setFundindo] = useState<ParDuplicidade | null>(null);
  const atualizar = () => invalidarCaminhos(cliente, "/api/v1/arvores");

  return (
    <>
      <CabecalhoPagina
        titulo="Possíveis duplicidades"
        descricao="Árvores ativas a até 3 m uma da outra, com espécies compatíveis. Cada par precisa de decisão humana."
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhum par suspeito no seu escopo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {consulta.data.data.map((par) => (
            <li
              key={`${par.arvore_a.id}-${par.arvore_b.id}`}
              className="rounded-lg border border-borda bg-superficie p-4"
            >
              <p className="mb-2 text-sm text-texto-suave">Critério: {par.criterio}</p>
              <div className="flex flex-col gap-3 md:flex-row">
                <Ficha a={par.arvore_a} />
                <Ficha a={par.arvore_b} />
              </div>
              {podeDecidir && (
                <div className="mt-3 flex gap-2">
                  <Botao
                    tamanho="pequeno"
                    variante="secundario"
                    disabled={naoDuplicadas.isPending}
                    onClick={() =>
                      naoDuplicadas.mutate(
                        { data: { arvore_a: par.arvore_a.id, arvore_b: par.arvore_b.id } },
                        { onSuccess: () => void atualizar() },
                      )
                    }
                  >
                    Não são a mesma árvore
                  </Botao>
                  <Botao tamanho="pequeno" onClick={() => setFundindo(par)}>
                    Fundir registros…
                  </Botao>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {fundindo && <FusaoDialogo par={fundindo} aoFechar={() => setFundindo(null)} />}
    </>
  );
}

const CAMPOS = [
  { id: "especie", rotulo: "Espécie", valor: (a: ArvoreResumo) => nomeEspecie(a) },
  {
    id: "geom",
    rotulo: "Localização",
    valor: (a: ArvoreResumo) =>
      a.localizacao
        ? `${a.localizacao.latitude.toFixed(6)}, ${a.localizacao.longitude.toFixed(6)} (${a.localizacao_origem})`
        : "—",
  },
  { id: "endereco", rotulo: "Endereço", valor: (a: ArvoreResumo) => a.endereco || "—" },
];

function FusaoDialogo({ par, aoFechar }: { par: ParDuplicidade; aoFechar: () => void }) {
  const [manter, setManter] = useState<"a" | "b">("a");
  const [daOutra, setDaOutra] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");
  const fundir = useArvoresFundir<ErroApi>();
  const cliente = useQueryClient();
  const principal = manter === "a" ? par.arvore_a : par.arvore_b;
  const outra = manter === "a" ? par.arvore_b : par.arvore_a;

  const campos = (id: string) =>
    id === "especie"
      ? ["especie", "especie_estado", "especie_texto_original"]
      : id === "geom"
        ? ["geom", "localizacao_origem", "precisao_m"]
        : [id];

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Fundir registros"
      descricao="O registro descartado continua existindo, marcado como fundido e apontando para o resultante. Medidas, identificadores, evidências e ocorrências são transferidos."
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!motivo.trim() || fundir.isPending}
            onClick={() =>
              fundir.mutate(
                {
                  id: principal.id,
                  data: {
                    descartar: outra.id,
                    campos_da_outra: daOutra.flatMap(campos),
                    motivo: motivo.trim(),
                  },
                },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/arvores"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Fundir em {principal.codigo}
          </Botao>
        </>
      }
    >
      {fundir.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(fundir.error.errosDeCampo).flat()[0] ?? fundir.error.message}
        </p>
      )}
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium">Registro que permanece</legend>
        {(["a", "b"] as const).map((k) => (
          <label key={k} className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="manter"
              className="accent-marca"
              checked={manter === k}
              onChange={() => (setManter(k), setDaOutra([]))}
            />
            {(k === "a" ? par.arvore_a : par.arvore_b).codigo}
          </label>
        ))}
      </fieldset>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-texto-suave">
            <th className="pb-1">Campo</th>
            <th className="pb-1">{principal.codigo} (mantém)</th>
            <th className="pb-1">Usar de {outra.codigo}</th>
          </tr>
        </thead>
        <tbody>
          {CAMPOS.map((c) => (
            <tr key={c.id} className="border-t border-borda">
              <td className="py-1.5 pr-3 font-medium">{c.rotulo}</td>
              <td className="py-1.5 pr-3">{c.valor(principal)}</td>
              <td className="py-1.5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-marca"
                    checked={daOutra.includes(c.id)}
                    onChange={(e) =>
                      setDaOutra(
                        e.target.checked ? [...daOutra, c.id] : daOutra.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.valor(outra)}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Campo rotulo="Justificativa" obrigatorio>
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}
