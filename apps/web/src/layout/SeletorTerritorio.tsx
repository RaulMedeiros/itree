import { useNavigate, useSearch } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { useUsuario } from "../acesso/ContextoUsuario";
import { AjudaTermo } from "../componentes/AjudaTermo";
import { Selecao } from "../ui/campos";
import { Selo } from "../ui/selo";
import { temSeletorDeTerritorio, useTerritorioAtivo } from "./territorio";

/**
 * Território no cabeçalho. Com um só, mostra o nome; com mais de um, deixa escolher qual
 * filtra a visão geral, o mapa e as listas.
 */
export function SeletorTerritorio() {
  const eu = useUsuario();
  const ativo = useTerritorioAtivo();
  const navegar = useNavigate();
  const busca = useSearch({ strict: false }) as Record<string, unknown>;

  const municipio = eu.territorios.find((t) => t.tipo === "municipio");
  const unico = eu.territorios.length === 1 ? eu.territorios[0] : undefined;

  if (!temSeletorDeTerritorio(eu.territorios)) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <MapPin className="size-4 text-marca" aria-hidden />
        {unico ? (
          <span>
            <span className="text-texto-suave">Território: </span>
            <span className="font-medium">{unico.nome}</span>
          </span>
        ) : (
          <Selo tom="atencao">Sem escopo territorial atribuído</Selo>
        )}
        <AjudaTermo id="escopo_territorial" />
      </div>
    );
  }

  const escolher = (id: string) => {
    ativo.definir(id || undefined);
    // O bairro na URL vale mais que a preferência: se a tela já o tem, acompanha a escolha.
    if ("bairro" in busca) {
      void navegar({
        to: ".",
        replace: true,
        search: (s: Record<string, unknown>) => ({
          ...s,
          bairro: id || undefined,
          pagina: undefined,
        }),
      } as never);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <MapPin className="size-4 text-marca" aria-hidden />
      <label className="flex items-center gap-1.5">
        <span className="text-texto-suave">Território:</span>
        <Selecao
          aria-label="Território"
          value={ativo.id ?? ""}
          onChange={(e) => escolher(e.target.value)}
          className="h-8 max-w-56 font-medium"
        >
          <option value="">{municipio?.nome ?? "Todos os meus territórios"}</option>
          {eu.territorios
            .filter((t) => t.tipo !== "municipio")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
        </Selecao>
      </label>
      <AjudaTermo id="escopo_territorial" />
    </div>
  );
}
