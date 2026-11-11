/**
 * Visibilidade dos nomes de bairro (C-08): um nome só aparece se couber dentro do
 * polígono na tela e não colidir com outro já exibido. Em caso de disputa, vale o
 * bairro de maior largura na tela.
 */
export interface RotuloMedido {
  id: string;
  /** Centro do rótulo na tela (px). */
  x: number;
  y: number;
  /** Tamanho do texto (px). */
  largura: number;
  altura: number;
  /** Largura do polígono do bairro na tela (px). */
  larguraBairro: number;
}

const FOLGA_PX = 4;

export function rotulosVisiveis(itens: RotuloMedido[]): Set<string> {
  const exibidos: RotuloMedido[] = [];
  const porPrioridade = [...itens]
    .filter((r) => r.largura <= r.larguraBairro)
    .sort((a, b) => b.larguraBairro - a.larguraBairro);
  for (const r of porPrioridade) {
    const colide = exibidos.some(
      (o) =>
        Math.abs(o.x - r.x) < (o.largura + r.largura) / 2 + FOLGA_PX &&
        Math.abs(o.y - r.y) < (o.altura + r.altura) / 2 + FOLGA_PX,
    );
    if (!colide) exibidos.push(r);
  }
  return new Set(exibidos.map((r) => r.id));
}
