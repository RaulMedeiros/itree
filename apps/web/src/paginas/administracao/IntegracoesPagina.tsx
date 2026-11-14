import {
  ErroApi,
  FonteAlertaEnum,
  useAlertasEnviarArquivo,
  useAlertasFontes,
  useAlertasIngestoes,
} from "@itree/api-client";
import { ROTULOS_FONTE_ALERTA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";

import { DetalhesTecnicos } from "../../componentes/DetalhesTecnicos";
import { Botao } from "../../ui/botao";
import { Campo, EntradaArquivo, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { ConectoresSecao } from "./ConectoresSecao";
import { invalidarCaminhos } from "../../util/cache";
import {
  descreverHa,
  descreverProxima,
  formatarData,
  formatarDataHora,
  plural,
} from "../../util/formatos";

/** Origem em forma de nome ("arquivo sintético" vira "Arquivo sintético"); URLs ficam como estão. */
const rotuloOrigem = (origem: string) =>
  /^https?:/i.test(origem) ? origem : origem.charAt(0).toLocaleUpperCase("pt-BR") + origem.slice(1);

/** Última e próxima coleta de cada fonte, pelo agendamento configurado no servidor. */
function EstadoDasFontes() {
  const consulta = useAlertasFontes();
  if (consulta.isPending) return <Carregando linhas={3} />;
  if (consulta.isError) return <Erro erro={consulta.error} />;
  return (
    <section aria-labelledby="titulo-fontes" className="mb-6">
      <h2 id="titulo-fontes" className="mb-2 text-base font-semibold">
        Fontes
      </h2>
      <Tabela>
        <thead>
          <tr>
            <Th>Fonte</Th>
            <Th>Última coleta</Th>
            <Th>Próxima coleta</Th>
          </tr>
        </thead>
        <tbody>
          {consulta.data.data.map((f) => (
            <Linha key={f.fonte}>
              <Td>{ROTULOS_FONTE_ALERTA[f.fonte]}</Td>
              <Td>
                {f.ultima_coleta ? (
                  <>
                    <span title={formatarDataHora(f.ultima_coleta) ?? undefined}>
                      {descreverHa(f.ultima_coleta)}
                    </span>
                    {f.ultima_coleta_sucesso === false && (
                      <>
                        {" "}
                        <Selo tom="perigo">Falha</Selo>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-texto-suave">Nunca coletada</span>
                )}
              </Td>
              <Td>
                {!f.automatica ? (
                  <span className="text-texto-suave">Sem coleta automática (envio manual)</span>
                ) : f.proxima_coleta ? (
                  <>
                    {descreverProxima(f.proxima_coleta)}
                    <p className="text-xs text-texto-suave">
                      A cada {plural(f.intervalo_horas ?? 0, "hora")}
                    </p>
                  </>
                ) : (
                  <span className="text-texto-suave">
                    Aguardando a primeira execução do agendador
                  </span>
                )}
              </Td>
            </Linha>
          ))}
        </tbody>
      </Tabela>
    </section>
  );
}

/** Estado das integrações de alertas (RF-ADM-006) e ingestão manual. */
export function IntegracoesPagina() {
  const consulta = useAlertasIngestoes();
  const [enviando, setEnviando] = useState(false);
  return (
    <>
      <CabecalhoPagina
        titulo="Integrações"
        descricao={
          <>
            Ingestão de alertas ambientais. A coleta automática depende de configuração do servidor;
            licenças e limites de cada fonte devem ser verificados antes do uso produtivo.
          </>
        }
        acoes={
          <Botao onClick={() => setEnviando(true)}>
            <Upload /> Enviar arquivo da fonte
          </Botao>
        }
      />
      <DetalhesTecnicos>
        Decisão pendente DP-11 (credenciais, limites e condições das APIs externas).
      </DetalhesTecnicos>
      <ConectoresSecao />
      <EstadoDasFontes />
      <h2 className="mb-2 text-base font-semibold">Execuções recentes</h2>
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
                <Td>
                  {ROTULOS_FONTE_ALERTA[i.fonte]}
                  {i.orgao && <p className="text-xs text-texto-suave">{i.orgao}</p>}
                  {i.licenca && <p className="text-xs text-texto-suave">{i.licenca}</p>}
                  {i.data_referencia && (
                    <p className="text-xs text-texto-suave">
                      Dados de {formatarData(i.data_referencia)}
                    </p>
                  )}
                </Td>
                <Td className="max-w-64 truncate" title={i.origem}>
                  {rotuloOrigem(i.origem)}
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
          {(p) => <EntradaArquivo {...p} accept=".csv,.geojson,.json" onChange={setArquivo} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
