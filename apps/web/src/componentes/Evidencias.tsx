import {
  ErroApi,
  evidenciasConfirmarEnvio,
  evidenciasIniciarEnvio,
  getEvidenciasListarQueryKey,
  useEvidenciasListar,
  useEvidenciasRemover,
  type EvidenciasIniciarEnvioMutationBody,
  TipoConteudoEnum,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Botao } from "../ui/botao";
import { AreaTexto, Campo } from "../ui/campos";
import { Dialogo } from "../ui/dialogo";
import { Carregando, Erro, Vazio } from "../ui/estados";
import { formatarDataHora } from "../util/formatos";

const TIPOS_ACEITOS = Object.values(TipoConteudoEnum).join(",");
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

type Alvo = { arvore: string } | { ocorrencia: string };

async function enviarArquivo(alvo: Alvo, arquivo: File, descricao: string) {
  if (!(Object.values(TipoConteudoEnum) as string[]).includes(arquivo.type)) {
    throw new Error("Tipo de arquivo não aceito. Use JPEG, PNG, WebP, HEIC ou PDF.");
  }
  if (arquivo.size > TAMANHO_MAXIMO) throw new Error("O arquivo passa de 25 MB.");
  const corpo: EvidenciasIniciarEnvioMutationBody = {
    ...alvo,
    nome_original: arquivo.name,
    tipo_conteudo: arquivo.type as TipoConteudoEnum,
    tamanho: arquivo.size,
    descricao,
    capturada_em: arquivo.lastModified ? new Date(arquivo.lastModified).toISOString() : null,
  };
  const { data } = await evidenciasIniciarEnvio(corpo);
  // Envio direto ao armazenamento privado, pela URL pré-assinada.
  const resposta = await fetch(data.url_envio, {
    method: data.metodo,
    headers: data.cabecalhos,
    body: arquivo,
  });
  if (!resposta.ok) throw new Error(`O armazenamento recusou o arquivo (${resposta.status}).`);
  await evidenciasConfirmarEnvio(data.evidencia.id);
}

/** Fotografias e documentos de uma árvore ou ocorrência. */
export function Evidencias({ alvo, podeEnviar }: { alvo: Alvo; podeEnviar: boolean }) {
  const consulta = useEvidenciasListar(alvo);
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const remover = useEvidenciasRemover<ErroApi>();

  const atualizar = () =>
    cliente.invalidateQueries({ queryKey: getEvidenciasListarQueryKey(alvo) });

  const enviar = async () => {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarArquivo(alvo, arquivo, descricao);
      setArquivo(null);
      setDescricao("");
      await atualizar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {podeEnviar && (
        <div>
          <input
            ref={entrada}
            type="file"
            accept={TIPOS_ACEITOS}
            className="sr-only"
            aria-label="Escolher arquivo"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
          <Botao variante="secundario" onClick={() => entrada.current?.click()}>
            <ImagePlus /> Adicionar foto ou documento
          </Botao>
        </div>
      )}
      {consulta.isPending ? (
        <Carregando linhas={2} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhuma evidência">Fotografias e documentos aparecem aqui.</Vazio>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {consulta.data.data.map((ev) => (
            <li
              key={ev.id}
              className="overflow-hidden rounded-lg border border-borda bg-superficie"
            >
              <a
                href={ev.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block aspect-[4/3] bg-fundo"
              >
                {ev.eh_imagem && ev.url ? (
                  <img
                    src={ev.url}
                    alt={ev.descricao || ev.nome_original}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-texto-suave">
                    <FileText className="size-8" aria-hidden />
                  </span>
                )}
              </a>
              <div className="flex items-start justify-between gap-2 p-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={ev.nome_original}>
                    {ev.descricao || ev.nome_original}
                  </p>
                  <p className="text-texto-suave">
                    {ev.enviada_por_nome} · {formatarDataHora(ev.criado_em)}
                  </p>
                  {ev.capturada_em && (
                    <p className="text-texto-suave">
                      Arquivo de {formatarDataHora(ev.capturada_em)}
                    </p>
                  )}
                </div>
                {podeEnviar && (
                  <button
                    className="rounded p-1 text-texto-suave hover:bg-perigo-clara hover:text-perigo"
                    aria-label={`Remover ${ev.nome_original}`}
                    onClick={() => setRemovendo(ev.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialogo
        aberto={arquivo !== null}
        aoMudar={(v) => !v && setArquivo(null)}
        titulo="Enviar evidência"
        descricao={arquivo ? `${arquivo.name} (${(arquivo.size / 1024).toFixed(0)} KB)` : undefined}
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setArquivo(null)}>
              Cancelar
            </Botao>
            <Botao onClick={() => void enviar()} disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar"}
            </Botao>
          </>
        }
      >
        {erro && (
          <p role="alert" className="mb-3 rounded-md bg-perigo-clara px-3 py-2 text-sm text-perigo">
            {erro}
          </p>
        )}
        <Campo
          rotulo="Descrição"
          ajuda="O que a evidência mostra. Evite conclusões: descreva o observado."
        >
          {(p) => (
            <AreaTexto
              {...p}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={500}
            />
          )}
        </Campo>
      </Dialogo>

      <Dialogo
        aberto={removendo !== null}
        aoMudar={(v) => !v && setRemovendo(null)}
        titulo="Remover evidência"
        descricao="A evidência deixa de aparecer, mas o arquivo é preservado para rastreabilidade."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setRemovendo(null)}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              disabled={!motivo.trim() || remover.isPending}
              onClick={() =>
                removendo &&
                remover.mutate(
                  { id: removendo, data: { motivo: motivo.trim() } },
                  {
                    onSuccess: () => {
                      setRemovendo(null);
                      setMotivo("");
                      void atualizar();
                    },
                  },
                )
              }
            >
              Remover
            </Botao>
          </>
        }
      >
        <Campo rotulo="Justificativa" obrigatorio>
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </Dialogo>
    </div>
  );
}
