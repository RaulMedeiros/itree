import { mapaBusca, type ResultadoBusca } from "@itree/api-client";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import * as Radix from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useCelular } from "../util/useMediaQuery";

const TIPOS: Record<string, string> = {
  arvore: "Árvore",
  ocorrencia: "Ocorrência",
  territorio: "Território",
  bairro: "Bairro",
  coordenada: "Coordenada",
};

/**
 * Busca por código, identificador externo, endereço, bairro ou coordenada (RF-SHELL-003).
 * No celular vira um ícone que abre a busca em tela cheia.
 */
export function BuscaGlobal() {
  const celular = useCelular();
  const [aberta, setAberta] = useState(false);
  if (!celular) return <CampoBusca />;
  return (
    <Radix.Root open={aberta} onOpenChange={setAberta}>
      <Radix.Trigger
        aria-label="Abrir busca"
        className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-fundo"
      >
        <Search className="size-5 text-texto-suave" aria-hidden />
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-superficie p-3"
        >
          <div className="flex items-center gap-2">
            <Radix.Title className="sr-only">Busca</Radix.Title>
            <div className="min-w-0 flex-1">
              <CampoBusca emTelaCheia aoEscolher={() => setAberta(false)} />
            </div>
            <Radix.Close
              aria-label="Fechar busca"
              className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-fundo"
            >
              <X className="size-5" aria-hidden />
            </Radix.Close>
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

function CampoBusca({
  emTelaCheia,
  aoEscolher,
}: {
  emTelaCheia?: boolean;
  aoEscolher?: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const navegar = useNavigate();
  const noMapa = useRouterState({ select: (e) => e.location.pathname.startsWith("/mapa") });
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  // Atalho "/" foca a busca, exceto quando a pessoa já está digitando em outro campo.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      campo.current?.focus();
    };
    document.addEventListener("keydown", atalho);
    return () => document.removeEventListener("keydown", atalho);
  }, []);

  useEffect(() => {
    // Com menos de 2 caracteres a lista nem é exibida (ver renderização).
    if (termo.trim().length < 2) return;
    const controle = new AbortController();
    const t = setTimeout(() => {
      void mapaBusca({ q: termo.trim() }, { signal: controle.signal })
        .then((r) => {
          setResultados(r.data);
          setAtivo(0);
          setAberto(true);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [termo]);

  useEffect(() => {
    const fechar = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  const escolher = (r: ResultadoBusca) => {
    aoEscolher?.();
    setAberto(false);
    setTermo("");
    if (r.tipo === "arvore" && r.id)
      void navegar({ to: "/inventario/arvores/$id", params: { id: r.id } });
    else if (r.tipo === "ocorrencia" && r.id)
      void navegar({ to: "/ocorrencias/$id", params: { id: r.id } });
    else if (r.tipo === "territorio" && r.subtipo === "bairro" && r.id && !noMapa)
      // Fora do mapa, o bairro abre a ficha própria ("Ver no mapa" fica nela). No mapa, a busca
      // continua destacando e enquadrando o bairro (M-05).
      void navegar({ to: "/bairros/$id", params: { id: r.id } });
    else if (r.limites) {
      const [x1, y1, x2, y2] = r.limites;
      void navegar({
        to: "/mapa",
        search: {
          lon: (x1! + x2!) / 2,
          lat: (y1! + y2!) / 2,
          zoom: 14,
          // O mapa realça o território buscado até a próxima interação (RF-MAPA-011).
          destaque: r.tipo === "territorio" && r.id ? r.id : undefined,
        },
      });
    } else if (r.localizacao) {
      const loc = r.localizacao as { longitude: number; latitude: number };
      void navegar({ to: "/mapa", search: { lon: loc.longitude, lat: loc.latitude, zoom: 18 } });
    }
  };

  return (
    <div ref={raiz} className={emTelaCheia ? "relative w-full" : "relative w-96"}>
      <Search
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-suave max-md:top-3.5"
        aria-hidden
      />
      <input
        ref={campo}
        type="search"
        role="combobox"
        aria-expanded={aberto && resultados.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={aberto && resultados[ativo] ? `${id}-opcao-${ativo}` : undefined}
        aria-label="Busca global"
        aria-keyshortcuts="/"
        placeholder="Buscar árvore, ocorrência, bairro ou coordenada"
        className="h-9 w-full rounded-md border border-borda-campo bg-fundo pr-8 pl-8 text-sm max-md:h-11 max-md:text-base"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onFocus={() => resultados.length && setAberto(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setAtivo((a) => Math.min(a + 1, resultados.length - 1));
          else if (e.key === "ArrowUp") setAtivo((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && resultados[ativo]) escolher(resultados[ativo]!);
          else if (e.key === "Escape") setAberto(false);
        }}
      />
      {!termo && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-2 right-2.5 rounded border border-borda px-1.5 text-xs text-texto-suave"
        >
          /
        </kbd>
      )}
      {aberto && termo.trim().length >= 2 && (
        <ul
          id={id}
          role="listbox"
          className={`z-50 w-full overflow-hidden rounded-md border border-borda bg-superficie shadow-lg ${emTelaCheia ? "absolute top-12 max-h-[70dvh] overflow-y-auto" : "absolute top-10"}`}
        >
          {resultados.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-texto-suave">
              Nada encontrado no seu escopo.
            </li>
          )}
          {resultados.map((r, i) => (
            <li
              key={`${r.tipo}-${r.id ?? r.rotulo}`}
              id={`${id}-opcao-${i}`}
              role="option"
              aria-selected={i === ativo}
              className={`cursor-pointer px-3 py-2 text-sm max-md:py-3 ${i === ativo ? "bg-marca-clara" : ""}`}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => (e.preventDefault(), escolher(r))}
            >
              <span className="mr-2 text-xs text-texto-suave">
                {r.tipo === "territorio" && r.subtipo === "bairro" ? TIPOS.bairro : TIPOS[r.tipo]}
              </span>
              <span className="font-medium">{r.rotulo}</span>
              {r.descricao && <p className="truncate text-xs text-texto-suave">{r.descricao}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
