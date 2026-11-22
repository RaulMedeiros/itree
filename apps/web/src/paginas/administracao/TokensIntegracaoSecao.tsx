import {
  ErroApi,
  useIntegracoesTokensCriar,
  useIntegracoesTokensListar,
  useIntegracoesTokensRevogar,
  type TokenCriado,
  type TokenIntegracao,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";

import { Botao } from "../../ui/botao";
import { Campo, Entrada, ListaMarcavel } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { formatarDataHora } from "../../util/formatos";
import { useOpcoesTerritorio } from "./dados";

/**
 * Tokens de máquina das integrações (ex.: o projeto de detecção de árvores). O valor aparece uma
 * única vez, ao criar; depois só o prefixo. Cada token tem escopo territorial próprio e só envia
 * lotes de detecção (`deteccao.enviar`).
 */
export function TokensIntegracaoSecao() {
  const consulta = useIntegracoesTokensListar();
  const [criando, setCriando] = useState(false);
  const [criado, setCriado] = useState<TokenCriado | null>(null);
  const [revogando, setRevogando] = useState<TokenIntegracao | null>(null);
  return (
    <section aria-labelledby="titulo-tokens" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-tokens" className="text-base font-semibold">
          Tokens de integração
        </h2>
        <Botao variante="secundario" onClick={() => setCriando(true)}>
          <KeyRound /> Novo token
        </Botao>
      </div>
      <p className="mb-2 text-sm text-texto-suave">
        Um token deixa o projeto de detecção enviar lotes pela API (
        <code>Authorization: Token …</code>
        ), apenas dentro do escopo territorial escolhido. O valor é mostrado uma só vez.
      </p>
      {consulta.isPending ? (
        <Carregando linhas={2} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} />
      ) : consulta.data.data.length === 0 ? (
        <Vazio titulo="Nenhum token de integração" />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Token</Th>
              <Th cartao="oculta">Escopo</Th>
              <Th cartao="oculta">Último uso</Th>
              <Th>Situação</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {consulta.data.data.map((t) => (
              <Linha key={t.id}>
                <Td>
                  {t.nome}
                  <p className="text-xs text-texto-suave">
                    {t.total_lotes} lote(s) · criado por {t.criado_por_nome || "—"}
                  </p>
                </Td>
                <Td>
                  <code className="text-xs">{t.prefixo}…</code>
                </Td>
                <Td>{t.territorios.map((x) => x.nome).join(", ")}</Td>
                <Td>{t.ultimo_uso_em ? formatarDataHora(t.ultimo_uso_em) : "Nunca usado"}</Td>
                <Td>
                  {t.ativo ? (
                    <Selo tom="sucesso">Ativo</Selo>
                  ) : (
                    <Selo tom="neutro">
                      Revogado{t.revogado_em ? ` em ${formatarDataHora(t.revogado_em)}` : ""}
                    </Selo>
                  )}
                </Td>
                <Td>
                  {t.ativo && (
                    <Botao
                      variante="perigoContorno"
                      tamanho="pequeno"
                      onClick={() => setRevogando(t)}
                    >
                      Revogar
                    </Botao>
                  )}
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}
      {criando && (
        <NovoTokenDialogo
          aoFechar={() => setCriando(false)}
          aoCriar={(t) => {
            setCriando(false);
            setCriado(t);
          }}
        />
      )}
      {criado && <ValorDoToken token={criado} aoFechar={() => setCriado(null)} />}
      {revogando && <RevogarDialogo token={revogando} aoFechar={() => setRevogando(null)} />}
    </section>
  );
}

function NovoTokenDialogo({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: (t: TokenCriado) => void;
}) {
  const cliente = useQueryClient();
  const territorios = useOpcoesTerritorio();
  const [nome, setNome] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const criar = useIntegracoesTokensCriar<ErroApi>();
  const pronto = nome.trim() && escolhidos.length > 0;
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Novo token de integração"
      descricao="Escolha um nome e o escopo territorial. O token só poderá enviar detecções dentro dele."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!pronto || criar.isPending}
            onClick={() =>
              criar.mutate(
                { data: { nome: nome.trim(), territorios_ids: escolhidos } },
                {
                  onSuccess: (r) => {
                    void invalidarCaminhos(cliente, "/api/v1/admin/integracoes");
                    aoCriar(r.data);
                  },
                },
              )
            }
          >
            Criar token
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Campo rotulo="Nome da integração" obrigatorio>
          {(p) => <Entrada {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Campo>
        <ListaMarcavel
          legenda="Escopo territorial"
          opcoes={territorios.opcoes}
          selecionados={escolhidos}
          aoAlterar={setEscolhidos}
          vazio="Nenhum território importado ainda."
          className="max-h-56 overflow-y-auto"
        />
      </div>
      {criar.isError && (
        <p role="alert" className="mt-2 text-sm text-perigo">
          {criar.error.message}
        </p>
      )}
    </Dialogo>
  );
}

function ValorDoToken({ token, aoFechar }: { token: TokenCriado; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo="Token criado"
      descricao="Copie agora: este valor não será mostrado de novo. Se perdê-lo, revogue o token e crie outro."
      rodape={<Botao onClick={aoFechar}>Já guardei o token</Botao>}
    >
      <p className="mb-2 text-sm">
        Token de <strong>{token.nome}</strong>
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="valor-do-token"
          className="min-w-0 flex-1 rounded-md border border-borda bg-fundo px-2 py-1.5 text-xs break-all"
        >
          {token.token}
        </code>
        <Botao
          variante="secundario"
          aria-label="Copiar o token"
          onClick={() => {
            void navigator.clipboard?.writeText(token.token).then(() => setCopiado(true));
          }}
        >
          <Copy /> {copiado ? "Copiado" : "Copiar"}
        </Botao>
      </div>
    </Dialogo>
  );
}

function RevogarDialogo({ token, aoFechar }: { token: TokenIntegracao; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const revogar = useIntegracoesTokensRevogar<ErroApi>();
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Revogar ${token.nome}`}
      descricao="A partir de agora, qualquer envio com este token é recusado. Não dá para desfazer."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={revogar.isPending}
            onClick={() =>
              revogar.mutate(
                { id: token.id },
                {
                  onSuccess: () => {
                    void invalidarCaminhos(cliente, "/api/v1/admin/integracoes");
                    aoFechar();
                  },
                },
              )
            }
          >
            Revogar token
          </Botao>
        </>
      }
    >
      {revogar.isError && (
        <p role="alert" className="text-sm text-perigo">
          {revogar.error.message}
        </p>
      )}
    </Dialogo>
  );
}
