import { useQualidadePendencias } from "@itree/api-client";
import { Link } from "@tanstack/react-router";

import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { formatarDataHora } from "../../util/formatos";

interface Pendencia {
  id: string;
  titulo: string;
  criterio: string;
  quantidade: number;
  gravidade: "alta" | "media" | "baixa";
  link: { pagina: string; filtros: Record<string, string> } | null;
  exemplos?: { arvore: string; arvore_id: string; tipo: string; valor: number; unidade: string }[];
}

const TOM = { alta: "perigo", media: "atencao", baixa: "neutro" } as const;

/** Pendências de qualidade por regras explícitas (T-04). Nada é corrigido automaticamente. */
export function QualidadePagina() {
  const consulta = useQualidadePendencias();
  return (
    <>
      <CabecalhoPagina
        titulo="Qualidade de dados"
        descricao={
          consulta.data
            ? `Regras explícitas de verificação; nada é corrigido automaticamente · calculado em ${formatarDataHora(consulta.data.data.calculado_em)}`
            : "Regras explícitas de verificação; nada é corrigido automaticamente."
        }
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {(consulta.data.data.pendencias as unknown as Pendencia[]).map((p) => (
            <li key={p.id} className="rounded-lg border border-borda bg-superficie p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.titulo}</p>
                  <p className="text-xs text-texto-suave">Critério: {p.criterio}</p>
                </div>
                <span
                  className={`text-2xl font-semibold tabular-nums ${p.quantidade ? "" : "text-texto-suave"}`}
                >
                  {p.quantidade.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                {p.quantidade > 0 && (
                  <Selo tom={TOM[p.gravidade]}>
                    Gravidade {p.gravidade === "media" ? "média" : p.gravidade}
                  </Selo>
                )}
                {p.quantidade > 0 && p.link && (
                  <Link
                    to={p.link.pagina}
                    search={p.link.filtros}
                    className="text-sm text-marca-escura hover:underline"
                  >
                    Ver registros
                  </Link>
                )}
              </div>
              {p.exemplos?.length ? (
                <ul className="mt-2 text-xs">
                  {p.exemplos.map((e) => (
                    <li key={`${e.arvore}-${e.tipo}`}>
                      <Link
                        to="/inventario/arvores/$id"
                        params={{ id: e.arvore_id }}
                        className="font-mono text-marca-escura hover:underline"
                      >
                        {e.arvore}
                      </Link>
                      : {e.tipo} = {e.valor.toLocaleString("pt-BR")} {e.unidade}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
