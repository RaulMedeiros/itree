import type { ArvoreResumo } from "@itree/api-client";
import {
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ESTADO_INSPECAO,
  ROTULOS_ESTADO_TAREFA,
  ROTULOS_ESTADO_OCORRENCIA,
  ROTULOS_ORIGEM_LOCALIZACAO,
  ROTULOS_ORIGEM_VALOR,
  ROTULOS_PRIORIDADE,
} from "@itree/domain";

import { Selo } from "../ui/selo";

type Tom = "neutro" | "marca" | "info" | "atencao" | "perigo" | "sucesso";

export function SeloEspecie({ estado }: { estado: keyof typeof ROTULOS_ESTADO_ESPECIE }) {
  const tom: Record<string, Tom> = {
    confirmada: "sucesso",
    sugerida_ia: "info",
    informada: "atencao",
    nao_identificada: "neutro",
  };
  return <Selo tom={tom[estado]}>{ROTULOS_ESTADO_ESPECIE[estado]}</Selo>;
}

export function SeloLocalizacao({
  origem,
  precisao,
}: {
  origem: string;
  precisao?: number | null;
}) {
  if (!origem) return <Selo tom="atencao">Sem localização</Selo>;
  const rotulo =
    ROTULOS_ORIGEM_LOCALIZACAO[origem as keyof typeof ROTULOS_ORIGEM_LOCALIZACAO] ?? origem;
  return (
    <Selo tom={origem === "gps_campo" ? "sucesso" : origem === "importada" ? "info" : "atencao"}>
      {rotulo}
      {precisao ? ` · ±${Math.round(precisao)} m` : ""}
    </Selo>
  );
}

export function SeloOrigemValor({ origem }: { origem: string }) {
  const tom: Record<string, Tom> = {
    medido: "sucesso",
    estimado: "atencao",
    inferido: "info",
    importado: "neutro",
  };
  return (
    <Selo tom={tom[origem]}>
      {ROTULOS_ORIGEM_VALOR[origem as keyof typeof ROTULOS_ORIGEM_VALOR] ?? origem}
    </Selo>
  );
}

export function SeloEstadoOcorrencia({
  estado,
}: {
  estado: keyof typeof ROTULOS_ESTADO_OCORRENCIA;
}) {
  const tom: Record<string, Tom> = {
    aberta: "atencao",
    em_triagem: "info",
    encaminhada: "info",
    em_atendimento: "marca",
    concluida: "sucesso",
    cancelada: "neutro",
  };
  return <Selo tom={tom[estado]}>{ROTULOS_ESTADO_OCORRENCIA[estado]}</Selo>;
}

export function SeloPrioridade({ prioridade }: { prioridade?: string | null }) {
  if (!prioridade) return <Selo>Sem prioridade definida</Selo>;
  const tom: Record<string, Tom> = {
    urgente: "perigo",
    alta: "perigo",
    media: "atencao",
    baixa: "info",
  };
  return (
    <Selo tom={tom[prioridade]}>
      Prioridade {ROTULOS_PRIORIDADE[prioridade as keyof typeof ROTULOS_PRIORIDADE].toLowerCase()}
    </Selo>
  );
}

export function nomeEspecie(a: Pick<ArvoreResumo, "especie" | "especie_texto_original">): string {
  if (a.especie) return a.especie.nome_cientifico;
  if (a.especie_texto_original) return `“${a.especie_texto_original}” (fora do catálogo)`;
  return "Espécie não identificada";
}

export function SeloEstadoInspecao({ estado }: { estado: keyof typeof ROTULOS_ESTADO_INSPECAO }) {
  const tom: Record<string, Tom> = {
    rascunho: "neutro",
    em_revisao: "info",
    devolvida: "atencao",
    validada: "sucesso",
  };
  return <Selo tom={tom[estado]}>{ROTULOS_ESTADO_INSPECAO[estado]}</Selo>;
}

export function SeloEstadoTarefa({ estado }: { estado: keyof typeof ROTULOS_ESTADO_TAREFA }) {
  const tom: Record<string, Tom> = {
    nao_iniciada: "neutro",
    em_execucao: "info",
    concluida: "sucesso",
    bloqueada: "atencao",
    cancelada: "neutro",
  };
  return <Selo tom={tom[estado]}>{ROTULOS_ESTADO_TAREFA[estado]}</Selo>;
}
