import re
from datetime import datetime

from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_field,
    extend_schema_view,
)
from pghistory.models import Events
from rest_framework import generics, serializers
from rest_framework.exceptions import ValidationError

from itree.contas.acesso import requer
from itree.contas.permissoes import Permissao

# Modelos de evento -> nome legível da entidade auditada.
ENTIDADES = {
    "contas.UsuarioEvent": "Usuário",
    "contas.EscopoUsuarioEvent": "Escopo de usuário",
    "contas.EquipeEvent": "Equipe",
    "contas.MembroEquipeEvent": "Membro de equipe",
    "contas.TerritorioEquipeEvent": "Território de equipe",
    "territorio.TerritorioEvent": "Território",
    "areas_verdes.AreaVerdeEvent": "Área verde",
    "inventario.EspecieEvent": "Espécie",
    "inventario.ArvoreEvent": "Árvore",
    "inventario.IdentificadorExternoEvent": "Identificador externo",
    "inventario.MedidaEvent": "Medida",
    "inventario.LoteImportacaoEvent": "Lote de importação",
    "inventario.ParNaoDuplicadoEvent": "Par revisado (não duplicado)",
    "ocorrencias.TipoOcorrenciaEvent": "Tipo de ocorrência",
    "ocorrencias.OcorrenciaEvent": "Ocorrência",
    "evidencias.EvidenciaEvent": "Evidência",
    "inspecoes.InspecaoEvent": "Inspeção",
    "tarefas.TarefaEvent": "Tarefa",
    "alertas.AlertaAmbientalEvent": "Alerta ambiental",
    "relatorios.ExportacaoEvent": "Exportação",
    "qualidade.InferenciaIAEvent": "Sugestão de IA",
}

# Prefixo do código legível -> modelo de evento (RF-ADM-003: busca por registro).
PREFIXOS_CODIGO = {
    "ARV": "inventario.ArvoreEvent",
    "OCO": "ocorrencias.OcorrenciaEvent",
    "INS": "inspecoes.InspecaoEvent",
    "TAR": "tarefas.TarefaEvent",
    "ALR": "alertas.AlertaAmbientalEvent",
}
MODELO_PARA_PREFIXO = {modelo: prefixo for prefixo, modelo in PREFIXOS_CODIGO.items()}
CODIGO_RE = re.compile(r"^\s*([A-Za-z]{3})-?0*(\d+)\s*$")

ACOES = {"insert": "criacao", "update": "alteracao", "delete": "exclusao"}


# Campos volumosos substituídos por um marcador na listagem.
CAMPOS_RESUMIDOS = {"geom": "(geometria)"}


def _resumir(valor):
    if not isinstance(valor, dict):
        return valor
    return {
        campo: (CAMPOS_RESUMIDOS[campo] if campo in CAMPOS_RESUMIDOS else v)
        for campo, v in valor.items()
    }


class EventoAuditoriaSerializer(serializers.Serializer):
    id = serializers.CharField(source="pgh_slug")
    momento = serializers.DateTimeField(source="pgh_created_at")
    entidade = serializers.SerializerMethodField()
    entidade_modelo = serializers.CharField(source="pgh_obj_model")
    objeto_id = serializers.CharField(source="pgh_obj_id", allow_null=True)
    registro = serializers.SerializerMethodField(
        help_text="Código legível do registro afetado (ARV-, OCO-, INS-, TAR-, ALR-), se houver."
    )
    acao = serializers.SerializerMethodField()
    diferencas = serializers.SerializerMethodField(
        help_text="Campo -> [valor anterior, valor novo] (alterações)."
    )
    dados = serializers.SerializerMethodField(help_text="Estado após o evento.")
    autor_nome = serializers.SerializerMethodField(
        help_text="Nome de quem fez a alteração, quando feita por um usuário."
    )
    contexto = serializers.JSONField(
        source="pgh_context",
        allow_null=True,
        help_text="Usuário, origem (web/app/api), URL, motivo e outros metadados.",
    )

    @extend_schema_field(serializers.JSONField(allow_null=True))
    def get_diferencas(self, obj):
        return _resumir(obj.pgh_diff)

    @extend_schema_field(serializers.JSONField())
    def get_dados(self, obj):
        return _resumir(obj.pgh_data)

    def get_autor_nome(self, obj) -> str | None:
        usuario_id = (obj.pgh_context or {}).get("user")
        if not usuario_id:
            return None
        nomes = self.context.setdefault("_nomes_autores", {})
        if usuario_id not in nomes:
            from itree.contas.models import Usuario

            u = Usuario.objects.filter(pk=usuario_id).only("nome", "email").first()
            nomes[usuario_id] = (u.nome or u.email) if u else None
        return nomes[usuario_id]

    def get_entidade(self, obj) -> str:
        return ENTIDADES.get(obj.pgh_model, obj.pgh_model)

    def get_registro(self, obj) -> str | None:
        prefixo = MODELO_PARA_PREFIXO.get(obj.pgh_model)
        numero = (obj.pgh_data or {}).get("numero")
        if not prefixo or not numero:
            return None
        return f"{prefixo}-{int(numero):06d}"

    def get_acao(self, obj) -> str:
        return ACOES.get(obj.pgh_label, obj.pgh_label)


def _data(valor: str | None, nome: str):
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor)
    except ValueError as exc:
        raise ValidationError({nome: "Use o formato ISO 8601."}) from exc


@extend_schema_view(
    get=extend_schema(
        operation_id="auditoria_listar",
        parameters=[
            OpenApiParameter("entidade", str, description=f"Um de: {', '.join(ENTIDADES)}"),
            OpenApiParameter("objeto", str, description="ID do objeto auditado."),
            OpenApiParameter("codigo", str, description="Código do registro, ex.: OCO-000014."),
            OpenApiParameter("usuario", str, description="ID do usuário autor."),
            OpenApiParameter("origem", str, description="web | app | api"),
            OpenApiParameter("desde", str, description="ISO 8601"),
            OpenApiParameter("ate", str, description="ISO 8601"),
        ],
    )
)
class AuditoriaListView(generics.ListAPIView):
    """Trilha de auditoria (RF-ADM-003). Somente leitura: eventos não podem ser
    alterados nem removidos pela aplicação (RNF-SEG-004)."""

    serializer_class = EventoAuditoriaSerializer
    permission_classes = [requer(Permissao.ADMIN_AUDITORIA)]

    def get_queryset(self):
        p = self.request.query_params
        modelos = [p["entidade"]] if p.get("entidade") in ENTIDADES else list(ENTIDADES)
        codigo = p.get("codigo")
        if codigo:
            achado = CODIGO_RE.match(codigo)
            modelo = PREFIXOS_CODIGO.get(achado.group(1).upper()) if achado else None
            if not modelo or modelo not in modelos:
                return Events.objects.none()
            modelos = [modelo]
        qs = Events.objects.across(*modelos)
        if codigo:
            qs = qs.filter(pgh_data__numero=int(achado.group(2)))
        if objeto := p.get("objeto"):
            qs = qs.filter(pgh_obj_id=objeto)
        if usuario := p.get("usuario"):
            qs = qs.filter(pgh_context__user=usuario)
        if origem := p.get("origem"):
            qs = qs.filter(pgh_context__origem=origem)
        if desde := _data(p.get("desde"), "desde"):
            qs = qs.filter(pgh_created_at__gte=desde)
        if ate := _data(p.get("ate"), "ate"):
            qs = qs.filter(pgh_created_at__lte=ate)
        return qs.order_by("-pgh_created_at", "-pgh_id")
