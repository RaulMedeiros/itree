import {
  ErroApi,
  evidenciasConfirmarEnvio,
  evidenciasIniciarEnvio,
  getEvidenciasListarQueryKey,
  useEvidenciasListar,
  useEvidenciasRemover,
  type EvidenciasIniciarEnvioMutationBody,
  TipoConteudoEnum,
  type Evidencia,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

import { Botao } from "../ui/botao";
import { AreaTexto, Campo } from "../ui/campos";
import { Dialogo } from "../ui/dialogo";
import { Carregando, Erro, Vazio } from "../ui/estados";
import { MenuAcoes, type ItemMenu } from "../ui/menu";
import { formatarData, formatarDataHora } from "../util/formatos";
import { SeloIlustracao } from "./selos";

const TIPOS_ACEITOS = Object.values(TipoConteudoEnum).join(",");
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

type Alvo = { arvore: string } | { ocorrencia: string } | { inspecao: string } | { tarefa: string };

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

/** Fotografias e documentos de uma árvore, ocorrência, inspeção ou tarefa. */
export function Evidencias({ alvo, podeEnviar }: { alvo: Alvo; podeEnviar: boolean }) {
  const consulta = useEvidenciasListar(alvo);
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<Evidencia | null>(null);

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
                aria-describedby={`ev-nova-aba-${ev.id}`}
              >
                {ev.eh_imagem && ev.url ? (
                  <span className="relative block size-full">
                    <img
                      src={ev.url}
                      alt={ev.descricao || ev.nome_original}
                      className="size-full object-cover"
                    />
                    {ev.ilustrativa && (
                      <SeloIlustracao className="absolute top-2 left-2 shadow-sm" />
                    )}
                  </span>
                ) : (
                  <span className="flex size-full items-center justify-center text-texto-suave">
                    <FileText className="size-8" aria-hidden />
                    <span className="sr-only">Abrir {ev.nome_original}</span>
                  </span>
                )}
              </a>
              <span id={`ev-nova-aba-${ev.id}`} className="sr-only">
                Abre em nova aba
              </span>
              <div className="flex items-start justify-between gap-2 p-2 text-xs">
                <div className="min-w-0">
                  <p
                    className="line-clamp-2 font-medium break-words"
                    title={
                      ev.descricao ? `${ev.descricao} (${ev.nome_original})` : ev.nome_original
                    }
                  >
                    {ev.descricao || ev.nome_original}
                  </p>
                  <p className="text-texto-suave">
                    Enviada por {ev.enviada_por_nome} em {formatarDataHora(ev.criado_em)}
                  </p>
                  {ev.capturada_em && (
                    <p className="text-texto-suave">
                      Capturada em {formatarDataHora(ev.capturada_em)}
                    </p>
                  )}
                </div>
                <MenuAcoes
                  rotulo={`Ações de ${ev.nome_original}`}
                  itens={itensDoMenu(ev, podeEnviar, setAmpliada, setRemovendo)}
                />
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

      <AmpliarEvidenciaDialogo evidencia={ampliada} aoFechar={() => setAmpliada(null)} />
      <RemoverEvidenciaDialogo
        evidenciaId={removendo}
        aoFechar={() => setRemovendo(null)}
        aoRemover={() => void atualizar()}
      />
    </div>
  );
}

/** "Ampliar" vale para imagens; documentos abrem em nova aba. "Remover" só para quem edita. */
function itensDoMenu(
  ev: Evidencia,
  podeRemover: boolean,
  ampliar: (e: Evidencia) => void,
  remover: (id: string) => void,
): ItemMenu[] {
  const itens: ItemMenu[] = [];
  if (ev.url) {
    const url = ev.url;
    itens.push(
      ev.eh_imagem
        ? { rotulo: "Ampliar", aoEscolher: () => ampliar(ev) }
        : {
            rotulo: "Abrir em nova aba",
            aoEscolher: () => void window.open(url, "_blank", "noopener,noreferrer"),
          },
    );
  }
  if (podeRemover)
    itens.push({ rotulo: "Remover", perigo: true, aoEscolher: () => remover(ev.id) });
  return itens;
}

/** Imagem da evidência em tamanho grande, com a descrição, a autoria e as datas. */
function AmpliarEvidenciaDialogo({
  evidencia,
  aoFechar,
}: {
  evidencia: Evidencia | null;
  aoFechar: () => void;
}) {
  return (
    <Dialogo
      aberto={evidencia !== null}
      aoMudar={(v) => !v && aoFechar()}
      titulo={evidencia ? evidencia.descricao || evidencia.nome_original : "Evidência"}
      largura="max-w-4xl"
    >
      {evidencia?.url && (
        <>
          <img
            src={evidencia.url}
            alt={evidencia.descricao || evidencia.nome_original}
            className="max-h-[70vh] w-full rounded object-contain"
          />
          <p className="mt-3 text-sm">{evidencia.descricao || "Sem descrição."}</p>
          <p className="text-xs text-texto-suave">
            Enviada por {evidencia.enviada_por_nome || "autor não informado"} em{" "}
            {formatarData(evidencia.criado_em)}. Arquivo: {evidencia.nome_original}.
          </p>
          {evidencia.capturada_em && (
            <p className="text-xs text-texto-suave">
              Capturada em {formatarData(evidencia.capturada_em)}.
            </p>
          )}
        </>
      )}
    </Dialogo>
  );
}

/**
 * Remoção de evidência com justificativa obrigatória. O arquivo é preservado para
 * rastreabilidade. Aberto quando `evidenciaId` está preenchido.
 */
export function RemoverEvidenciaDialogo({
  evidenciaId,
  aoFechar,
  aoRemover,
}: {
  evidenciaId: string | null;
  aoFechar: () => void;
  aoRemover: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const remover = useEvidenciasRemover<ErroApi>();
  return (
    <Dialogo
      aberto={evidenciaId !== null}
      aoMudar={(v) => !v && aoFechar()}
      titulo="Remover evidência"
      descricao="A evidência deixa de aparecer, mas o arquivo é preservado para rastreabilidade."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={!motivo.trim() || remover.isPending}
            onClick={() =>
              evidenciaId &&
              remover.mutate(
                { id: evidenciaId, data: { motivo: motivo.trim() } },
                {
                  onSuccess: () => {
                    aoFechar();
                    setMotivo("");
                    aoRemover();
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
  );
}
