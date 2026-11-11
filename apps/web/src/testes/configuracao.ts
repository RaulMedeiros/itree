import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// Sob carga (CI, vários agentes), `findBy` estourava o limite padrão de 1 s.
configure({ asyncUtilTimeout: 4000 });
