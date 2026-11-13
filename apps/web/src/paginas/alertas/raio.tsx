import { Selecao } from "../../ui/campos";
import { RAIOS_M, type RaioM } from "./opcoesRaio";

export function SeletorRaio({ valor, aoMudar }: { valor: RaioM; aoMudar: (raio: RaioM) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-texto-suave">
      Raio
      <Selecao
        aria-label="Raio das árvores e ocorrências próximas"
        value={valor}
        onChange={(e) => aoMudar(Number(e.target.value) as RaioM)}
        className="w-28"
      >
        {RAIOS_M.map((r) => (
          <option key={r} value={r}>
            {r} m
          </option>
        ))}
      </Selecao>
    </label>
  );
}
