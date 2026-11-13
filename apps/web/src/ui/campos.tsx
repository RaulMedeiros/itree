import { Paperclip } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "../util/cn";
import { dataBrParaIso, dataIsoParaBr, mascararDataBr } from "../util/formatos";
import { Botao } from "./botao";

const base =
  "w-full rounded-md border border-borda-campo bg-superficie px-3 text-sm text-texto placeholder:text-texto-suave disabled:opacity-60 aria-invalid:border-perigo";

export function Entrada({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-9", className)} {...props} />;
}

export function Selecao({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "seletor h-9 pr-8", className)} {...props} />;
}

export const MENSAGEM_DATA_INVALIDA = "Data inválida. Use dd/mm/aaaa.";
const DICA_DATA = "Use o formato dd/mm/aaaa.";

/** Identificador do rótulo de um `Campo`, derivado do id que ele entrega ao controle. */
const idRotuloDe = (id: string) => `${id}-rotulo`;

type PropsData = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  /** Data ISO (AAAA-MM-DD) ou vazio. */
  value: string;
  /** Recebe a data ISO, ou vazio enquanto a digitação estiver incompleta ou inválida. */
  onChange: (iso: string) => void;
};

/**
 * Data em dd/mm/aaaa. O campo nativo `type="date"` segue o idioma do navegador (mm/dd/yyyy
 * em inglês), o que induz a trocar dia e mês; aqui o formato é sempre o brasileiro.
 */
export function EntradaData({ value, onChange, className, ...props }: PropsData) {
  const [texto, setTexto] = useState(dataIsoParaBr(value));
  // Valor alterado por fora (ex.: limpar filtros): reescreve o texto durante a renderização.
  const [anterior, setAnterior] = useState(value);
  if (value !== anterior) {
    setAnterior(value);
    if (dataBrParaIso(texto) !== value) setTexto(dataIsoParaBr(value));
  }
  const idErro = useId();
  const invalido = texto.length === 10 && dataBrParaIso(texto) === "";
  const descricao = [props["aria-describedby"], invalido ? idErro : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        lang="pt-BR"
        aria-invalid={invalido || props["aria-invalid"] || undefined}
        aria-describedby={descricao || undefined}
        className={cn(base, "h-9", className)}
        value={texto}
        onChange={(e) => {
          const novo = mascararDataBr(e.target.value);
          setTexto(novo);
          onChange(dataBrParaIso(novo));
        }}
      />
      {invalido && (
        <p id={idErro} className="text-xs text-perigo">
          {MENSAGEM_DATA_INVALIDA}
        </p>
      )}
    </>
  );
}

type PropsArquivo = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  onChange: (arquivo: File | null) => void;
};

/** Escolha de arquivo com botão e texto em português (o campo nativo usa o idioma do navegador). */
export function EntradaArquivo({ onChange, className, ...props }: PropsArquivo) {
  const entrada = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState("");
  const idBotao = useId();
  // O input fica escondido; quem recebe o foco é o botão, então o nome, a descrição e o
  // estado de erro do Campo (ligados ao input por `id`) são repetidos nele.
  const { id, "aria-describedby": descricao, "aria-invalid": invalido, ...resto } = props;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        {...resto}
        id={id}
        ref={entrada}
        type="file"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          const arquivo = e.target.files?.[0] ?? null;
          setNome(arquivo?.name ?? "");
          onChange(arquivo);
        }}
      />
      <Botao
        id={idBotao}
        variante="secundario"
        aria-labelledby={id ? `${idRotuloDe(id)} ${idBotao}` : undefined}
        aria-describedby={descricao}
        aria-invalid={invalido}
        onClick={() => entrada.current?.click()}
      >
        <Paperclip /> Escolher arquivo
      </Botao>
      <span className="min-w-0 truncate text-sm text-texto-suave" aria-live="polite">
        {nome || "Nenhum arquivo escolhido"}
      </span>
    </div>
  );
}

export function AreaTexto({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20 py-2", className)} {...props} />;
}

interface CampoProps {
  rotulo: string;
  ajuda?: string;
  /** Campo de data dd/mm/aaaa: mostra o formato como dica quando `ajuda` não é usada. */
  data?: boolean;
  erros?: string[];
  obrigatorio?: boolean;
  children: (props: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}

/** Rótulo, ajuda e mensagens de erro ligados ao controle para leitores de tela. */
export function Campo({
  rotulo,
  ajuda: ajudaInformada,
  data,
  erros,
  obrigatorio,
  children,
}: CampoProps) {
  const id = useId();
  const ajuda = ajudaInformada ?? (data ? DICA_DATA : undefined);
  const idDescricao = `${id}-descricao`;
  const temErro = Boolean(erros?.length);
  return (
    <div className="flex flex-col gap-1.5">
      <label id={idRotuloDe(id)} htmlFor={id} className="text-sm font-medium">
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
  /** Recuo visual (0 = raiz), para listas hierárquicas. */
  nivel?: number;
  /** Aviso curto sob a descrição (ex.: opção já coberta por outra marcada). */
  nota?: string;
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
            style={opcao.nivel ? { paddingLeft: `${0.75 + opcao.nivel * 1.5}rem` } : undefined}
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
              {opcao.nota && <span className="text-xs text-info">{opcao.nota}</span>}
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
