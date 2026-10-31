import { useTerritoriosListar } from "@itree/api-client";
import { ROTULOS_TIPO_TERRITORIO } from "@itree/domain";
import { ExternalLink } from "lucide-react";

import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarData, formatarDataHora } from "../../util/formatos";

export function TerritoriosPagina() {
  const consulta = useTerritoriosListar({ tamanho: 500 });
  return (
    <>
      <CabecalhoPagina
        titulo="Territórios"
        descricao="Limites administrativos usados no escopo de usuários e equipes, com fonte e data de cada dado."
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhum território importado">
          Importe os bairros de Fortaleza com o comando <code>importar_territorios</code> do backend
          (veja <code>backend/README.md</code>).
        </Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Tipo</Th>
              <Th>Código na fonte</Th>
              <Th>Fonte</Th>
              <Th>Data do dado</Th>
              <Th>Ingerido em</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.results.map((t) => (
              <Linha key={t.id}>
                <Td className="font-medium">{t.nome}</Td>
                <Td>{ROTULOS_TIPO_TERRITORIO[t.tipo]}</Td>
                <Td className="font-mono text-xs">{t.codigo}</Td>
                <Td>
                  {t.fonte_url ? (
                    <a
                      href={t.fonte_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-marca-escura hover:underline"
                    >
                      {t.fonte} <ExternalLink className="size-3" aria-label="(abre em nova aba)" />
                    </a>
                  ) : (
                    t.fonte
                  )}
                </Td>
                <Td>
                  {formatarData(t.data_referencia) ?? (
                    <span className="text-texto-suave">Não informada pela fonte</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{formatarDataHora(t.ingerido_em)}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
    </>
  );
}
