import {
  ErroApi,
  FonteAlertaEnum,
  useAlertasEnviarArquivo,
  useAlertasIngestoes,
} from "@itree/api-client";
import { ROTULOS_FONTE_ALERTA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { formatarDataHora } from "../../util/formatos";

/** Estado das integrações de alertas (RF-ADM-006) e ingestão manual. */
export function IntegracoesPagina() {
  const consulta = useAlertasIngestoes();
  const [enviando, setEnviando] = useState(false);
  return (
    <>
      <CabecalhoPagina
        titulo="Integrações"
        descricao="Ingestão de alertas ambientais. A coleta automática usa as URLs em ALERTAS_FONTES; licenças e limites de cada fonte devem ser verificados antes do uso produtivo (DP-11)."
        acoes={
          <Botao onClick={() => setEnviando(true)}>
            <Upload /> Enviar arquivo da fonte
          </Botao>
        }
      />
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhuma ingestão executada" />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Fonte</Th>
              <Th>Origem</Th>
              <Th>Execução</Th>
              <Th>Resultado</Th>
              <Th>Responsável</Th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.map((i) => (
              <Linha key={i.id}>
                <Td>{ROTULOS_FONTE_ALERTA[i.fonte]}</Td>
                <Td className="max-w-64 truncate" title={i.origem}>
                  {i.origem}
                </Td>
                <Td className="whitespace-nowrap">{formatarDataHora(i.iniciada_em)}</Td>
                <Td>
                  {i.sucesso ? <Selo tom="sucesso">Sucesso</Selo> : <Selo tom="perigo">Falha</Selo>}
                  <p className="text-xs text-texto-suave">
                    {i.sucesso
                      ? `${i.recebidos} recebidos · ${i.novos} novos · ${i.ja_existentes} já existentes · ${i.fora_do_municipio} fora do município · ${i.invalidos} inválidos`
                      : i.erro}
                  </p>
                </Td>
                <Td>{i.usuario ?? "Coleta automática"}</Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {enviando && <EnvioDialogo aoFechar={() => setEnviando(false)} />}
    </>
  );
}

function EnvioDialogo({ aoFechar }: { aoFechar: () => void }) {
  const [fonte, setFonte] = useState<FonteAlertaEnum>("inpe_focos");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const enviar = useAlertasEnviarArquivo<ErroApi>();
  const cliente = useQueryClient();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Enviar arquivo da fonte"
      descricao="CSV do BDQueimadas ou GeoJSON do TerraBrasilis/MapBiomas. Reenviar o mesmo arquivo não duplica alertas."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!arquivo || enviar.isPending}
            onClick={() =>
              arquivo &&
              enviar.mutate(
                { data: { fonte, arquivo } },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/alertas"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            {enviar.isPending ? "Processando…" : "Enviar"}
          </Botao>
        </>
      }
    >
      {enviar.error && <p className="mb-3 text-sm text-perigo">{enviar.error.message}</p>}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Fonte">
          {(p) => (
            <Selecao
              {...p}
              value={fonte}
              onChange={(e) => setFonte(e.target.value as FonteAlertaEnum)}
            >
              {Object.values(FonteAlertaEnum).map((f) => (
                <option key={f} value={f}>
                  {ROTULOS_FONTE_ALERTA[f]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Arquivo" obrigatorio>
          {(p) => (
            <Entrada
              {...p}
              type="file"
              accept=".csv,.geojson,.json"
              className="py-1.5"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          )}
        </Campo>
      </div>
    </Dialogo>
  );
}
