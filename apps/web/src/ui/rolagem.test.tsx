import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AreaRolavel } from "./rolagem";

function medidas(el: object, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
}

describe("AreaRolavel", () => {
  it("avisa que há mais conteúdo quando o conteúdo passa da altura", () => {
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(proto, "clientHeight", { configurable: true, value: 200 });
    render(
      <AreaRolavel>
        <p>filtros</p>
      </AreaRolavel>,
    );
    expect(screen.getByTestId("mais-conteudo")).toHaveTextContent("Role para ver mais");
    medidas(proto, 0, 0);
  });

  it("não mostra o aviso quando tudo cabe", () => {
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, "scrollHeight", { configurable: true, value: 100 });
    Object.defineProperty(proto, "clientHeight", { configurable: true, value: 200 });
    render(
      <AreaRolavel>
        <p>filtros</p>
      </AreaRolavel>,
    );
    expect(screen.queryByTestId("mais-conteudo")).toBeNull();
    medidas(proto, 0, 0);
  });
});
