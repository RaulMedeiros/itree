from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView
from rest_framework.routers import DefaultRouter

from itree.auditoria.views import AuditoriaListView
from itree.contas.views import EquipeViewSet, UsuarioAdminViewSet, eu
from itree.core.views import saude
from itree.territorio.views import TerritorioViewSet

roteador = DefaultRouter(trailing_slash=False)
roteador.include_root_view = False
roteador.register("territorios", TerritorioViewSet, basename="territorio")
roteador.register("equipes", EquipeViewSet, basename="equipe")
roteador.register("admin/usuarios", UsuarioAdminViewSet, basename="usuario-admin")

api_v1 = [
    path("saude", saude, name="saude"),
    path("eu", eu, name="eu"),
    path("admin/auditoria", AuditoriaListView.as_view(), name="auditoria"),
    path("", include(roteador.urls)),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
    path("django-admin/", admin.site.urls),
]

if settings.DEBUG:
    # Em produção o contrato é gerado no build (manage.py spectacular).
    urlpatterns.append(path("api/schema", SpectacularAPIView.as_view(), name="schema"))
