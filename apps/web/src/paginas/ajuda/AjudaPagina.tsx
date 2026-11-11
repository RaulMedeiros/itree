import { DetalhesTecnicos } from "../../componentes/DetalhesTecnicos";
import { GLOSSARIO } from "../../ajuda/glossario";
import { CabecalhoPagina } from "../../ui/pagina";

/** Glossário do domínio (G-06): o que cada termo das telas quer dizer, em linguagem corrente. */
export function AjudaPagina() {
  return (
    <div className="mx-auto max-w-3xl">
      <CabecalhoPagina
        titulo="Ajuda"
        descricao="O que significam os termos que aparecem nas telas. Nas telas, o ícone “?” ao lado do termo abre a mesma definição."
      />
      <nav aria-label="Termos do glossário" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {GLOSSARIO.map((t) => (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                className="inline-block rounded-md border border-borda bg-superficie px-2.5 py-1 text-sm hover:border-marca hover:text-marca-escura"
              >
                {t.termo}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-4">
        {GLOSSARIO.map((t) => (
          <section
            key={t.id}
            id={t.id}
            aria-labelledby={`termo-${t.id}`}
            className="scroll-mt-4 rounded-lg border border-borda bg-superficie p-4"
          >
            <h2 id={`termo-${t.id}`} className="text-base font-semibold">
              {t.termo}
            </h2>
            <div className="mt-1 flex flex-col gap-1.5 text-sm">
              <p>{t.definicao}</p>
              {t.detalhes?.map((d) => (
                <p key={d} className="text-texto-suave">
                  {d}
                </p>
              ))}
              <DetalhesTecnicos>Regras de origem: {t.regras.join(", ")}.</DetalhesTecnicos>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
