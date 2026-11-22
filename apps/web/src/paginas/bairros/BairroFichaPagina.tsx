import {
  ErroApi,
  baixarArquivo,
  useBairrosFicha,
  type Ficha,
  type FichaBairro,
  type FichaCartao,
  type FichaRanking,
} from "@itree/api-client";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Download, Map as IconeMapa, Printer, Sprout } from "lucide-react";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Botao } from "../../ui/botao";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Recolhivel } from "../../ui/recolhivel";
import { Selo } from "../../ui/selo";
import { formatarData, formatarDataHora } from "../../util/formatos";
import { SeletorContagem } from "../../componentes/contagem";
import { contagemDaUrl, paramContagem } from "../../componentes/contagemUrl";
import type { Contagem } from "@itree/domain";
import { BlocoMacrozoneamento, BlocoRegra } from "./BlocoRegra";
import { CartaoIndicador, LinkDoCartao } from "./CartaoIndicador";
import { GraficoCondicao, GraficoEspecies, GraficoOcorrenciasMensal } from "./Graficos";
import { MapaDoBairro } from "./MapaDoBairro";
import { buscaDoMapa } from "./buscaDoMapa";

function DestinoDoCartao({ cartao, bairro }: { cartao: FichaCartao; bairro: FichaBairro }) {
  const link = cartao.link;
  if (!link) return null;
  if (link.pagina === "/mapa") {
    return (
      <LinkDoCartao
        to="/mapa"
        search={buscaDoMapa(bairro, link.filtros) as unknown as Record<string, string>}
      >
        {cartao.id === "ilha_calor" ? "Ver a camada no mapa" : "Ver no mapa"}
      </LinkDoCartao>
    );
  }
  return null;
}

