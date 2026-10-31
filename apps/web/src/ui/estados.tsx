import { ErroApi } from "@itree/api-client";
import { AlertTriangle, Inbox, Lock, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Botao } from "./botao";

/** Esqueleto de carregamento: nunca mostra números provisórios (W-01 §4.3). */
export function Carregando({
  linhas = 5,
  rotulo = "Carregando…",
}: {
  linhas?: number;
  rotulo?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-neutro-clara" />
      ))}
    </div>
  );
}

function Bloco({
  icone,
  titulo,
  children,
  acao,
}: {
  icone: ReactNode;
  titulo: string;
  children?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-borda bg-superficie px-6 py-10 text-center">
      <div className="text-texto-suave [&_svg]:size-6">{icone}</div>
      <p className="font-medium">{titulo}</p>
      {children && <div className="max-w-md text-sm text-texto-suave">{children}</div>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

/** Estado vazio: explica por que está vazio e qual ação tomar. */
export function Vazio({
  titulo,
  children,
  acao,
}: {
  titulo: string;
  children?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <Bloco icone={<Inbox />} titulo={titulo} acao={acao}>
      {children}
    </Bloco>
  );
}

export function SemPermissao() {
  return (
    <Bloco icone={<Lock />} titulo="Você não tem permissão para acessar esta área">
      Se precisar de acesso, fale com um administrador da plataforma.
    </Bloco>
  );
}

export function Erro({
  erro,
  aoTentarNovamente,
}: {
  erro: unknown;
  aoTentarNovamente?: () => void;
}) {
  if (erro instanceof ErroApi && erro.status === 403) return <SemPermissao />;
  const mensagem = erro instanceof Error ? erro.message : "Ocorreu um erro inesperado.";
  return (
    <Bloco
      icone={<AlertTriangle className="text-perigo" />}
      titulo="Não foi possível carregar"
      acao={
        aoTentarNovamente && (
          <Botao variante="secundario" onClick={aoTentarNovamente}>
            <RotateCw /> Tentar novamente
          </Botao>
        )
      }
    >
      {mensagem}
    </Bloco>
  );
}
