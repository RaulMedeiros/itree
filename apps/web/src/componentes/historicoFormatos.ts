import {
  ROTULOS_CONDICAO,
  ROTULOS_DECISAO_IA,
  ROTULOS_ESTADO_ESPECIE,
  ROTULOS_ESTADO_INSPECAO,
  ROTULOS_ESTADO_LOTE,
  ROTULOS_ESTADO_OCORRENCIA,
  ROTULOS_ESTADO_TAREFA,
  ROTULOS_METODO_MEDIDA,
  ROTULOS_ORIGEM,
  ROTULOS_ORIGEM_INSPECAO,
  ROTULOS_ORIGEM_LOCALIZACAO,
  ROTULOS_ORIGEM_OCORRENCIA,
  ROTULOS_ORIGEM_REGISTRO,
  ROTULOS_ORIGEM_VALOR,
  ROTULOS_PRIORIDADE,
  ROTULOS_SINAL,
  ROTULOS_SITUACAO_ARVORE,
  ROTULOS_STATUS_ALERTA,
  ROTULOS_TIPO_ALERTA,
  ROTULOS_TIPO_MEDIDA,
  ROTULOS_TIPO_TAREFA,
  ROTULOS_TIPO_TERRITORIO,
  ROTULOS_FONTE_ALERTA,
} from "@itree/domain";

import { formatarData, formatarDataHora } from "../util/formatos";

/** Rótulos humanos dos campos auditados (nunca exibir a chave técnica ao usuário). */
export const ROTULOS_CAMPO: Record<string, string> = {
  // comuns
  nome: "Nome",
  descricao: "Descrição",
  observacoes: "Observações",
  observacao: "Observação",
  estado: "Estado",
  status: "Situação",
  situacao: "Situação",
  tipo: "Tipo",
  origem: "Origem",
  prazo: "Prazo",
  prioridade: "Prioridade",
  endereco: "Endereço",
  bairro: "Bairro",
  ativo: "Ativo",
  ativa: "Ativa",
  email: "E-mail",
  papeis: "Papéis",
  responsavel: "Responsável",
  equipe: "Equipe",
  lote: "Lote de importação",
  fonte: "Fonte",
  justificativa: "Justificativa",
  // árvore
  especie: "Espécie",
  especie_estado: "Situação da espécie",
  especie_texto: "Espécie informada",
  especie_texto_original: "Espécie informada na origem",
  localizacao_origem: "Origem da localização",
  precisao_m: "Precisão da localização",
  motivo_situacao: "Motivo da situação",
  condicao_aparente: "Condição aparente",
  condicao_aparente_em: "Condição aparente registrada em",
  ultima_inspecao_em: "Última inspeção em",
  origem_registro: "Origem do registro",
  fundida_em: "Fundida em",
  // medida
  valor: "Valor",
  unidade: "Unidade",
  metodo: "Método",
  data_medicao: "Data da medição",
  aplicada: "Aplicada ao cadastro",
  responsavel_texto: "Responsável pela medição",
  // inspeção
  realizada_em: "Realizada em",
  arvore_confirmada: "Árvore confirmada em campo",
  sinais: "Sinais observados",
  requer_encaminhamento: "Requer encaminhamento",
  motivo_devolucao: "Motivo da devolução",
  validada_em: "Validada em",
  dispositivo: "Dispositivo",
  versao: "Versão",
  recebida_em: "Recebida em",
  aplicado_ao_cadastro: "Aplicada ao cadastro",
  // ocorrência
  prioridade_definida_em: "Prioridade definida em",
  risco_confirmado: "Risco confirmado",
  risco_descricao: "Descrição do risco",
  risco_registrado_em: "Risco registrado em",
  origem_referencia: "Referência da origem",
  concluida_em: "Concluída em",
  prazo_padrao_dias: "Prazo padrão (dias)",
  // tarefa
  motivo_estado: "Motivo do estado",
  // alerta
  id_externo: "Identificador na fonte",
  area_ha: "Área",
  data_deteccao: "Detectado em",
  ingerido_em: "Recebido em",
  url_origem: "Endereço de origem",
  bairros: "Bairros",
  referencia: "Referência",
  // sugestão de IA
  tarefa: "Tarefa",
  modelo: "Modelo",
  versao_modelo: "Versão do modelo",
  resultado: "Resultado",
  alternativas: "Alternativas",
  qualidade_insuficiente: "Qualidade insuficiente",
  orientacao: "Orientação",
  decisao: "Decisão",
  decidida_em: "Decidida em",
  // evidência
  chave: "Arquivo",
  nome_original: "Nome do arquivo",
  tipo_conteudo: "Tipo de arquivo",
  tamanho: "Tamanho",
  capturada_em: "Capturada em",
  // lote de importação
  arquivo_nome: "Arquivo",
  formato: "Formato",
  data_referencia: "Data de referência",
  total_linhas: "Total de linhas",
  linhas_validas: "Linhas válidas",
  confirmado_em: "Confirmado em",
  desfeito_em: "Desfeito em",
  // usuário, equipe e território
  registro_profissional: "Registro profissional",
  territorios: "Territórios",
  membros: "Membros",
  codigo: "Código",
  licenca: "Licença",
  fonte_url: "Endereço da fonte",
  localizacao: "Localização",
};

const UNIDADES_CAMPO: Record<string, string> = { precisao_m: "m", area_ha: "ha" };
const CAMPOS_DECIMAIS = new Set(["precisao_m", "area_ha", "valor"]);

type Rotulos = Record<string, string>;

