import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Arquivos que combinam componentes com hooks/configuração de rotas.
    files: [
      "src/rotas.tsx",
      "src/acesso/ContextoUsuario.tsx",
      "src/componentes/Historico.tsx",
      "src/componentes/selos.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
