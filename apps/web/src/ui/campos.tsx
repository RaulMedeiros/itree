import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "../util/cn";

const base =
  "w-full rounded-md border border-borda-campo bg-superficie px-3 text-sm text-texto placeholder:text-texto-suave disabled:opacity-60 aria-invalid:border-perigo";

export function Entrada({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-9", className)} {...props} />;
}

export function Selecao({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-9 pr-8", className)} {...props} />;
}

export function AreaTexto({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20 py-2", className)} {...props} />;
}

interface CampoProps {
  rotulo: string;
  ajuda?: string;
  erros?: string[];
  obrigatorio?: boolean;
  children: (props: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}

/** Rótulo, ajuda e mensagens de erro ligados ao controle para leitores de tela. */
export function Campo({ rotulo, ajuda, erros, obrigatorio, children }: CampoProps) {
  const id = useId();
  const idDescricao = `${id}-descricao`;
  const temErro = Boolean(erros?.length);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
        {obrigatorio && <span className="text-perigo"> *</span>}
      </label>
      {children({
        id,
        "aria-invalid": temErro || undefined,
        "aria-describedby": ajuda || temErro ? idDescricao : undefined,
      })}
      {(ajuda || temErro) && (
        <div id={idDescricao} className="text-xs">
          {ajuda && <p className="text-texto-suave">{ajuda}</p>}
          {erros?.map((erro) => (
            <p key={erro} className="text-perigo">
              {erro}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

interface OpcaoMarcavel {
  valor: string;
  rotulo: string;
  descricao?: string;
}

/** Lista de caixas de seleção (papéis, territórios, membros). */
export function ListaMarcavel({
  legenda,
  opcoes,
  selecionados,
  aoAlterar,
  erros,
  vazio = "Nenhuma opção disponível.",
  className,
}: {
  legenda: string;
  opcoes: OpcaoMarcavel[];
  selecionados: string[];
  aoAlterar: (valores: string[]) => void;
  erros?: string[];
  vazio?: string;
  className?: string;
}) {
  const alternar = (valor: string, marcado: boolean) =>
    aoAlterar(marcado ? [...selecionados, valor] : selecionados.filter((v) => v !== valor));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legenda}</legend>
      <div
        className={cn(
          "flex flex-col divide-y divide-borda rounded-md border border-borda bg-superficie",
          className,
        )}
      >
        {opcoes.length === 0 && <p className="px-3 py-2 text-sm text-texto-suave">{vazio}</p>}
        {opcoes.map((opcao) => (
          <label
            key={opcao.valor}
            className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-fundo"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-marca"
              checked={selecionados.includes(opcao.valor)}
              onChange={(e) => alternar(opcao.valor, e.target.checked)}
            />
            <span className="flex flex-col">
              <span className="text-sm">{opcao.rotulo}</span>
              {opcao.descricao && (
                <span className="text-xs text-texto-suave">{opcao.descricao}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {erros?.map((erro) => (
        <p key={erro} className="text-xs text-perigo">
          {erro}
        </p>
      ))}
    </fieldset>
  );
}
