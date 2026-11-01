from django.conf import settings
from django.db import transaction
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.territorio.models import Territorio
from itree.territorio.serializers import TerritorioResumoSerializer

from .acesso import limpar_cache_escopo
from .models import Equipe, EscopoUsuario, MembroEquipe, TerritorioEquipe, Usuario
from .permissoes import Papel, Permissao


class UsuarioResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Usuario
        fields = ["id", "nome", "email"]


class EuSerializer(serializers.ModelSerializer):
    """Usuário autenticado, com permissões efetivas e escopo (usado pela
    interface para montar navegação; a autorização real é no servidor)."""

    papeis = serializers.ListField(child=serializers.ChoiceField(choices=Papel.choices))
    permissoes = serializers.SerializerMethodField()
    territorios = TerritorioResumoSerializer(many=True, read_only=True)
    ambiente = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = ["id", "nome", "email", "papeis", "permissoes", "territorios", "ambiente"]

    @extend_schema_field(
        serializers.ListField(child=serializers.ChoiceField(choices=Permissao.choices))
    )
    def get_permissoes(self, obj: Usuario) -> list[str]:
        return sorted(obj.permissoes)

    def get_ambiente(self, obj: Usuario) -> str:
        return settings.AMBIENTE


class MotivoMixin(serializers.Serializer):
    motivo = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=500,
        help_text="Justificativa registrada na auditoria.",
    )


class UsuarioAdminSerializer(MotivoMixin, serializers.ModelSerializer):
    papeis = serializers.ListField(
        child=serializers.ChoiceField(choices=Papel.choices), required=False
    )
    territorios = TerritorioResumoSerializer(many=True, read_only=True)
    territorio_ids = serializers.PrimaryKeyRelatedField(
        source="territorios",
        queryset=Territorio.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )
    ativo = serializers.BooleanField(source="is_active", required=False)
    vinculado = serializers.SerializerMethodField(
        help_text="Se o usuário já entrou ao menos uma vez pelo provedor de identidade."
    )
    equipes = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = [
            "id",
            "nome",
            "email",
            "papeis",
            "registro_profissional",
            "ativo",
            "territorios",
            "territorio_ids",
            "equipes",
            "vinculado",
            "date_joined",
            "last_login",
            "motivo",
        ]
        read_only_fields = ["date_joined", "last_login"]

    def get_vinculado(self, obj: Usuario) -> bool:
        return bool(obj.oidc_sub)

    def get_equipes(self, obj: Usuario) -> list[str]:
        return [e.nome for e in obj.equipes.all()]

    def validate_email(self, valor: str) -> str:
        valor = valor.strip().lower()
        if self.instance and self.instance.email != valor and self.instance.oidc_sub:
            raise serializers.ValidationError(
                "O e-mail de um usuário já vinculado é gerenciado pelo provedor de identidade."
            )
        return valor

    def validate_papeis(self, valor: list[str]) -> list[str]:
        return sorted(set(valor))

    def validate(self, attrs):
        usuario = self.context["request"].user
        alvo = self.instance
        if alvo and alvo.pk == usuario.pk:
            if attrs.get("is_active") is False:
                raise serializers.ValidationError({"ativo": "Você não pode desativar a si mesmo."})
            if "papeis" in attrs and Papel.ADMINISTRADOR not in attrs["papeis"]:
                raise serializers.ValidationError(
                    {"papeis": "Você não pode remover o próprio papel de administrador."}
                )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop("motivo", None)
        territorios = validated_data.pop("territorios", [])
        validated_data["username"] = validated_data["email"]
        usuario = Usuario.objects.create(**validated_data)
        usuario.set_unusable_password()
        usuario.save(update_fields=["password"])
        self._definir_territorios(usuario, territorios)
        return usuario

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("motivo", None)
        territorios = validated_data.pop("territorios", None)
        instance = super().update(instance, validated_data)
        if territorios is not None:
            self._definir_territorios(instance, territorios)
        return instance

    @staticmethod
    def _definir_territorios(usuario: Usuario, territorios: list[Territorio]) -> None:
        novos = {t.pk for t in territorios}
        EscopoUsuario.objects.filter(usuario=usuario).exclude(territorio_id__in=novos).delete()
        existentes = set(
            EscopoUsuario.objects.filter(usuario=usuario).values_list("territorio_id", flat=True)
        )
        EscopoUsuario.objects.bulk_create(
            [EscopoUsuario(usuario=usuario, territorio_id=t) for t in novos - existentes]
        )
        limpar_cache_escopo()


class EquipeSerializer(MotivoMixin, serializers.ModelSerializer):
    coordenador = UsuarioResumoSerializer(read_only=True, allow_null=True)
    coordenador_id = serializers.PrimaryKeyRelatedField(
        source="coordenador",
        queryset=Usuario.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    membros = UsuarioResumoSerializer(many=True, read_only=True)
    membro_ids = serializers.PrimaryKeyRelatedField(
        source="membros",
        queryset=Usuario.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )
    territorios = TerritorioResumoSerializer(many=True, read_only=True)
    territorio_ids = serializers.PrimaryKeyRelatedField(
        source="territorios",
        queryset=Territorio.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = Equipe
        fields = [
            "id",
            "nome",
            "descricao",
            "ativa",
            "coordenador",
            "coordenador_id",
            "membros",
            "membro_ids",
            "territorios",
            "territorio_ids",
            "criado_em",
            "atualizado_em",
            "motivo",
        ]
        read_only_fields = ["criado_em", "atualizado_em"]

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop("motivo", None)
        membros = validated_data.pop("membros", [])
        territorios = validated_data.pop("territorios", [])
        equipe = Equipe.objects.create(**validated_data)
        self._sincronizar(equipe, membros, territorios)
        return equipe

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("motivo", None)
        membros = validated_data.pop("membros", None)
        territorios = validated_data.pop("territorios", None)
        instance = super().update(instance, validated_data)
        self._sincronizar(instance, membros, territorios)
        return instance

    @staticmethod
    def _sincronizar(equipe: Equipe, membros, territorios) -> None:
        if membros is not None:
            ids = {u.pk for u in membros}
            MembroEquipe.objects.filter(equipe=equipe).exclude(usuario_id__in=ids).delete()
            atuais = set(equipe.membros_rel.values_list("usuario_id", flat=True))
            MembroEquipe.objects.bulk_create(
                [MembroEquipe(equipe=equipe, usuario_id=i) for i in ids - atuais]
            )
        if territorios is not None:
            ids = {t.pk for t in territorios}
            TerritorioEquipe.objects.filter(equipe=equipe).exclude(territorio_id__in=ids).delete()
            atuais = set(equipe.territorios_rel.values_list("territorio_id", flat=True))
            TerritorioEquipe.objects.bulk_create(
                [TerritorioEquipe(equipe=equipe, territorio_id=i) for i in ids - atuais]
            )
