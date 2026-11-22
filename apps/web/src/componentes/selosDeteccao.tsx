import {
  ROTULOS_FAIXA_CONFIANCA,
  ROTULOS_SENSOR_DETECCAO,
  type FaixaConfianca,
  type SensorDeteccao,
} from "@itree/domain";

import { Selo } from "../ui/selo";

type Tamanho = "sm" | "md";

/** Tom de cada faixa: o texto sempre acompanha a cor (RNF-A11Y-002). */
const TOM_CONFIANCA = { baixa: "perigo", media: "atencao", alta: "sucesso" } as const;

/** "Via satélite" ou "Via vídeo de rua": de onde veio a detecção que originou o registro. */
export function SeloOrigemDeteccao({
  sensor,
  tamanho,
}: {
  sensor: string | null | undefined;
  tamanho?: Tamanho;
}) {
  const rotulo = ROTULOS_SENSOR_DETECCAO[sensor as SensorDeteccao];
  if (!rotulo) return null;
  return (
    <Selo
      tom="info"
      tamanho={tamanho}
      title="A árvore entrou no inventário por detecção automática em imagem"
    >
      {rotulo}
    </Selo>
  );
}

/**
 * Faixa de confiança da detecção (baixa, média ou alta). Sem percentual de propósito: as faixas
 * vêm dos limiares configurados e não foram calibradas (DP-13).
 */
export function SeloConfianca({
  faixa,
  tamanho,
}: {
  faixa: string | null | undefined;
  tamanho?: Tamanho;
}) {
  const rotulo = ROTULOS_FAIXA_CONFIANCA[faixa as FaixaConfianca];
  if (!rotulo) return null;
  return (
    <Selo
      tom={TOM_CONFIANCA[faixa as FaixaConfianca]}
      tamanho={tamanho}
      title="Confiança do modelo de detecção, em três faixas. Não é medida de saúde da árvore."
    >
      {rotulo}
    </Selo>
  );
}

/** Estado de revisão: só aparece para árvore que veio de detecção. */
export function SeloConfirmacao({
  confirmada,
  tamanho,
}: {
  confirmada: boolean;
  tamanho?: Tamanho;
}) {
  return confirmada ? (
    <Selo tom="sucesso" tamanho={tamanho}>
      Confirmada
    </Selo>
  ) : (
    <Selo
      tom="atencao"
      tamanho={tamanho}
      title="Detectada automaticamente e ainda sem inspeção validada nem revisão humana"
    >
      Não confirmada
    </Selo>
  );
}

interface ArvoreComSelos {
  deteccao?: string | null;
  confirmada?: boolean;
  faixa_confianca?: string | null;
}

/**
 * Os selos de uma árvore, na ordem: origem ("via ..."), estado de revisão e, enquanto não
 * confirmada, a confiança. Árvore que não veio de detecção não mostra nenhum.
 */
export function SelosDeteccao({ arvore, tamanho }: { arvore: ArvoreComSelos; tamanho?: Tamanho }) {
  if (!arvore.deteccao) return null;
  const confirmada = arvore.confirmada !== false;
  return (
    <>
      <SeloOrigemDeteccao sensor={arvore.deteccao} tamanho={tamanho} />
      <SeloConfirmacao confirmada={confirmada} tamanho={tamanho} />
      {!confirmada && <SeloConfianca faixa={arvore.faixa_confianca} tamanho={tamanho} />}
    </>
  );
}
