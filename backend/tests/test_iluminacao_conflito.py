"""Conflito poste × copa: árvores perto da iluminação, poste mais próximo, MVT e permissões.

O raio é provisório (ILUMINACAO_RAIO_CONFLITO_M, padrão 3 m). 0,00001 grau de longitude em
Fortaleza vale cerca de 1,1 m, o que dá a régua dos testes.
"""

import csv
import io

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.iluminacao import servico
from itree.iluminacao.models import LoteIluminacao, PontoIluminacao
from itree.inventario.models import Arvore, SituacaoArvore
from itree.ocorrencias.models import Ocorrencia, TipoOcorrencia

from .conftest import PONTO_A, PONTO_B, criar_usuario
from .mvt_util import decodificar
from .test_evidencias_mapa import _tile

pytestmark = pytest.mark.django_db

LISTA = "/api/v1/iluminacao/arvores-proximas"
M = 0.00001  # ~1,1 m de longitude


@pytest.fixture
def lote(db):
    return LoteIluminacao.objects.create(
        fonte="Prefeitura de Fortaleza, SEINF",
        fonte_url="https://dados.fortaleza.ce.gov.br/x.xlsx",
        licenca="CC BY-SA",
        ingerido_em=timezone.now(),
    )


def poste(lote, codigo, ponto=PONTO_A, dx=0.0, **extras):
    campos = {
        "poste_tipo": "CONCRETO DUPLO T",
        "altura_poste_min_m": 5,
        "altura_poste_max_m": 10,
        "logradouro": "RUA TESTE",
        "lampadas": [
            {"tipo": "SODIO 400 W", "potencia_nominal_w": 400, "potencia_consumida_w": 454},
            {"tipo": "SODIO 400 W", "potencia_nominal_w": 400, "potencia_consumida_w": 454},
        ],
        **extras,
    }
    return PontoIluminacao.objects.create(
        codigo=codigo,
        geom=Point(ponto["longitude"] + dx, ponto["latitude"], srid=4326),
        lote=lote,
        **campos,
    )


def arvore(ponto=PONTO_A, dx=0.0, **extras):
    return Arvore.objects.create(
        geom=Point(ponto["longitude"] + dx, ponto["latitude"], srid=4326), **extras
    )


def codigos(resposta):
    assert resposta.status_code == 200, resposta.content
    return [a["codigo"] for a in resposta.json()["results"]]


# --- Serviço e lista --------------------------------------------------------------


