import { ErroApi, baixarArquivo, type PermissaoEnum } from "@itree/api-client";
import { Download } from "lucide-react";
import { useState } from "react";

import { usePermissao } from "../acesso/ContextoUsuario";
import { Botao } from "../ui/botao";
import { filtrosParaExportar } from "./filtrosExportacao";

/**
 * "Exportar CSV" de uma lista: baixa o que os filtros atuais alcançam, dentro do escopo de
 * quem exporta, com os metadados (data, usuário, filtros) e o registro da exportação no
 * servidor. Só aparece para quem pode exportar e ler o conjunto.
 */
export function BotaoExportarCsv({
  conjunto,
  filtros,
  leitura,
  rotulo = "Exportar CSV",
  variante = "secundario",
}: {
  conjunto: "ocorrencias" | "inspecoes" | "tarefas" | "alertas";
  filtros: Record<string, string | number | boolean | undefined | null>;
  /** Permissão de leitura do conjunto (a mesma que o servidor exige). */
  leitura: PermissaoEnum;
  rotulo?: string;
  variante?: "secundario" | "fantasma";
}) {
  const pode = usePermissao("relatorios.exportar", leitura);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!pode) return null;
  const baixar = async () => {
    setBaixando(true);
    setErro(null);
    try {
      await baixarArquivo("/api/v1/relatorios/exportar", {
        ...filtrosParaExportar(filtros),
        conjunto,
        formato: "csv",
      });
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Falha ao gerar o arquivo.");
    } finally {
      setBaixando(false);
    }
  };
  return (
    <>
      <Botao variante={variante} disabled={baixando} onClick={() => void baixar()}>
        <Download aria-hidden /> {rotulo}
      </Botao>
      {baixando && (
        <span role="status" className="sr-only">
          Gerando arquivo…
        </span>
      )}
      {erro && (
        <p role="alert" className="basis-full text-sm text-perigo">
          {erro}
        </p>
      )}
    </>
  );
}