/** Enums por campo; `estado` e `tipo` dependem da entidade auditada. */
const ESTADO_POR_MODELO: Record<string, Rotulos> = {
  OcorrenciaEvent: ROTULOS_ESTADO_OCORRENCIA,
  InspecaoEvent: ROTULOS_ESTADO_INSPECAO,
  TarefaEvent: ROTULOS_ESTADO_TAREFA,
  LoteImportacaoEvent: ROTULOS_ESTADO_LOTE,
};
const TIPO_POR_MODELO: Record<string, Rotulos> = {
  MedidaEvent: ROTULOS_TIPO_MEDIDA,
  TarefaEvent: ROTULOS_TIPO_TAREFA,
  AlertaAmbientalEvent: ROTULOS_TIPO_ALERTA,
  TerritorioEvent: ROTULOS_TIPO_TERRITORIO,
};
const ORIGEM_POR_MODELO: Record<string, Rotulos> = {
  MedidaEvent: ROTULOS_ORIGEM_VALOR,
  OcorrenciaEvent: ROTULOS_ORIGEM_OCORRENCIA,
  InspecaoEvent: ROTULOS_ORIGEM_INSPECAO,
};
const ENUM_POR_CAMPO: Record<string, Rotulos> = {
  prioridade: ROTULOS_PRIORIDADE,
  metodo: ROTULOS_METODO_MEDIDA,
  sinais: ROTULOS_SINAL,
  condicao_aparente: ROTULOS_CONDICAO,
  localizacao_origem: ROTULOS_ORIGEM_LOCALIZACAO,
  origem_registro: ROTULOS_ORIGEM_REGISTRO,
  especie_estado: ROTULOS_ESTADO_ESPECIE,
  decisao: ROTULOS_DECISAO_IA,
  fonte: ROTULOS_FONTE_ALERTA,
};

const DATA_HORA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+\.\d+$/;

/** "conflito_rede" -> "Conflito rede" quando não há rótulo cadastrado. */
function humanizar(texto: string): string {
  const t = texto.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function rotuloDoCampo(campo: string): string {
  return ROTULOS_CAMPO[campo] ?? humanizar(campo);
}

/**
 * "inventario.Medida" ou "inventario.MedidaEvent" -> "MedidaEvent". A API manda o modelo
 * rastreado ("inventario.Medida"); os mapas abaixo usam o nome do modelo de evento.
 */
const nomeDoModelo = (modelo?: string) => {
  const nome = (modelo ?? "").split(".").pop() ?? "";
  return nome && !nome.endsWith("Event") ? `${nome}Event` : nome;
};

/** Nome do modelo sem o prefixo do app nem o sufixo "Event": "Medida", "Inspecao". */
export const modeloBase = (modelo?: string) => nomeDoModelo(modelo).replace(/Event$/, "");

/**
 * Valor de uma medida com a unidade na mesma linha ("38 cm"). Devolve `undefined`
 * quando a unidade não vem nos dados.
 */
export function valorComUnidade(valor: unknown, unidade: unknown): string | undefined {
  if (ehVazio(valor) || typeof unidade !== "string" || unidade.trim() === "") return undefined;
  return `${formatarValorCampo("valor", valor)} ${unidade.trim()}`;
}

function rotulosDoCampo(campo: string, modelo?: string): Rotulos | undefined {
  const m = nomeDoModelo(modelo);
  if (campo === "estado") return ESTADO_POR_MODELO[m];
  if (campo === "status") return ROTULOS_STATUS_ALERTA;
  if (campo === "situacao") return ROTULOS_SITUACAO_ARVORE;
  if (campo === "tipo") return TIPO_POR_MODELO[m];
  if (campo === "origem") return ORIGEM_POR_MODELO[m] ?? ROTULOS_ORIGEM;
  // Em ocorrência a condição aparente é texto livre.
  if (campo === "condicao_aparente" && m === "OcorrenciaEvent") return undefined;
  return ENUM_POR_CAMPO[campo];
}

export const VAZIO = "—";

/** Valor vazio: nulo, texto em branco ou lista sem itens. */
export function ehVazio(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function umValor(campo: string, v: unknown, modelo?: string): string {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (
    typeof v === "number" ||
    (typeof v === "string" && DECIMAL.test(v) && CAMPOS_DECIMAIS.has(campo))
  ) {
    const n = Number(v);
    const texto = Number.isFinite(n)
      ? n.toLocaleString("pt-BR", { maximumFractionDigits: 6 })
      : String(v);
    const unidade = UNIDADES_CAMPO[campo];
    return unidade ? `${texto} ${unidade}` : texto;
  }
  if (typeof v === "string") {
    if (DATA_HORA_ISO.test(v)) return formatarDataHora(v) ?? v;
    if (DATA_ISO.test(v)) return formatarData(v) ?? v;
    return rotulosDoCampo(campo, modelo)?.[v] ?? (/^[a-z]+(_[a-z]+)+$/.test(v) ? humanizar(v) : v);
  }
  if (v && typeof v === "object") {
    const nome = (v as { nome?: unknown }).nome;
    return nome !== undefined ? String(nome) : JSON.stringify(v);
  }
  return String(v);
}

/** Valor legível em pt-BR: enums com rótulo, datas dd/mm/aaaa, "—" para vazio. */
export function formatarValorCampo(campo: string, v: unknown, modelo?: string): string {
  if (ehVazio(v)) return VAZIO;
  if (Array.isArray(v)) return v.map((item) => umValor(campo, item, modelo)).join(", ");
  return umValor(campo, v, modelo);
}
