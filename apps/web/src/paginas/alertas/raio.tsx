import { Selecao } from "../../ui/campos";

/** Raios oferecidos para as árvores e ocorrências próximas de um alerta, em metros. */
export const RAIOS_M = [50, 100, 250, 500];
export type RaioM = number;

/** Raio padrão, o mesmo da API. */
export const RAIO_PADRAO_M: RaioM = 100;

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
