from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView
from rest_framework.routers import DefaultRouter

from itree.auditoria.views import AuditoriaListView
from itree.contas.views import EquipeViewSet, UsuarioAdminViewSet, eu
from itree.core.views import saude
from itree.evidencias.views import EvidenciaViewSet
from itree.inventario.views import ArvoreViewSet, EspecieViewSet, ImportacaoViewSet
from itree.mapa import views as mapa
from itree.ocorrencias.views import OcorrenciaViewSet, TipoOcorrenciaViewSet
from itree.territorio.views import TerritorioViewSet

roteador = DefaultRouter(trailing_slash=False)
roteador.include_root_view = False
roteador.register("territorios", TerritorioViewSet, basename="territorio")
roteador.register("equipes", EquipeViewSet, basename="equipe")
roteador.register("admin/usuarios", UsuarioAdminViewSet, basename="usuario-admin")
roteador.register("especies", EspecieViewSet, basename="especie")
roteador.register("arvores", ArvoreViewSet, basename="arvore")
roteador.register("importacoes", ImportacaoViewSet, basename="importacao")
roteador.register("tipos-ocorrencia", TipoOcorrenciaViewSet, basename="tipo-ocorrencia")
roteador.register("ocorrencias", OcorrenciaViewSet, basename="ocorrencia")
roteador.register("evidencias", EvidenciaViewSet, basename="evidencia")

api_v1 = [
    path("saude", saude, name="saude"),
    path("eu", eu, name="eu"),
    path("admin/auditoria", AuditoriaListView.as_view(), name="auditoria"),
    path("mapa/tiles/<str:camada>/<int:z>/<int:x>/<int:y>", mapa.tile, name="mapa-tile"),
    path("mapa/busca", mapa.busca, name="mapa-busca"),
    path("mapa/camadas", mapa.camadas, name="mapa-camadas"),
    path("", include(roteador.urls)),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
    path("django-admin/", admin.site.urls),
]

if settings.DEBUG:
    # Em produção o contrato é gerado no build (manage.py spectacular).
    urlpatterns.append(path("api/schema", SpectacularAPIView.as_view(), name="schema"))
