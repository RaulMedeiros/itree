import { useAlertasIngestoes } from "@itree/api-client";
import { Link } from "@tanstack/react-router";

import { usePermissao } from "../acesso/ContextoUsuario";
import { fontesComProblema } from "./fontes";

/** Ponto âmbar no cabeçalho, com link para Administração > Integrações, só quando há problema. */
export function FontesIndicador() {
  const pode = usePermissao("alertas.ler");
  const consulta = useAlertasIngestoes({ query: { enabled: pode, staleTime: 5 * 60_000 } });
  if (!pode || !consulta.data) return null;
  const problemas = fontesComProblema(consulta.data.data);
  if (problemas.length === 0) return null;
  const detalhe = problemas
    .map((p) => `${p.fonte} (${p.motivo === "indisponivel" ? "indisponível" : "desatualizada"})`)
    .join("; ");
  return (
    <Link
      to="/administracao/integracoes"
      title={detalhe}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fundo"
    >
      <span className="size-2.5 rounded-full bg-atencao" aria-hidden />
      <span>
        {problemas.length === 1
          ? "1 fonte externa com problema"
          : `${problemas.length} fontes externas com problema`}
      </span>
      <span className="sr-only">: {detalhe}</span>
    </Link>
  );
}
