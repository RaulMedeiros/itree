import { useImplantacaoPrimeirosPassos, type Passo } from "@itree/api-client";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, Circle } from "lucide-react";

import { usePermissao } from "../../acesso/ContextoUsuario";

/**
 * "Primeiros passos" da implantação (G-03): o checklist é calculado no servidor e só
 * aparece para quem administra o sistema, enquanto faltar algum passo.
 */
export function PrimeirosPassos() {
  const pode = usePermissao("admin.configuracao");
  const consulta = useImplantacaoPrimeirosPassos({ query: { enabled: pode, retry: false } });
  if (!pode || !consulta.data) return null;
  const { completo, passos } = consulta.data.data;
  if (completo) return null;
  const feitos = passos.filter((p) => p.concluido).length;
  return (
    <section
      aria-labelledby="titulo-primeiros-passos"
      className="mb-4 rounded-xl border border-marca bg-marca-clara p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-primeiros-passos" className="text-base font-semibold">
          Primeiros passos
        </h2>
        <p className="text-sm text-texto-suave">
          {feitos} de {passos.length} concluídos
        </p>
      </div>
      <p className="mt-0.5 text-sm text-texto-suave">
        O sistema ainda não está configurado. Este quadro some quando todos os passos estiverem
        feitos.
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {passos.map((p) => (
          <Item key={p.id} passo={p} />
        ))}
      </ol>
    </section>
  );
}

function Item({ passo }: { passo: Passo }) {
  const Icone = passo.concluido ? CircleCheck : Circle;
  return (
    <li className="flex items-start gap-3 rounded-lg bg-superficie px-3 py-2.5">
      <Icone
        className={
          passo.concluido ? "mt-0.5 size-5 text-sucesso" : "mt-0.5 size-5 text-texto-suave"
        }
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {passo.titulo}
          <span className="sr-only">{passo.concluido ? " (concluído)" : " (pendente)"}</span>
        </p>
        <p className="text-sm text-texto-suave">{passo.descricao}</p>
        <p className="text-xs text-texto-suave">{passo.detalhe}</p>
      </div>
      {/* Os caminhos vêm do servidor como texto; o roteador valida só caminhos conhecidos. */}
      <Link
        to={passo.link as never}
        className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-marca-escura hover:underline"
      >
        {passo.concluido ? "Ver" : "Fazer agora"}
        <ChevronRight className="size-4" aria-hidden />
        <span className="sr-only"> {passo.titulo}</span>
      </Link>
    </li>
  );
}
