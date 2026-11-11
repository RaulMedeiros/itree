import type { Medida } from "@itree/api-client";
import { ROTULOS_TIPO_MEDIDA } from "@itree/domain";

export interface ComparacaoMedida {
  proposta: Medida;
  /** Valor aplicado hoje no cadastro para o mesmo tipo, se houver. */
  cadastro?: Medida;
  /** Proposta menos cadastro, arredondada em 2 casas; nulo sem valor no cadastro. */
  diferenca: number | null;
}

/**
 * Uma comparação por tipo de medida, na ordem em que a inspeção as traz. Se a inspeção
 * trouxer o mesmo tipo mais de uma vez, vale a primeira (a mais recente): cada medida
 * aparece uma só vez.
 */
export function compararMedidas(
  propostas: readonly Medida[],
  cadastro: readonly Medida[],
): ComparacaoMedida[] {
  const vistos = new Set<string>();
  return propostas
    .filter((p) => !vistos.has(p.tipo) && vistos.add(p.tipo))
    .map((proposta) => {
      const atual = cadastro.find((c) => c.tipo === proposta.tipo);
      return {
        proposta,
        cadastro: atual,
        diferenca: atual
          ? Math.round((Number(proposta.valor) - Number(atual.valor)) * 100) / 100
          : null,
      };
    });
}

const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "DAP 32 → 38 cm, +6": a diferença em relação ao cadastro, no sentido e na unidade certos. */
export function descreverDiferenca({ proposta, cadastro, diferenca }: ComparacaoMedida): string {
  const nome = ROTULOS_TIPO_MEDIDA[proposta.tipo];
  const novo = numero(Number(proposta.valor));
  if (!cadastro || diferenca === null)
    return `${nome} ${novo} ${proposta.unidade}, sem valor no cadastro`;
  if (diferenca === 0) return `${nome} ${novo} ${proposta.unidade}, igual ao cadastro`;
  const sinal = diferenca > 0 ? "+" : "-";
  return `${nome} ${numero(Number(cadastro.valor))} → ${novo} ${proposta.unidade}, ${sinal}${numero(Math.abs(diferenca))}`;
}
