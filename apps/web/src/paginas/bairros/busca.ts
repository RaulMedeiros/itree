export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

/** Filtra pelo trecho do nome, sem diferenciar acento nem caixa. */
export function filtrarBairros<T extends { nome: string }>(bairros: T[], busca: string): T[] {
  const termo = semAcento(busca.trim());
  return termo ? bairros.filter((b) => semAcento(b.nome).includes(termo)) : bairros;
}