function Ranking({ ranking, nome }: { ranking: FichaRanking; nome: string }) {
  return (
    <section
      aria-label="Posição entre os bairros que pedem atenção"
      className="evitar-quebra flex flex-col rounded-xl border border-borda bg-superficie p-4"
    >
      <h2 className="font-semibold">{ranking.titulo}</h2>
      {ranking.posicao === null ? (
        <p className="mt-2 text-sm text-texto-suave">
          {nome} não tem pendência no índice neste momento
          {ranking.total > 0 ? `; ${ranking.total} bairro(s) do seu escopo têm.` : "."}
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {ranking.posicao}º
            <span className="ml-1.5 text-base font-normal text-texto-suave">
              de {ranking.total} com pendência
            </span>
          </p>
          <p className="mt-0.5 text-sm text-texto-suave">Índice de atenção: {ranking.indice}</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {ranking.componentes.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className={c.quantidade === 0 ? "text-texto-suave" : undefined}>
                  {c.rotulo}
                </span>
                <span className="tabular-nums">{c.quantidade.toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Recolhivel
        titulo="Como é calculado"
        className="mt-2 text-xs text-texto-suave print:hidden"
        classeCorpo="flex flex-col gap-1"
      >
        <p>{ranking.definicao}</p>
        <p>Índice = {ranking.formula}.</p>
        <p>Fonte: {ranking.fonte}.</p>
      </Recolhivel>
    </section>
  );
}

function Conteudo({
  ficha,
  contagem,
  aoMudarContagem,
}: {
  ficha: Ficha;
  contagem: Contagem;
  aoMudarContagem: (c: Contagem) => void;
}) {
  const { bairro } = ficha;
  const podeExportar = usePermissao("relatorios.exportar");
  const podePlanejar = usePermissao("relatorios.ler");
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const exportar = async () => {
    setBaixando(true);
    setErro(null);
    try {
      await baixarArquivo("/api/v1/relatorios/painel.pdf", { bairro: bairro.id });
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Falha ao gerar o arquivo.");
    } finally {
      setBaixando(false);
    }
  };

  const validas = ficha.cartoes.find((c) => c.id === "arvores")?.valor ?? 0;
  const descricao = [
    bairro.regional?.nome,
    bairro.area_km2 !== null && bairro.area_km2 !== undefined
      ? `${bairro.area_km2.toLocaleString("pt-BR")} km²`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-6xl">
      <CabecalhoPagina
        titulo={bairro.nome}
        descricao={descricao || undefined}
        migalhas={[
          { rotulo: "Visão geral", para: "/visao-geral" },
          { rotulo: "Bairros", para: "/bairros" },
          { rotulo: bairro.nome },
        ]}
        acoes={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Selo tom={bairro.oficial ? "sucesso" : "neutro"} tamanho="md">
              {bairro.selo}
            </Selo>
            <Botao variante="secundario" asChild>
              <Link to="/mapa" search={buscaDoMapa(bairro)}>
                <IconeMapa aria-hidden /> Ver no mapa
              </Link>
            </Botao>
            {podePlanejar && (
              <Botao variante="secundario" asChild>
                <Link to="/planejamento" search={{ bairro: bairro.id }}>
                  <Sprout aria-hidden /> Ver no planejamento
                </Link>
              </Botao>
            )}
            {podeExportar && (
              <Botao variante="secundario" disabled={baixando} onClick={() => void exportar()}>
                <Download aria-hidden /> Exportar PDF
              </Botao>
            )}
            <Botao variante="secundario" onClick={() => window.print()}>
              <Printer aria-hidden /> Imprimir
            </Botao>
          </div>
        }
      />
      {baixando && (
        <p role="status" className="mb-2 text-sm text-texto-suave">
          Gerando arquivo…
        </p>
      )}
      {erro && (
        <p role="alert" className="mb-2 text-sm text-perigo">
          {erro}
        </p>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MapaDoBairro bairro={bairro} />
        </div>
        <Ranking ranking={ficha.ranking} nome={bairro.nome} />
      </div>

      <BlocoRegra
        bloco={ficha.regra_3_30_300}
        contagem={contagem}
        aoMudarContagem={aoMudarContagem}
      />
      {ficha.macrozoneamento && <BlocoMacrozoneamento bloco={ficha.macrozoneamento} />}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Indicadores do bairro</h2>
        <SeletorContagem valor={contagem} aoMudar={aoMudarContagem} className="print:hidden" />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ficha.cartoes.map((c) => (
          <CartaoIndicador
            key={c.id}
            cartao={c}
            nome={bairro.nome}
            destino={<DestinoDoCartao cartao={c} bairro={bairro} />}
          />
        ))}
      </div>

      <h2 className="mb-2 text-lg font-semibold">Composição e evolução</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <GraficoEspecies grafico={ficha.graficos.especies} validas={validas} />
        <GraficoCondicao grafico={ficha.graficos.condicao} />
        <div className="lg:col-span-2">
          <GraficoOcorrenciasMensal
            serie={ficha.graficos.ocorrencias_mensais}
            geradoEm={ficha.gerado_em}
          />
        </div>
      </div>

      <footer className="mb-4 text-xs text-texto-suave">
        <p>
          Limites do bairro: {bairro.fonte}
          {bairro.data_referencia ? ` · dados de ${formatarData(bairro.data_referencia)}` : ""}.
          Ficha gerada em {formatarDataHora(ficha.gerado_em)}. Os números respeitam o seu escopo
          territorial; “sem dado” quer dizer que a fonte não cobre este bairro, e não zero.
        </p>
      </footer>
    </div>
  );
}

/** Ficha do bairro (`/bairros/$id`): mapa, indicadores com fonte e data, gráficos e ranking. */
export function BairroFichaPagina() {
  const { id } = useParams({ from: "/autenticado/bairros/$id" });
  const { contagem } = useSearch({ from: "/autenticado/bairros/$id" });
  const navegar = useNavigate({ from: "/bairros/$id" });
  const consulta = useBairrosFicha(id, paramContagem(contagem));

  if (consulta.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        <Carregando linhas={6} rotulo="Carregando a ficha do bairro…" />
      </div>
    );
  }
  if (consulta.isError) {
    const erro = consulta.error;
    if (erro instanceof ErroApi && erro.status === 403)
      return (
        <Vazio
          titulo="Este bairro está fora do seu escopo"
          acao={
            <Link to="/bairros" className="text-marca-escura hover:underline">
              Ver os bairros do seu escopo
            </Link>
          }
        >
          Você só vê a ficha dos bairros que fazem parte do seu escopo territorial.
        </Vazio>
      );
    if (erro instanceof ErroApi && erro.status === 404)
      return (
        <Vazio
          titulo="Bairro não encontrado"
          acao={
            <Link to="/bairros" className="text-marca-escura hover:underline">
              Ver os bairros
            </Link>
          }
        >
          O endereço pode ter mudado ou não existe.
        </Vazio>
      );
    return <Erro erro={erro} aoTentarNovamente={() => void consulta.refetch()} />;
  }
  return (
    <Conteudo
      ficha={consulta.data.data}
      contagem={contagemDaUrl(contagem)}
      aoMudarContagem={(c) =>
        void navegar({ search: () => ({ contagem: c === "todas" ? undefined : c }), replace: true })
      }
    />
  );
}
