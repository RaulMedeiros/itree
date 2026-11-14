import type { ArvoreResumo } from "@itree/api-client";
import {
  ROTULOS_STATUS_ALERTA,
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ESTADO_INSPECAO,
  ROTULOS_ESTADO_TAREFA,
  ROTULOS_ESTADO_OCORRENCIA,
  ROTULOS_ORIGEM_LOCALIZACAO,
  ROTULOS_ORIGEM_VALOR,
  ROTULOS_PRIORIDADE,
} from "@itree/domain";

import { Selo } from "../ui/selo";

type Tom = "neutro" | "marca" | "info" | "alerta" | "atencao" | "perigo" | "sucesso";
type Tamanho = "sm" | "md";

/**
 * Tom de cada selo por domínio, num só lugar (R3-05): a mesma cor sempre
 * significa a mesma coisa. Âmbar é "requer ação"; violeta é alerta ambiental,
 * como o losango do mapa; azul é informativo.
 */
export const TONS = {
  // Origem de localização e de valor: "importado" é azul nos dois.
  origemLocalizacao: { gps_campo: "sucesso", importada: "info", estimada: "atencao" },
  origemValor: { medido: "sucesso", estimado: "atencao", inferido: "info", importado: "info" },
  especie: {
    confirmada: "sucesso",
    sugerida_ia: "info",
    // Âmbar é só para "requer ação"; "não validada" é um estado informativo.
    informada: "neutro",
    nao_identificada: "neutro",
  },
  ocorrencia: {
    aberta: "atencao",
    em_triagem: "info",
    encaminhada: "info",
    em_atendimento: "marca",
    concluida: "sucesso",
    cancelada: "neutro",
  },
  prioridade: { urgente: "perigo", alta: "perigo", media: "atencao", baixa: "info" },
  inspecao: { rascunho: "neutro", em_revisao: "info", devolvida: "atencao", validada: "sucesso" },
  tarefa: {
    nao_iniciada: "neutro",
    em_execucao: "info",
    concluida: "sucesso",
    bloqueada: "atencao",
    cancelada: "neutro",
  },
  alerta: {
    detectado: "alerta",
    em_triagem: "info",
    requer_verificacao: "atencao",
    compativel_autorizacao: "info",
    encaminhado: "marca",
    confirmado: "perigo",
    descartado: "neutro",
  },
} as const satisfies Record<string, Record<string, Tom>>;

/** Imagem sintética de demonstração: nunca deve ser lida como foto real da árvore. */
export function SeloIlustracao({ className }: { className?: string }) {
  return (
    <Selo
      tom="info"
      className={className}
      title="Imagem sintética de demonstração, não é uma fotografia real"
    >
      Ilustração
    </Selo>
  );
}

export function SeloEspecie({
  estado,
  tamanho,
}: {
  estado: keyof typeof ROTULOS_ESTADO_ESPECIE;
  tamanho?: Tamanho;
}) {
  return (
    <Selo tom={TONS.especie[estado]} tamanho={tamanho}>
      {ROTULOS_ESTADO_ESPECIE[estado]}
    </Selo>
  );
}

export function SeloLocalizacao({
  origem,
  precisao,
  tamanho,
}: {
  origem: string;
  precisao?: number | null;
  tamanho?: Tamanho;
}) {
  if (!origem)
    return (
      <Selo tom="atencao" tamanho={tamanho}>
        Sem localização
      </Selo>
    );
  const rotulo =
    ROTULOS_ORIGEM_LOCALIZACAO[origem as keyof typeof ROTULOS_ORIGEM_LOCALIZACAO] ?? origem;
  return (
    <Selo
      tamanho={tamanho}
      tom={(TONS.origemLocalizacao as Record<string, Tom>)[origem] ?? "atencao"}
    >
      {rotulo}
      {precisao ? ` · ±${Math.round(precisao)} m` : ""}
    </Selo>
  );
}

export function SeloOrigemValor({ origem, tamanho }: { origem: string; tamanho?: Tamanho }) {
  return (
    <Selo tom={(TONS.origemValor as Record<string, Tom>)[origem]} tamanho={tamanho}>
      {ROTULOS_ORIGEM_VALOR[origem as keyof typeof ROTULOS_ORIGEM_VALOR] ?? origem}
    </Selo>
  );
}

export function SeloEstadoOcorrencia({
  estado,
  className,
  tamanho,
}: {
  estado: keyof typeof ROTULOS_ESTADO_OCORRENCIA;
  className?: string;
  tamanho?: Tamanho;
}) {
  return (
    <Selo tom={TONS.ocorrencia[estado]} className={className} tamanho={tamanho}>
      {ROTULOS_ESTADO_OCORRENCIA[estado]}
    </Selo>
  );
}

export function SeloPrioridade({
  prioridade,
  className,
  tamanho,
}: {
  prioridade?: string | null;
  className?: string;
  tamanho?: Tamanho;
}) {
  if (!prioridade)
    return (
      <Selo className={className} tamanho={tamanho}>
        Sem prioridade definida
      </Selo>
    );
  return (
    <Selo
      tom={(TONS.prioridade as Record<string, Tom>)[prioridade]}
      className={className}
      tamanho={tamanho}
    >
      Prioridade {ROTULOS_PRIORIDADE[prioridade as keyof typeof ROTULOS_PRIORIDADE].toLowerCase()}
    </Selo>
  );
}

export function nomeEspecie(a: Pick<ArvoreResumo, "especie" | "especie_texto_original">): string {
  if (a.especie) return a.especie.nome_cientifico;
  if (a.especie_texto_original) return `“${a.especie_texto_original}” (fora do catálogo)`;
  return "Espécie não identificada";
}

export function SeloEstadoInspecao({
  estado,
  tamanho,
}: {
  estado: keyof typeof ROTULOS_ESTADO_INSPECAO;
  tamanho?: Tamanho;
}) {
  return (
    <Selo tom={TONS.inspecao[estado]} tamanho={tamanho}>
      {ROTULOS_ESTADO_INSPECAO[estado]}
    </Selo>
  );
}

export function SeloEstadoTarefa({
  estado,
  tamanho,
}: {
  estado: keyof typeof ROTULOS_ESTADO_TAREFA;
  tamanho?: Tamanho;
}) {
  return (
    <Selo tom={TONS.tarefa[estado]} tamanho={tamanho}>
      {ROTULOS_ESTADO_TAREFA[estado]}
    </Selo>
  );
}

export function SeloStatusAlerta({
  status,
  tamanho,
}: {
  status: keyof typeof ROTULOS_STATUS_ALERTA;
  tamanho?: Tamanho;
}) {
  return (
    <Selo tom={TONS.alerta[status]} tamanho={tamanho}>
      {ROTULOS_STATUS_ALERTA[status]}
    </Selo>
  );
}
