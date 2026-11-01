"""Catálogo de papéis e permissões (T-03).

A matriz abaixo é **provisória** até a decisão DP-01. Ela vive no código para
que toda mudança passe por revisão e fique no histórico do repositório.
Permissão efetiva = papéis (união) × escopo territorial (aplicado nas consultas).
"""

from django.db import models


class Papel(models.TextChoices):
    GESTOR = "gestor", "Gestor municipal"
    COORDENADOR = "coordenador", "Coordenador de equipe"
    REVISOR = "revisor", "Técnico revisor"
    ANALISTA_AMBIENTAL = "analista_ambiental", "Analista ambiental"
    TECNICO = "tecnico", "Técnico de campo"
    CONSULTA = "consulta", "Consulta"
    ADMINISTRADOR = "administrador", "Administrador"


class Permissao(models.TextChoices):
    MAPA_LER = "mapa.ler", "Ver mapa"
    INVENTARIO_LER = "inventario.ler", "Ver inventário"
    INVENTARIO_EDITAR = "inventario.editar", "Cadastrar e editar árvores"
    INVENTARIO_FUNDIR_EXCLUIR = "inventario.fundir_excluir", "Fundir ou excluir árvores"
    INVENTARIO_IMPORTAR = "inventario.importar", "Importar inventário em lote"
    INSPECOES_LER = "inspecoes.ler", "Ver inspeções"
    INSPECOES_EXECUTAR = "inspecoes.executar", "Executar inspeções (aplicativo)"
    INSPECOES_VALIDAR = "inspecoes.validar", "Revisar e validar inspeções"
    OCORRENCIAS_LER = "ocorrencias.ler", "Ver ocorrências"
    OCORRENCIAS_EDITAR = "ocorrencias.editar", "Registrar e editar ocorrências"
    OCORRENCIAS_PRIORIZAR = "ocorrencias.priorizar", "Definir prioridade operacional"
    OCORRENCIAS_CONFIRMAR_RISCO = "ocorrencias.confirmar_risco", "Registrar risco confirmado"
    ALERTAS_LER = "alertas.ler", "Ver alertas ambientais"
    ALERTAS_TRIAR = "alertas.triar", "Triar alertas ambientais"
    TAREFAS_LER = "tarefas.ler", "Ver equipes e tarefas"
    TAREFAS_EDITAR = "tarefas.editar", "Criar e atribuir tarefas"
    RELATORIOS_LER = "relatorios.ler", "Ver análises e relatórios"
    RELATORIOS_EXPORTAR = "relatorios.exportar", "Exportar dados"
    ADMIN_USUARIOS = "admin.usuarios", "Administrar usuários e papéis"
    ADMIN_EQUIPES = "admin.equipes", "Administrar equipes"
    ADMIN_AUDITORIA = "admin.auditoria", "Consultar auditoria"
    ADMIN_TERRITORIOS = "admin.territorios", "Administrar territórios"
    ADMIN_CONFIGURACAO = "admin.configuracao", "Administrar catálogos e integrações"


P = Permissao

MATRIZ: dict[str, frozenset[str]] = {
    Papel.GESTOR: frozenset(
        {
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.INSPECOES_LER,
            P.OCORRENCIAS_LER,
            P.OCORRENCIAS_EDITAR,
            P.OCORRENCIAS_PRIORIZAR,
            P.ALERTAS_LER,
            P.TAREFAS_LER,
            P.RELATORIOS_LER,
            P.RELATORIOS_EXPORTAR,
        }
    ),
    Papel.COORDENADOR: frozenset(
        {
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.INSPECOES_LER,
            P.OCORRENCIAS_LER,
            P.OCORRENCIAS_EDITAR,
            P.OCORRENCIAS_PRIORIZAR,
            P.TAREFAS_LER,
            P.TAREFAS_EDITAR,
            P.RELATORIOS_LER,
            P.RELATORIOS_EXPORTAR,
        }
    ),
    Papel.REVISOR: frozenset(
        {
            P.INSPECOES_EXECUTAR,
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.INVENTARIO_EDITAR,
            P.INVENTARIO_FUNDIR_EXCLUIR,
            P.INVENTARIO_IMPORTAR,
            P.INSPECOES_LER,
            P.INSPECOES_VALIDAR,
            P.OCORRENCIAS_LER,
            P.OCORRENCIAS_EDITAR,
            P.OCORRENCIAS_CONFIRMAR_RISCO,
            P.TAREFAS_LER,
            P.RELATORIOS_LER,
        }
    ),
    Papel.ANALISTA_AMBIENTAL: frozenset(
        {
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.OCORRENCIAS_LER,
            P.ALERTAS_LER,
            P.ALERTAS_TRIAR,
            P.TAREFAS_LER,
            P.RELATORIOS_LER,
            P.RELATORIOS_EXPORTAR,
        }
    ),
    Papel.TECNICO: frozenset(
        {
            P.INSPECOES_EXECUTAR,
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.INVENTARIO_EDITAR,
            P.INSPECOES_LER,
            P.OCORRENCIAS_LER,
            P.OCORRENCIAS_EDITAR,
            P.TAREFAS_LER,
        }
    ),
    Papel.CONSULTA: frozenset(
        {
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.OCORRENCIAS_LER,
            P.ALERTAS_LER,
            P.RELATORIOS_LER,
        }
    ),
    Papel.ADMINISTRADOR: frozenset(
        {
            P.MAPA_LER,
            P.INVENTARIO_LER,
            P.INVENTARIO_FUNDIR_EXCLUIR,
            P.INVENTARIO_IMPORTAR,
            P.INSPECOES_LER,
            P.OCORRENCIAS_LER,
            P.ALERTAS_LER,
            P.TAREFAS_LER,
            P.TAREFAS_EDITAR,
            P.RELATORIOS_LER,
            P.ADMIN_USUARIOS,
            P.ADMIN_EQUIPES,
            P.ADMIN_AUDITORIA,
            P.ADMIN_TERRITORIOS,
            P.ADMIN_CONFIGURACAO,
        }
    ),
}

# Permissões que, além do papel, exigem qualificação técnica registrada no
# usuário (T-03, nota "*"; DP-05).
EXIGEM_QUALIFICACAO = frozenset({P.OCORRENCIAS_CONFIRMAR_RISCO})


def permissoes_efetivas(papeis: list[str], qualificado: bool) -> frozenset[str]:
    efetivas: set[str] = set()
    for papel in papeis:
        efetivas |= MATRIZ.get(papel, frozenset())
    if not qualificado:
        efetivas -= EXIGEM_QUALIFICACAO
    return frozenset(efetivas)
