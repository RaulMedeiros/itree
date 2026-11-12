"""G-08: exportação CSV das listas, com os filtros e o escopo de quem exporta."""

import csv
import io
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas import fontes
from itree.alertas.models import AlertaAmbiental
from itree.inspecoes.models import Inspecao
from itree.inventario.models import Arvore
from itree.ocorrencias.models import Ocorrencia
from itree.relatorios.models import Exportacao
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario
from .test_f2 import enviada
from .test_f3 import FOCOS

pytestmark = pytest.mark.django_db

OCORRENCIAS = "/api/v1/ocorrencias"
EXPORTAR = "/api/v1/relatorios/exportar"


@pytest.fixture
def coordenador(territorios):
    return com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"])


def ocorrencia(gestor, tipo, ponto=PONTO_A, **extras) -> Ocorrencia:
    return Ocorrencia.objects.create(
        tipo=tipo,
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
        descricao="Galho no passeio",
        origem="web",
        registrada_por=gestor,
        **extras,
    )


def tarefa(coordenador, ponto=PONTO_A, **extras) -> Tarefa:
    geom = Point(ponto["longitude"], ponto["latitude"], srid=4326)
    return Tarefa.objects.create(
        tipo="inspecao_arvore",
        arvore=Arvore.objects.create(geom=geom),
        geom=geom,
        criada_por=coordenador,
        **extras,
    )


# --- G-08: exportação CSV com os filtros e o escopo da lista ---------------------


def linhas_csv(resposta):
    texto = resposta.content.decode("utf-8-sig")
    meta = [linha for linha in texto.splitlines() if linha.startswith("#")]
    dados = [linha for linha in texto.splitlines() if not linha.startswith("#")]
    return meta, list(csv.DictReader(io.StringIO("\n".join(dados)), delimiter=";"))


def exportar(cliente, usuario, conjunto, **filtros):
    return cliente.como(usuario).get(EXPORTAR, {"conjunto": conjunto, "formato": "csv", **filtros})


def test_exporta_ocorrencias_com_os_filtros_e_o_escopo_da_lista(
    cliente, gestor_municipal, territorios, tipo_queda
):
    aberta = ocorrencia(gestor_municipal, tipo_queda)
    ocorrencia(gestor_municipal, tipo_queda, estado="concluida")
    ocorrencia(gestor_municipal, tipo_queda, ponto=PONTO_B)
    na_lista = (
        cliente.como(gestor_municipal).get(OCORRENCIAS, {"estado": "abertas"}).json()["count"]
    )
    filtros = {"estado": "abertas", "pagina": "2", "tamanho": "1"}  # o arquivo ignora a página
    meta, linhas = linhas_csv(exportar(cliente, gestor_municipal, "ocorrencias", **filtros))
    assert len(linhas) == na_lista == 2  # a paginação da lista não corta o arquivo
    assert any("gerado_por" in m for m in meta)
    assert any('"estado": "abertas"' in m for m in meta)  # os filtros vão nos metadados
    assert "pagina" not in "".join(meta)
    # Quem tem escopo só no Bairro A exporta só o que vê na lista.
    gestor_a = com_escopo(criar_usuario("ga@itree.teste", ["gestor"]), territorios["a"])
    _, a_ver = linhas_csv(exportar(cliente, gestor_a, "ocorrencias", estado="abertas"))
    assert [linha["codigo"] for linha in a_ver] == [aberta.codigo]


def test_exportacao_registra_quem_exportou_e_os_filtros(cliente, gestor_municipal, tipo_queda):
    ocorrencia(gestor_municipal, tipo_queda)
    exportar(cliente, gestor_municipal, "ocorrencias", estado="abertas", prioridade="alta")
    registro = Exportacao.objects.get()
    assert registro.usuario_id == gestor_municipal.pk
    assert registro.conjunto == "ocorrencias" and registro.formato == "csv"
    assert registro.filtros == {"estado": "abertas", "prioridade": "alta"}
    assert registro.linhas == 0


def test_exporta_tarefas_com_filtros_e_exige_permissao(
    cliente, coordenador, tecnico_a, territorios
):
    atrasada = tarefa(coordenador, prazo=timezone.localdate() - timedelta(days=2))
    tarefa(coordenador, prazo=timezone.localdate() + timedelta(days=5))
    tarefa(coordenador, estado="concluida")
    _, linhas = linhas_csv(
        exportar(cliente, coordenador, "tarefas", estado="abertas", atrasadas="true")
    )
    assert [linha["codigo"] for linha in linhas] == [atrasada.codigo]
    assert linhas[0]["atrasada"] == "True"
    # `estado` ausente segue o padrão da lista: só as abertas.
    _, abertas = linhas_csv(exportar(cliente, coordenador, "tarefas"))
    assert len(abertas) == 2
    # Técnico de campo lê tarefas, mas não exporta (relatorios.exportar).
    assert exportar(cliente, tecnico_a, "tarefas").status_code == 403


def test_exporta_inspecoes_com_filtros_e_escopo(
    cliente, revisor, tecnico_a, gestor_municipal, territorios
):
    arvore = (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )
    enviada(cliente, tecnico_a, arvore["id"], condicao_aparente="ruim")
    enviada(cliente, tecnico_a, arvore["id"], condicao_aparente="boa")
    assert Inspecao.objects.count() == 2
    na_lista = (
        cliente.como(gestor_municipal)
        .get("/api/v1/inspecoes", {"condicao": "ruim"})
        .json()["count"]
    )
    r = exportar(cliente, gestor_municipal, "inspecoes", condicao="ruim")
    _, linhas = linhas_csv(r)
    assert len(linhas) == na_lista == 1
    assert linhas[0]["condicao_aparente"] == "ruim"
    assert linhas[0]["arvore"] == arvore["codigo"]
    assert Exportacao.objects.get().conjunto == "inspecoes"
    # Fora do escopo: gestor só do Bairro B não vê a inspeção da árvore do Bairro A.
    gestor_b = com_escopo(criar_usuario("gb@itree.teste", ["gestor"]), territorios["b"])
    assert linhas_csv(exportar(cliente, gestor_b, "inspecoes"))[1] == []


def test_exporta_alertas_com_o_filtro_de_status_da_lista(cliente, territorios, gestor_municipal):
    fontes.ingerir("inpe_focos", FOCOS.encode(), "focos.csv")
    total = AlertaAmbiental.objects.count()
    primeiro = AlertaAmbiental.objects.order_by("numero").first()
    primeiro.status = "descartado"
    primeiro.save(update_fields=["status"])
    na_lista = (
        cliente.como(gestor_municipal).get("/api/v1/alertas", {"status": "abertos"}).json()["count"]
    )
    _, linhas = linhas_csv(exportar(cliente, gestor_municipal, "alertas", status="abertos"))
    assert len(linhas) == na_lista == total - 1
    _, todos = linhas_csv(exportar(cliente, gestor_municipal, "alertas"))
    assert len(todos) == total
