"""Ficha do bairro: conteúdo, fontes, escopo (403) e número de consultas."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from itree.contas.models import Usuario
from itree.iluminacao.models import LoteIluminacao
from itree.indicadores import externos, ilha_calor
from itree.indicadores.models import IndicadorTerritorialExterno, RegistroPlantio
from itree.inventario.models import Arvore, Especie
from itree.ocorrencias.models import Ocorrencia, TipoOcorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario
from .test_iluminacao_conflito import M, poste

pytestmark = pytest.mark.django_db


def url(bairro):
    return f"/api/v1/bairros/{bairro.id}/ficha"


def ponto(p, dx=0.0):
    return Point(p["longitude"] + dx, p["latitude"], srid=4326)


def arvore(p=PONTO_A, dx=0.0, condicao="", especie=None, **extras):
    return Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=ponto(p, dx),
        condicao_aparente=condicao,
        especie=especie,
        especie_estado="confirmada" if especie else "nao_identificada",
        **extras,
    )


def _autor():
    return Usuario.objects.filter(email="autor@itree.teste").first() or criar_usuario(
        "autor@itree.teste"
    )


def ocorrencia(tipo, p=PONTO_A, prazo=None, **extras):
    return Ocorrencia.objects.create(
        tipo=tipo,
        geom=ponto(p),
        descricao="Teste",
        origem="web",
        registrada_por=_autor(),
        prazo=prazo,
        **extras,
    )


@pytest.fixture
def lote():
    return LoteIluminacao.objects.create(
        fonte="Prefeitura de Fortaleza, SEINF",
        fonte_url="https://dados.fortaleza.ce.gov.br/x.xlsx",
        licenca="CC BY-SA",
        ingerido_em=timezone.now(),
    )


@pytest.fixture
def tipo():
    return TipoOcorrencia.objects.create(nome="Galho caído")


def cartoes(corpo):
    return {c["id"]: c for c in corpo["cartoes"]}


def ficha_de(cliente, usuario, bairro):
    resposta = cliente.como(usuario).get(url(bairro))
    assert resposta.status_code == 200, resposta.content
    return resposta.json()


def test_ficha_reune_cabecalho_cartoes_graficos_e_ranking(
    cliente, gestor_municipal, territorios, tipo
):
    ontem = timezone.localdate() - timedelta(days=1)
    sp = [Especie.objects.create(nome_cientifico=f"Espécie {i}") for i in range(10)]
    arvore(condicao="ruim", especie=sp[0])
    arvore(condicao="morta", especie=sp[0])
    arvore(condicao="boa", especie=sp[1])
    arvore()
    for e in sp[2:]:
        arvore(especie=e)
    arvore(PONTO_B, condicao="ruim")  # outro bairro: não entra
    ocorrencia(tipo, prazo=ontem, risco_confirmado=True)
    ocorrencia(tipo)
    ocorrencia(tipo, PONTO_B)

    corpo = ficha_de(cliente, gestor_municipal, territorios["a"])

    b = corpo["bairro"]
    assert b["nome"] == "Bairro A" and b["id"] == str(territorios["a"].id)
    assert b["area_km2"] and b["area_km2"] > 0
    assert len(b["limites"]) == 4 and b["geometria"]["type"] == "MultiPolygon"
    # O bairro de teste não vem do Ipplan: o selo não afirma isso.
    assert b["oficial"] is False and b["selo"] == "Bairro cadastrado"

    c = cartoes(corpo)
    assert c["arvores"]["valor"] == 3 + 1 + 8 and c["arvores"]["data_referencia"]
    assert c["arvores"]["fonte"] == "Registros da plataforma"
    assert c["especie_confirmada"]["valor"] == round(100 * 11 / 12, 1)
    assert c["condicao_ruim"]["valor"] == round(100 * 2 / 12, 1)
    assert c["condicao_ruim"]["unidade"] == "%"
    # Régua "bairro × cidade": a referência é o escopo todo (inclui a árvore do bairro B).
    assert c["condicao_ruim"]["cidade"]["valor"] == round(100 * 3 / 13, 1)
    assert c["condicao_ruim"]["cidade"]["rotulo"] == "Média de Fortaleza"
    assert (c["ocorrencias"]["valor"], c["ocorrencias"]["extras"][0]["valor"]) == (2, "1")

    especies = corpo["graficos"]["especies"]["itens"]
    assert len(especies) == 9  # 8 espécies + "Outras"
    assert especies[0] == {"id": "", "rotulo": "Espécie 0", "valor": 2}
    assert especies[-1]["id"] == "outras" and especies[-1]["valor"] == 2
    condicao = {i["id"]: i["valor"] for i in corpo["graficos"]["condicao"]["itens"]}
    assert condicao == {"boa": 1, "ruim": 1, "morta": 1, "sem": 9}
    mensal = corpo["graficos"]["ocorrencias_mensais"]
    assert len(mensal["meses"]) == 12 and mensal["valores"][-1] == 2
    assert sum(mensal["valores"]) == 2


def test_cartao_sem_dado_diz_o_motivo_e_nao_some(cliente, gestor_municipal, territorios):
    corpo = ficha_de(cliente, gestor_municipal, territorios["a"])
    c = cartoes(corpo)
    for id_ in ("arborizacao_entorno", "ilha_calor", "iluminacao", "plantio", "manejo"):
        assert c[id_]["sem_dado"] is True and c[id_]["valor"] is None, id_
        assert c[id_]["nota"], id_
    assert "Veja a camada no mapa" in c["ilha_calor"]["nota"]
    assert c["ilha_calor"]["link"]["filtros"]["ilha_calor"] == "1"
    assert c["iluminacao"]["provisorio"] is True
    # Sem árvores no bairro, o percentual não vira 0%.
    assert c["especie_confirmada"]["sem_dado"] is True


def test_cartoes_externos_trazem_valor_fonte_e_data(cliente, gestor_municipal, territorios, lote):
    a, b = territorios["a"], territorios["b"]
    agora = timezone.now()
    for bairro, num in ((a, 30), (b, 70)):
        IndicadorTerritorialExterno.objects.create(
            territorio=bairro,
            indicador=externos.ARBORIZACAO_FACES,
            valor=num,
            numerador=num,
            denominador=100,
            unidade="%",
            fonte=externos.FONTE_CENSO,
            fonte_url=externos.URL_CENSO_FACES,
            licenca=externos.LICENCA_CENSO,
            data_referencia=externos.DATA_REFERENCIA_CENSO,
            ingerido_em=agora,
            definicao="d",
            metodo="m",
        )
    RegistroPlantio.objects.create(
        ano=2022,
        bairro=a,
        total_mudas=40,
        linha_origem=1,
        fonte="URBFOR",
        ingerido_em=agora,
    )
    RegistroPlantio.objects.create(
        ano=2022, total_mudas=60, linha_origem=2, fonte="URBFOR", ingerido_em=agora
    )
    arvore()
    arvore(dx=M * 2)  # a 2,2 m do poste: dentro do raio provisório de 3 m
    arvore(dx=M * 10)
    poste(lote, "P1")

    c = cartoes(ficha_de(cliente, gestor_municipal, a))

    assert c["arborizacao_entorno"]["valor"] == 30.0
    assert c["arborizacao_entorno"]["cidade"]["valor"] == 50.0  # (30 + 70) ÷ (100 + 100)
    assert c["arborizacao_entorno"]["fonte"] == externos.FONTE_CENSO
    assert c["arborizacao_entorno"]["data_referencia"].startswith("2022")
    assert c["iluminacao"]["valor"] == 2 and c["iluminacao"]["provisorio"] is True
    assert "DP-22" in c["iluminacao"]["definicao"]
    assert c["iluminacao"]["fonte"] == lote.fonte
    assert c["plantio"]["valor"] == 40
    # A cobertura parcial é declarada: só 40% das mudas têm bairro.
    assert "40" in c["plantio"]["nota"] and "bairro" in c["plantio"]["nota"]


def test_ilha_de_calor_gravada_aparece_com_media_da_cidade(cliente, gestor_municipal, territorios):
    agora = timezone.now()
    for bairro, valor, pixels in ((territorios["a"], 2.0, 100), (territorios["b"], -1.0, 300)):
        IndicadorTerritorialExterno.objects.create(
            territorio=bairro,
            indicador=ilha_calor.INDICADOR,
            valor=valor,
            numerador=pixels,
            denominador=pixels,
            unidade="°C",
            fonte=ilha_calor.FONTE,
            licenca=ilha_calor.LICENCA,
            data_referencia=ilha_calor.DATA_REFERENCIA,
            ingerido_em=agora,
            definicao="d",
            metodo="m",
        )
    c = cartoes(ficha_de(cliente, gestor_municipal, territorios["a"]))["ilha_calor"]
    assert c["sem_dado"] is False and c["valor"] == 2.0 and c["unidade"] == "°C"
    assert c["cidade"]["valor"] == round((2.0 * 100 + -1.0 * 300) / 400, 2)
    assert "UrbVerde" in c["fonte"] and c["data_referencia"].startswith("2025")
    assert "todos os direitos reservados" in c["licenca"].lower()
    assert c["metodo"] == ilha_calor.METODO


def test_ranking_mostra_a_posicao_do_bairro(cliente, gestor_municipal, territorios, tipo):
    ontem = timezone.localdate() - timedelta(days=1)
    ocorrencia(tipo, PONTO_B, prazo=ontem, risco_confirmado=True)  # B: 10 + 5
    arvore(condicao="ruim")  # A: 2 (ruim) + 1 (sem inspeção)
    corpo = ficha_de(cliente, gestor_municipal, territorios["a"])
    r = corpo["ranking"]
    assert (r["posicao"], r["total"], r["indice"]) == (2, 2, 3)
    assert {k["id"]: k["quantidade"] for k in r["componentes"]}["ruins_ou_mortas"] == 1
    assert ficha_de(cliente, gestor_municipal, territorios["b"])["ranking"]["posicao"] == 1


def test_bairro_sem_indice_nao_tem_posicao(cliente, gestor_municipal, territorios):
    r = ficha_de(cliente, gestor_municipal, territorios["a"])["ranking"]
    assert r["posicao"] is None and r["indice"] == 0 and r["componentes"] == []


def test_alertas_dos_ultimos_12_meses_so_com_permissao(cliente, gestor_municipal, territorios):
    from itree.alertas.models import AlertaAmbiental

    def alerta(id_externo, dias, ponto_):
        return AlertaAmbiental.objects.create(
            fonte="inpe_focos",
            id_externo=id_externo,
            tipo="foco_calor",
            geom=ponto(ponto_),
            data_deteccao=timezone.now() - timedelta(days=dias),
            bairros=[{"id": str(territorios["a"].id), "nome": "Bairro A"}],
        )

    alerta("F1", 10, PONTO_A)
    alerta("F2", 400, PONTO_A)  # fora dos 12 meses
    c = cartoes(ficha_de(cliente, gestor_municipal, territorios["a"]))["alertas"]
    assert c["valor"] == 1 and "1 foco" in c["detalhe"] and "não prova" in c["nota"]

    coordenador = com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["a"])
    assert not coordenador.tem_permissao("alertas.ler")
    c = cartoes(ficha_de(cliente, coordenador, territorios["a"]))["alertas"]
    assert c["sem_dado"] is True and "não tem acesso" in c["nota"]


def test_tarefas_em_aberto_do_bairro(cliente, gestor_municipal, territorios):
    a = arvore()
    Tarefa.objects.create(
        tipo="inspecao_arvore",
        arvore=a,
        geom=a.geom,
        criada_por=gestor_municipal,
        prazo=timezone.localdate() - timedelta(days=2),
    )
    c = cartoes(ficha_de(cliente, gestor_municipal, territorios["a"]))["tarefas"]
    assert c["valor"] == 1 and c["extras"][0]["valor"] == "1"


# --- Escopo e permissão ------------------------------------------------------------------


def test_fora_do_escopo_recebe_403(cliente, territorios):
    so_b = com_escopo(criar_usuario("gb@itree.teste", ["gestor"]), territorios["b"])
    assert cliente.como(so_b).get(url(territorios["a"])).status_code == 403
    assert cliente.como(so_b).get(url(territorios["b"])).status_code == 200


def test_escopo_da_regional_enxerga_os_bairros_dentro(cliente, territorios):
    regional = territorios["a"].pai = None
    from .conftest import criar_territorio, quadrado

    regional = criar_territorio("Regional 1", tipo="regional", geom=quadrado(-38.57, -3.77, 0.05))
    territorios["a"].pai = regional
    territorios["a"].save()
    gestor = com_escopo(criar_usuario("gr@itree.teste", ["gestor"]), regional)
    corpo = ficha_de(cliente, gestor, territorios["a"])
    assert corpo["bairro"]["regional"] == {"id": str(regional.id), "nome": "Regional 1"}


def test_sem_escopo_ou_sem_permissao_nao_ve_a_ficha(cliente, territorios):
    sem_escopo = criar_usuario("sem@itree.teste", ["gestor"])
    assert cliente.como(sem_escopo).get(url(territorios["a"])).status_code == 403
    sem_permissao = com_escopo(criar_usuario("nada@itree.teste", []), territorios["municipio"])
    assert cliente.como(sem_permissao).get(url(territorios["a"])).status_code == 403


def test_bairro_inexistente_ou_territorio_que_nao_e_bairro(cliente, gestor_municipal, territorios):
    c = cliente.como(gestor_municipal)
    assert c.get("/api/v1/bairros/00000000-0000-0000-0000-000000000000/ficha").status_code == 404
    assert c.get("/api/v1/bairros/nao-e-uuid/ficha").status_code == 404
    assert c.get(f"/api/v1/bairros/{territorios['municipio'].id}/ficha").status_code == 404


def test_lista_de_bairros_so_traz_os_do_escopo(cliente, territorios):
    arvore()
    so_a = com_escopo(criar_usuario("ga@itree.teste", ["gestor"]), territorios["a"])
    lista = cliente.como(so_a).get("/api/v1/bairros").json()
    assert [b["nome"] for b in lista] == ["Bairro A"] and lista[0]["arvores_no_escopo"] == 1
    busca = cliente.como(so_a).get("/api/v1/bairros", {"busca": "zzz"}).json()
    assert busca == []


# --- Consultas ---------------------------------------------------------------------------


def _consultas(cliente, usuario, bairro) -> int:
    cliente.como(usuario)
    cliente.get(url(bairro))  # aquece caches do processo (permissões, tipos de conteúdo)
    with CaptureQueriesContext(connection) as ctx:
        assert cliente.get(url(bairro)).status_code == 200
    return len(ctx)


def test_numero_de_consultas_nao_cresce_com_os_dados(
    cliente, gestor_municipal, territorios, tipo, lote
):
    vazio = _consultas(cliente, gestor_municipal, territorios["a"])
    poste(lote, "P1")
    e = Especie.objects.create(nome_cientifico="Espécie X")
    for i in range(15):
        arvore(dx=i * M, condicao="ruim", especie=e)
        ocorrencia(tipo, prazo=timezone.localdate() - timedelta(days=1))
    cheio = _consultas(cliente, gestor_municipal, territorios["a"])
    # Mesmas consultas, com 15 árvores, 15 ocorrências e um poste: nada de N+1.
    assert cheio == vazio
    assert cheio <= 60
