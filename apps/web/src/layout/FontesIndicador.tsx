import { useAlertasIngestoes, useConectoresListar, useMapaCamadas } from "@itree/api-client";
import { Link } from "@tanstack/react-router";

import { usePermissao } from "../acesso/ContextoUsuario";
import { conectoresComProblema, fontesComProblema, fontesPopulacaoComProblema } from "./fontes";

/** Ponto âmbar no cabeçalho, com link para Administração > Integrações, só quando há problema. */
export function FontesIndicador() {
  const pode = usePermissao("alertas.ler");
  const podeConectores = usePermissao("admin.configuracao");
  const consulta = useAlertasIngestoes({ query: { enabled: pode, staleTime: 5 * 60_000 } });
  const conectores = useConectoresListar({
    query: { enabled: podeConectores, staleTime: 5 * 60_000 },
  });
  const podeMapa = usePermissao("mapa.ler");
  const camadas = useMapaCamadas({ query: { enabled: podeMapa, staleTime: 5 * 60_000 } });
  const problemas = [
    ...(pode && consulta.data ? fontesComProblema(consulta.data.data) : []),
    ...(podeConectores && conectores.data ? conectoresComProblema(conectores.data.data) : []),
    ...(podeMapa && camadas.data ? fontesPopulacaoComProblema(camadas.data.data.populacao) : []),
  ];
  if (problemas.length === 0) return null;
  const detalhe = problemas
    .map((p) => `${p.fonte} (${p.motivo === "indisponivel" ? "indisponível" : "desatualizada"})`)
    .join("; ");
  return (
    <Link
      to="/administracao/integracoes"
      title={detalhe}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fundo max-md:size-11 max-md:justify-center max-md:p-0"
    >
      <span className="size-2.5 rounded-full bg-atencao" aria-hidden />
      <span className="max-md:sr-only">
        {problemas.length === 1
          ? "1 fonte externa com problema"
          : `${problemas.length} fontes externas com problema`}
      </span>
      <span className="sr-only">: {detalhe}</span>
    </Link>
  );
}
