import { mapaBusca, type ResultadoBusca } from "@itree/api-client";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const TIPOS: Record<string, string> = {
  arvore: "Árvore",
  ocorrencia: "Ocorrência",
  territorio: "Território",
  coordenada: "Coordenada",
};

/** Busca por código, identificador externo, endereço, bairro ou coordenada (RF-SHELL-003). */
export function BuscaGlobal() {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const navegar = useNavigate();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);

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
    setAberto(false);
    setTermo("");
    if (r.tipo === "arvore" && r.id)
      void navegar({ to: "/inventario/arvores/$id", params: { id: r.id } });
    else if (r.tipo === "ocorrencia" && r.id)
      void navegar({ to: "/ocorrencias/$id", params: { id: r.id } });
    else if (r.limites) {
      const [x1, y1, x2, y2] = r.limites;
      void navegar({
        to: "/mapa",
        search: { lon: (x1! + x2!) / 2, lat: (y1! + y2!) / 2, zoom: 14 },
      });
    } else if (r.localizacao) {
      const loc = r.localizacao as { longitude: number; latitude: number };
      void navegar({ to: "/mapa", search: { lon: loc.longitude, lat: loc.latitude, zoom: 18 } });
    }
  };

  return (
    <div ref={raiz} className="relative w-96">
      <Search
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-suave"
        aria-hidden
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={aberto && resultados.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={aberto && resultados[ativo] ? `${id}-opcao-${ativo}` : undefined}
        aria-label="Busca global"
        placeholder="Buscar árvore, ocorrência, bairro ou coordenada"
        className="h-9 w-full rounded-md border border-borda-campo bg-fundo pr-3 pl-8 text-sm"
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
      {aberto && termo.trim().length >= 2 && (
        <ul
          id={id}
          role="listbox"
          className="absolute top-10 z-50 w-full overflow-hidden rounded-md border border-borda bg-superficie shadow-lg"
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
              className={`cursor-pointer px-3 py-2 text-sm ${i === ativo ? "bg-marca-clara" : ""}`}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => (e.preventDefault(), escolher(r))}
            >
              <span className="mr-2 text-xs text-texto-suave">{TIPOS[r.tipo]}</span>
              <span className="font-medium">{r.rotulo}</span>
              {r.descricao && <p className="truncate text-xs text-texto-suave">{r.descricao}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
