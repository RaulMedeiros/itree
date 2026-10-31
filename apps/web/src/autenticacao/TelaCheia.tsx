import type { ReactNode } from "react";

export function TelaCheia({
  titulo,
  children,
  carregando,
}: {
  titulo: string;
  children?: ReactNode;
  carregando?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div role={carregando ? "status" : undefined} className="max-w-md text-center">
        <img src="/icone.svg" alt="" className="mx-auto mb-4 size-10" />
        <h1 className="text-lg font-semibold">{titulo}</h1>
        {children && <div className="mt-2 text-sm text-texto-suave">{children}</div>}
      </div>
    </main>
  );
}