def test_lista_so_as_arvores_ativas_dentro_do_raio_do_poste(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    perto = arvore(dx=2 * M)  # ~2,2 m
    arvore(dx=4 * M)  # ~4,4 m: fora do raio de 3 m
    inativa = arvore(dx=1 * M)
    inativa.situacao = SituacaoArvore.EXCLUIDA
    inativa.save()
    assert codigos(cliente.como(revisor).get(LISTA)) == [perto.codigo]


def test_o_raio_vem_do_setting_e_e_provisorio(cliente, revisor, territorios, lote, settings):
    poste(lote, "P1")
    a, b = arvore(dx=2 * M), arvore(dx=5 * M)  # ~2,2 m e ~5,5 m
    assert servico.raio_de_conflito_m() == 3
    assert codigos(cliente.como(revisor).get(LISTA)) == [a.codigo]
    settings.ILUMINACAO_RAIO_CONFLITO_M = 6
    assert codigos(cliente.como(revisor).get(LISTA)) == [a.codigo, b.codigo]
    resumo = cliente.como(revisor).get("/api/v1/iluminacao/resumo").json()
    assert resumo["raio_conflito_m"] == 6
    assert resumo["raio_provisorio"] is True


def test_cada_arvore_traz_o_poste_mais_proximo_e_a_lista_vai_da_mais_perto_a_mais_longe(
    cliente, revisor, territorios, lote
):
    poste(
        lote, "LONGE", dx=2.5 * M, poste_tipo="AÇO", altura_poste_min_m=None, altura_poste_max_m=5
    )
    poste(lote, "PERTO", dx=0.5 * M)
    a_longe = arvore(dx=0)  # PERTO a 0,55 m; LONGE a 2,75 m
    a_perto = arvore(dx=2.4 * M)  # LONGE a ~0,1 m
    itens = cliente.como(revisor).get(LISTA).json()["results"]
    assert [i["codigo"] for i in itens] == [a_perto.codigo, a_longe.codigo]
    assert itens[0]["poste"]["codigo"] == "LONGE"
    assert itens[0]["poste"]["tipo"] == "AÇO"
    assert itens[0]["poste"]["altura_max_m"] == 5 and itens[0]["poste"]["altura_min_m"] is None
    assert itens[1]["poste"]["codigo"] == "PERTO"
    assert itens[1]["poste"]["distancia_m"] == pytest.approx(0.6, abs=0.15)
    assert itens[1]["poste"]["logradouro"] == "RUA TESTE"


def test_arvore_com_varios_postes_aparece_uma_vez(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    poste(lote, "P2", dx=M)
    arvore(dx=M)
    assert len(codigos(cliente.como(revisor).get(LISTA))) == 1


def test_escopo_territorial_limita_a_lista(cliente, revisor, tecnico_a, territorios, lote):
    poste(lote, "PA", PONTO_A)
    poste(lote, "PB", PONTO_B)
    em_a, em_b = arvore(PONTO_A, dx=M), arvore(PONTO_B, dx=M)
    assert set(codigos(cliente.como(revisor).get(LISTA))) == {em_a.codigo, em_b.codigo}
    assert codigos(cliente.como(tecnico_a).get(LISTA)) == [em_a.codigo]


def test_filtros_por_bairro_e_por_altura_do_poste(cliente, revisor, territorios, lote):
    poste(lote, "PA", PONTO_A, altura_poste_max_m=10)
    poste(lote, "PB", PONTO_B, altura_poste_min_m=11, altura_poste_max_m=14)
    em_a = arvore(PONTO_A, dx=M, bairro=territorios["a"])
    em_b = arvore(PONTO_B, dx=M, bairro=territorios["b"])
    c = cliente.como(revisor)
    assert codigos(c.get(LISTA, {"bairro": str(territorios["b"].id)})) == [em_b.codigo]
    assert codigos(c.get(LISTA, {"altura_poste_max_m": "10"})) == [em_a.codigo]
    assert codigos(c.get(LISTA, {"altura_poste_max_m": "14"})) == [em_b.codigo]
    assert codigos(c.get(LISTA, {"altura_poste_max_m": "25"})) == []
    assert c.get(LISTA, {"altura_poste_max_m": "alto"}).status_code == 400


def test_sem_pontos_importados_a_lista_vem_vazia(cliente, revisor, territorios):
    arvore()
    assert codigos(cliente.como(revisor).get(LISTA)) == []
    assert cliente.como(revisor).get("/api/v1/iluminacao/resumo").json()["importada"] is False


def test_permissoes(cliente, territorios, lote):
    sem_permissao = criar_usuario("sem@itree.teste", [])
    assert cliente.get(LISTA).status_code in (401, 403)
    assert cliente.como(sem_permissao).get(LISTA).status_code == 403
    assert cliente.como(sem_permissao).get("/api/v1/iluminacao/resumo").status_code == 403


def test_as_arvores_da_lista_viram_tarefas_de_inspecao_pela_acao_em_lote(
    cliente, territorios, lote
):
    """A tela cria as tarefas com a ação em lote que já existe para seleções de árvores."""
    from itree.tarefas.models import Tarefa

    from .conftest import com_escopo

    coordenador = com_escopo(
        criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"]
    )
    poste(lote, "P1")
    perto = arvore(dx=M)
    arvore(dx=30 * M)
    c = cliente.como(coordenador)
    ids = [i["id"] for i in c.get(LISTA).json()["results"]]
    assert ids == [str(perto.id)]
    r = c.post("/api/v1/tarefas/lote", {"arvore_ids": ids}, format="json")
    assert r.status_code == 201, r.content
    assert r.json()["criadas"] == 1
    assert Tarefa.objects.get().arvore_id == perto.id


# --- Ficha da árvore e da ocorrência ---------------------------------------------


def test_ficha_da_arvore_mostra_o_poste_a_ate_15_m(cliente, revisor, territorios, lote):
    poste(lote, "P1", poste_tipo="CONCRETO REDONDO", altura_poste_min_m=11, altura_poste_max_m=14)
    perto = arvore(dx=9 * M)  # ~10 m
    longe = arvore(dx=20 * M)  # ~22 m
    c = cliente.como(revisor)
    p = c.get(f"/api/v1/arvores/{perto.id}").json()["poste_mais_proximo"]
    assert p["codigo"] == "P1" and p["tipo"] == "CONCRETO REDONDO"
    assert (p["altura_min_m"], p["altura_max_m"]) == (11, 14)
    assert p["distancia_m"] == pytest.approx(10, abs=0.8)
    assert c.get(f"/api/v1/arvores/{longe.id}").json()["poste_mais_proximo"] is None


def test_ocorrencia_de_fiacao_mostra_o_poste_e_as_demais_nao(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    fiacao = TipoOcorrencia.objects.create(nome="Árvore em fiação")
    galho = TipoOcorrencia.objects.create(nome="Galho caído")
    geom = Point(PONTO_A["longitude"] + 5 * M, PONTO_A["latitude"], srid=4326)
    o1 = Ocorrencia.objects.create(
        tipo=fiacao, geom=geom, descricao="x", origem="web", registrada_por=revisor
    )
    o2 = Ocorrencia.objects.create(
        tipo=galho, geom=geom, descricao="x", origem="web", registrada_por=revisor
    )
    c = cliente.como(revisor)
    assert c.get(f"/api/v1/ocorrencias/{o1.id}").json()["poste_mais_proximo"]["codigo"] == "P1"
    assert c.get(f"/api/v1/ocorrencias/{o2.id}").json()["poste_mais_proximo"] is None


@pytest.mark.parametrize(
    ("nome", "esperado"),
    [
        ("Árvore em fiação", True),
        ("Galho na rede elétrica", True),
        ("Poste danificado", True),
        ("Iluminação pública apagada", True),
        ("Galho caído", False),
        ("Poda solicitada", False),
    ],
)
def test_tipo_de_ocorrencia_relacionado_a_fiacao_ou_iluminacao(nome, esperado):
    assert servico.tipo_de_ocorrencia_relacionado(nome) is esperado


# --- Exportação CSV ---------------------------------------------------------------


def test_exporta_csv_no_padrao_das_listas_com_escopo_e_raio_provisorio(
    cliente, gestor_municipal, tecnico_a, territorios, lote
):
    poste(lote, "PA", PONTO_A)
    poste(lote, "PB", PONTO_B)
    em_a, em_b = arvore(PONTO_A, dx=M), arvore(PONTO_B, dx=M)
    r = cliente.como(gestor_municipal).get(
        "/api/v1/relatorios/exportar",
        {"conjunto": "arvores_iluminacao", "formato": "csv"},
    )
    assert r.status_code == 200
    texto = r.content.decode("utf-8-sig")
    assert "# titulo:" in texto and "provisório" in texto and "CC BY-SA" in texto
    dados = "\n".join(linha for linha in texto.splitlines() if not linha.startswith("#"))
    linhas = list(csv.DictReader(io.StringIO(dados), delimiter=";"))
    assert {linha["codigo"] for linha in linhas} == {em_a.codigo, em_b.codigo}
    assert {linha["poste_codigo"] for linha in linhas} == {"PA", "PB"}
    assert linhas[0]["raio_provisorio_m"] == "3.0"


def test_exportacao_exige_permissao_de_exportar(cliente, revisor, territorios, lote):
    # O revisor lê o inventário, mas não tem relatorios.exportar.
    r = cliente.como(revisor).get(
        "/api/v1/relatorios/exportar", {"conjunto": "arvores_iluminacao", "formato": "csv"}
    )
    assert r.status_code == 403


# --- MVT --------------------------------------------------------------------------


def tile(cliente, z, ponto=PONTO_A):
    x, y = _tile(ponto["longitude"], ponto["latitude"], z)
    r = cliente.get(f"/api/v1/mapa/tiles/iluminacao/{z}/{x}/{y}")
    assert r.status_code == 200
    return r, decodificar(r.content, z, x, y).get("iluminacao", [])


def test_tile_de_iluminacao_traz_os_pontos_a_partir_do_zoom_15(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    poste(lote, "P2", dx=3 * M, poste_tipo="", altura_poste_min_m=None, altura_poste_max_m=None)
    c = cliente.como(revisor)
    resposta, feicoes = tile(c, 17)
    assert resposta["Content-Type"] == "application/vnd.mapbox-vector-tile"
    assert "max-age" in resposta["Cache-Control"]
    por_id = {f["props"]["id"]: f["props"] for f in feicoes}
    assert set(por_id) == {"P1", "P2"}
    p1 = por_id["P1"]
    assert (p1["logradouro"], p1["poste"]) == ("RUA TESTE", "CONCRETO DUPLO T")
    assert (p1["altura_min_m"], p1["altura_max_m"]) == (5, 10)
    assert p1["lampadas"] == "SODIO 400 W (2)"
    assert por_id["P2"]["altura_min_m"] == -1  # sem altura informada
    assert len(tile(c, 15)[1]) == 2  # no zoom 15 já vem, um a um (nunca agrupado)


def test_tile_de_iluminacao_abaixo_do_zoom_15_vem_vazio(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    for z in (14, 11, 5):
        resposta, feicoes = tile(cliente.como(revisor), z)
        assert resposta.content == b"" and feicoes == []


def test_tile_de_iluminacao_respeita_escopo_e_permissao(
    cliente, revisor, tecnico_a, territorios, lote
):
    poste(lote, "PB", PONTO_B)
    assert len(tile(cliente.como(revisor), 17, PONTO_B)[1]) == 1
    assert tile(cliente.como(tecnico_a), 17, PONTO_B)[0].content == b""
    x, y = _tile(PONTO_B["longitude"], PONTO_B["latitude"], 17)
    sem = criar_usuario("sem@itree.teste", [])
    assert cliente.como(sem).get(f"/api/v1/mapa/tiles/iluminacao/17/{x}/{y}").status_code == 403


def test_camadas_traz_fonte_licenca_e_data_da_iluminacao(cliente, revisor, territorios, lote):
    poste(lote, "P1")
    info = cliente.como(revisor).get("/api/v1/mapa/camadas").json()["iluminacao"]
    assert info["quantidade"] == 1
    assert "SEINF" in info["fonte"] and info["licenca"] == "CC BY-SA"
    assert info["ingerido_em"]


def test_camadas_sem_importacao_nao_tem_iluminacao(cliente, revisor, territorios):
    assert cliente.como(revisor).get("/api/v1/mapa/camadas").json()["iluminacao"] is None
