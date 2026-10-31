import pghistory
from django.contrib.auth.models import AbstractUser, UserManager
from django.contrib.postgres.fields import ArrayField
from django.db import models

from itree.core.ids import uuid7
from itree.core.models import ModeloBase

from .permissoes import Papel, permissoes_efetivas


def _eventos() -> tuple:
    """Rastreadores de auditoria. Cada modelo precisa de instâncias próprias."""
    return (pghistory.InsertEvent(), pghistory.UpdateEvent(), pghistory.DeleteEvent())


@pghistory.track(*_eventos(), exclude=["password", "last_login"])
class Usuario(AbstractUser):
    """Usuário da plataforma.

    A identidade (login, senha, MFA) é do provedor OIDC; papéis e escopo
    territorial são administrados aqui, com auditoria (W-10).
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    email = models.EmailField(unique=True)
    nome = models.CharField(max_length=200, blank=True)
    oidc_sub = models.CharField(
        max_length=255,
        unique=True,
        null=True,
        blank=True,
        help_text="Identificador do usuário no provedor OIDC.",
    )
    papeis = ArrayField(
        models.CharField(max_length=40, choices=Papel.choices), default=list, blank=True
    )
    registro_profissional = models.CharField(
        max_length=100,
        blank=True,
        help_text="Qualificação técnica (ex.: CREA). Necessária para registrar risco confirmado.",
    )
    territorios = models.ManyToManyField(
        "territorio.Territorio", through="EscopoUsuario", blank=True, related_name="usuarios"
    )

    objects = UserManager()

    class Meta:
        ordering = ["nome", "email"]

    def __str__(self) -> str:
        return self.nome or self.email

    @property
    def permissoes(self) -> frozenset[str]:
        if not self.is_active:
            return frozenset()
        return permissoes_efetivas(self.papeis, qualificado=bool(self.registro_profissional))

    def tem_permissao(self, permissao: str) -> bool:
        return permissao in self.permissoes


@pghistory.track(*_eventos())
class EscopoUsuario(ModeloBase):
    """Território em que o usuário pode atuar. Um território inclui sua área
    inteira (o município cobre todos os bairros)."""

    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="escopos")
    territorio = models.ForeignKey("territorio.Territorio", on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["usuario", "territorio"], name="escopo_unico")
        ]


@pghistory.track(*_eventos())
class Equipe(ModeloBase):
    nome = models.CharField(max_length=200, unique=True)
    descricao = models.TextField(blank=True)
    ativa = models.BooleanField(default=True)
    coordenador = models.ForeignKey(
        Usuario,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="equipes_coordenadas",
    )
    membros = models.ManyToManyField(
        Usuario, through="MembroEquipe", blank=True, related_name="equipes"
    )
    territorios = models.ManyToManyField(
        "territorio.Territorio", through="TerritorioEquipe", blank=True, related_name="equipes"
    )

    class Meta:
        ordering = ["nome"]

    def __str__(self) -> str:
        return self.nome


@pghistory.track(*_eventos())
class MembroEquipe(ModeloBase):
    equipe = models.ForeignKey(Equipe, on_delete=models.CASCADE, related_name="membros_rel")
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="membros_rel")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["equipe", "usuario"], name="membro_unico")]


@pghistory.track(*_eventos())
class TerritorioEquipe(ModeloBase):
    equipe = models.ForeignKey(Equipe, on_delete=models.CASCADE, related_name="territorios_rel")
    territorio = models.ForeignKey("territorio.Territorio", on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["equipe", "territorio"], name="territorio_equipe_unico")
        ]
