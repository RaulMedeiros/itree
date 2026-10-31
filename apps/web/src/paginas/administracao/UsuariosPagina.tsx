import { PapelEnum, useUsuariosListar } from "@itree/api-client";
import { ROTULOS_PAPEL } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarDataHora } from "../../util/formatos";
import { PreCadastroDialogo } from "./PreCadastroDialogo";

const TAMANHO = 50;

export interface BuscaUsuarios {
  busca?: string;
  papel?: PapelEnum;
  situacao?: "ativos" | "desativados";
  pagina?: number;
}

export function UsuariosPagina() {
  const filtros = useSearch({ from: "/autenticado/administracao/usuarios" });
  const navegar = useNavigate({ from: "/administracao/usuarios" });
  const [preCadastro, setPreCadastro] = useState(false);
  const [busca, setBusca] = useState(filtros.busca ?? "");

  // Busca vai para a URL com atraso, para a URL ser compartilhável (RF-SHELL-004).
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filtros.busca ?? "") !== busca) {
        void navegar({
          search: (s: BuscaUsuarios) => ({ ...s, busca: busca || undefined, pagina: undefined }),
        });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [busca, filtros.busca, navegar]);

  const consulta = useUsuariosListar({
    busca: filtros.busca,
    papel: filtros.papel,
    ativo: filtros.situacao === undefined ? undefined : filtros.situacao === "ativos",
    pagina: filtros.pagina,
    tamanho: TAMANHO,
  });

  const filtrar = (parcial: Partial<BuscaUsuarios>) =>
    void navegar({ search: (s: BuscaUsuarios) => ({ ...s, ...parcial, pagina: undefined }) });

  const filtrando = Boolean(filtros.busca || filtros.papel || filtros.situacao);

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="A identidade e a senha são do provedor de login; papéis e escopo territorial são definidos aqui."
        acoes={
          <Botao onClick={() => setPreCadastro(true)}>
            <UserPlus /> Pré-cadastrar usuário
          </Botao>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Entrada
          type="search"
          aria-label="Buscar por nome ou e-mail"
          placeholder="Buscar por nome ou e-mail"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-72"
        />
        <Selecao
          aria-label="Filtrar por papel"
          value={filtros.papel ?? ""}
          onChange={(e) =>
            filtrar({ papel: (e.target.value || undefined) as PapelEnum | undefined })
          }
          className="max-w-56"
        >
          <option value="">Todos os papéis</option>
          {Object.values(PapelEnum).map((p) => (
            <option key={p} value={p}>
              {ROTULOS_PAPEL[p]}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Filtrar por situação"
          value={filtros.situacao ?? ""}
          onChange={(e) =>
            filtrar({ situacao: (e.target.value || undefined) as BuscaUsuarios["situacao"] })
          }
          className="max-w-52"
        >
          <option value="">Todas as situações</option>
          <option value="ativos">Ativos</option>
          <option value="desativados">Desativados</option>
        </Selecao>
      </div>

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        filtrando ? (
          <Vazio titulo="Nenhum usuário corresponde aos filtros">
            Ajuste ou limpe os filtros para ver mais resultados.
          </Vazio>
        ) : (
          <Vazio
            titulo="Nenhum usuário cadastrado"
            acao={<Botao onClick={() => setPreCadastro(true)}>Pré-cadastrar usuário</Botao>}
          >
            Usuários aparecem aqui ao entrar pela primeira vez ou quando pré-cadastrados.
          </Vazio>
        )
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Usuário</Th>
                <Th>Papéis</Th>
                <Th>Escopo territorial</Th>
                <Th>Equipes</Th>
                <Th>Situação</Th>
                <Th>Último acesso</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((u) => (
                <Linha key={u.id} className="hover:bg-fundo">
                  <Td>
                    <Link
                      to="/administracao/usuarios/$id"
                      params={{ id: u.id }}
                      className="font-medium text-marca-escura hover:underline"
                    >
                      {u.nome || u.email}
                    </Link>
                    {u.nome && <p className="text-xs text-texto-suave">{u.email}</p>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.papeis?.length ? (
                        u.papeis.map((p) => <Selo key={p}>{ROTULOS_PAPEL[p]}</Selo>)
                      ) : (
                        <Selo tom="atencao">Sem papéis — sem acesso</Selo>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {u.territorios.length ? (
                      u.territorios.map((t) => t.nome).join(", ")
                    ) : (
                      <span className="text-texto-suave">Nenhum</span>
                    )}
                  </Td>
                  <Td>
                    {u.equipes.length ? (
                      u.equipes.join(", ")
                    ) : (
                      <span className="text-texto-suave">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      {u.ativo ? (
                        <Selo tom="sucesso">Ativo</Selo>
                      ) : (
                        <Selo tom="perigo">Desativado</Selo>
                      )}
                      {!u.vinculado && <Selo tom="info">Aguardando primeiro acesso</Selo>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatarDataHora(u.last_login) ?? (
                      <span className="text-texto-suave">Nunca</span>
                    )}
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(pagina) => void navegar({ search: (s: BuscaUsuarios) => ({ ...s, pagina }) })}
          />
        </>
      )}
      <PreCadastroDialogo aberto={preCadastro} aoMudar={setPreCadastro} />
    </>
  );
}
