"""Do lote ao inventário: junção por distância e incerteza, rastreamento, dado confirmado,
berço e toco, possível remoção e auditoria."""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.deteccao import servico
from itree.deteccao.models import (
    LoteDeteccao,
    Observacao,
    PontoPlantio,
    SinalRemocao,
    SituacaoSinal,
)
from itree.inventario.models import (
    Arvore,
    Especie,
    EstadoEspecie,
    Medida,
    MetodoMedida,
    OrigemValor,
    SituacaoArvore,
)

from .auditoria_util import eventos_de  # noqa: F401
from .conftest import PONTO_A, PONTO_B
from .deteccao_util import corpo, deslocar, det

pytestmark = pytest.mark.django_db

POLIGONO_A = {
    "type": "Polygon",
    "coordinates": [
        [
            [-38.5600, -3.7600],
            [-38.5500, -3.7600],
            [-38.5500, -3.7500],
            [-38.5600, -3.7500],
            [-38.5600, -3.7600],
        ]
    ],
}


@pytest.fixture
def envio(territorios, admin):
    token, _ = servico.criar_token("Projeto", [territorios["municipio"]], admin)
    return servico.Envio(canal="api", usuario=token.usuario, integracao=token)


def enviar(envio, deteccoes=None, **lote_extra):
    lote_extra.setdefault("id", f"lote-{LoteDeteccao.objects.count() + 1}")
    return servico.enviar(corpo(deteccoes, **lote_extra)["lote"], deteccoes or [det()], envio)


def arvore_em(ponto=PONTO_A, **extra):
    extra.setdefault("origem_registro", "web")
    extra.setdefault("localizacao_origem", "gps_campo")
    return Arvore.objects.create(
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326), **extra
    )


# --- Junção por distância e incerteza -----------------------------------------------------------


def test_deteccao_sem_arvore_por_perto_cria_arvore_detectada(envio):
    lote = enviar(envio, [det(confianca=0.62)])
    arvore = Arvore.objects.get()
    assert (lote.arvores_criadas, lote.arvores_juntadas) == (1, 0)
    assert arvore.origem_registro == "deteccao_video" and arvore.localizacao_origem == "detectada"
    assert arvore.confirmada is False and arvore.confianca == 0.62
    assert arvore.precisao_m == 1.0 and arvore.valida  # entra nos indicadores como qualquer árvore
    assert arvore.ultima_vez_vista_em.date() == date(2026, 11, 20)
    assert arvore.criado_por == envio.usuario and arvore.bairro is not None
    obs = Observacao.objects.get()
    assert (obs.arvore, obs.resultado, obs.sensor, obs.lote) == (arvore, "criou", "video_rua", lote)


def test_sensor_satelite_cria_arvore_via_satelite(envio):
    enviar(envio, [det()], sensor="satelite")
    assert Arvore.objects.get().origem_registro == "deteccao_satelite"


def test_deteccao_a_menos_de_dois_metros_junta_na_arvore_existente(envio):
    existente = arvore_em()
    lote = enviar(envio, [det(local=deslocar(PONTO_A, 1.5))])
    assert (lote.arvores_criadas, lote.arvores_juntadas) == (0, 1)
    assert Arvore.objects.count() == 1
    existente.refresh_from_db()
    assert existente.ultima_vez_vista_em.date() == date(2026, 11, 20)
    assert Observacao.objects.get().resultado == "juntou"


def test_alem_de_dois_metros_com_incerteza_pequena_cria_outra(envio):
    arvore_em()
    lote = enviar(envio, [det(local=deslocar(PONTO_A, 3.0), incerteza_m=1.0)])
    assert (lote.arvores_criadas, lote.arvores_juntadas) == (1, 0) and Arvore.objects.count() == 2


def test_incerteza_maior_que_a_distancia_amplia_o_raio_de_juncao(envio):
    arvore_em()
    lote = enviar(envio, [det(local=deslocar(PONTO_A, 4.0), incerteza_m=5.0)])
    assert (lote.arvores_criadas, lote.arvores_juntadas) == (0, 1) and Arvore.objects.count() == 1


def test_raio_de_juncao_e_configuravel_e_tem_teto(envio, settings):
    arvore_em()
    settings.DETECCAO_RAIO_JUNCAO_MINIMO_M = 4.0
    assert enviar(envio, [det(local=deslocar(PONTO_A, 3.5))]).arvores_juntadas == 1
    settings.DETECCAO_RAIO_JUNCAO_MAXIMO_M = 4.0
    # incerteza de 50 m não funde a quadra inteira: o teto vale
    assert enviar(envio, [det(local=deslocar(PONTO_A, 10.0), incerteza_m=50)]).arvores_criadas == 1


def test_junta_na_mais_proxima_e_ignora_arvores_nao_ativas(envio):
    longe = arvore_em(deslocar(PONTO_A, 1.8))
    perto = arvore_em(deslocar(PONTO_A, 0.5))
    excluida = arvore_em(PONTO_A, situacao=SituacaoArvore.EXCLUIDA)
    enviar(envio, [det()])
    assert Observacao.objects.get().arvore == perto
    longe.refresh_from_db(), excluida.refresh_from_db()
    assert longe.ultima_vez_vista_em is None and excluida.ultima_vez_vista_em is None


def test_arvore_excluida_nao_atrai_a_juncao(envio):
    arvore_em(situacao=SituacaoArvore.EXCLUIDA)
    assert enviar(envio, [det()]).arvores_criadas == 1


# --- Mesmo rastreamento ---------------------------------------------------------------------


def test_mesmo_rastreamento_vira_uma_arvore_com_varias_observacoes(envio):
    pontos = [deslocar(PONTO_A, 0.5), deslocar(PONTO_A, -0.5), deslocar(PONTO_A, 0, 0.5)]
    lote = enviar(
        envio,
        [
            det(f"q{i}", p, id_rastreamento="t1", confianca=c)
            for i, (p, c) in enumerate(zip(pontos, (0.6, 0.9, 0.7), strict=True))
        ],
    )
    assert (lote.arvores_criadas, lote.recusadas, lote.total) == (1, 0, 3)
    arvore = Arvore.objects.get()
    assert arvore.confianca == 0.9  # a maior do rastreamento
    assert Observacao.objects.filter(arvore=arvore).count() == 3
    assert abs(arvore.geom.x - PONTO_A["longitude"]) < 1e-5


def test_sem_rastreamento_ou_com_rastreamentos_diferentes_sao_arvores_distintas(envio):
    lote = enviar(
        envio,
        [
            det("a", deslocar(PONTO_A, 20), id_rastreamento="t1"),
            det("b", deslocar(PONTO_A, 40), id_rastreamento="t2"),
            det("c", deslocar(PONTO_A, 60)),
            det("d", deslocar(PONTO_A, 80)),
        ],
    )
    assert lote.arvores_criadas == 4


def test_posicao_do_grupo_pesa_pela_incerteza(envio):
    enviar(
        envio,
        [
            det("a", PONTO_A, id_rastreamento="t", incerteza_m=1.0),
            det("b", deslocar(PONTO_A, 8), id_rastreamento="t", incerteza_m=8.0),
        ],
    )
    arvore = Arvore.objects.get()
    ponto_b = deslocar(PONTO_A, 8)
    # o ponto preciso (1 m) domina o impreciso (8 m): fica muito mais perto do primeiro
    assert (
        abs(arvore.geom.x - PONTO_A["longitude"]) < abs(arvore.geom.x - ponto_b["longitude"]) / 10
    )
    assert arvore.precisao_m < 1.0


def test_rastreamento_em_duas_passagens_nao_cria_arvore_nova(envio):
    enviar(envio, [det("a", id_rastreamento="t1", confianca=0.5)])
    lote2 = enviar(envio, [det("a", id_rastreamento="t1", confianca=0.9)])
    assert Arvore.objects.count() == 1 and lote2.arvores_juntadas == 1
    arvore = Arvore.objects.get()
    assert arvore.confianca == 0.9 and Observacao.objects.count() == 2  # a confiança sobe


# --- Não sobrescrever o confirmado ----------------------------------------------------------


def test_nao_sobrescreve_especie_confirmada_nem_move_a_arvore(envio):
    especie = Especie.objects.create(nome_cientifico="Licania tomentosa")
    Especie.objects.create(nome_cientifico="Ficus benjamina")
    arvore = arvore_em(especie=especie, especie_estado=EstadoEspecie.CONFIRMADA)
    geom_antes = arvore.geom.coords
    enviar(
        envio,
        [
            det(
                local=deslocar(PONTO_A, 1),
                especies=[{"nome_cientifico": "Ficus benjamina", "probabilidade": 0.9}],
            )
        ],
    )
    arvore.refresh_from_db()
    assert arvore.especie == especie and arvore.especie_estado == EstadoEspecie.CONFIRMADA
    assert arvore.geom.coords == geom_antes
    assert Observacao.objects.get().valores["especies"][0]["nome_cientifico"] == "Ficus benjamina"


def test_preenche_especie_so_de_arvore_nao_identificada_como_sugerida(envio):
    especie = Especie.objects.create(nome_cientifico="Licania tomentosa")
    arvore = arvore_em()
    enviar(envio, [det(especies=[{"nome_cientifico": "Licania tomentosa", "probabilidade": 0.8}])])
    arvore.refresh_from_db()
    assert arvore.especie == especie and arvore.especie_estado == EstadoEspecie.SUGERIDA_IA


def test_especie_fora_do_catalogo_fica_como_texto_original(envio):
    enviar(envio, [det(especies=[{"nome_cientifico": "Planta inexistente", "probabilidade": 0.8}])])
    arvore = Arvore.objects.get()
    assert arvore.especie is None and arvore.especie_texto_original == "Planta inexistente"
    assert arvore.especie_estado == EstadoEspecie.NAO_IDENTIFICADA


def test_medida_estimada_nao_substitui_medida_de_pessoa(envio):
    arvore = arvore_em()
    arvore.medidas.create(
        tipo="altura",
        valor=10,
        unidade="m",
        metodo=MetodoMedida.HIPSOMETRO,
        origem=OrigemValor.MEDIDO,
    )
    enviar(
        envio,
        [
            det(
                medidas={
                    "altura": {"valor": 6, "unidade": "m"},
                    "dap": {"valor": 20, "unidade": "cm"},
                }
            )
        ],
    )
    altura = arvore.medidas.get(origem=OrigemValor.ESTIMADO, tipo="altura")
    assert altura.aplicada is False and altura.metodo == MetodoMedida.IMAGEM
    dap = arvore.medidas.get(tipo="dap")
    assert dap.aplicada is True and dap.origem == OrigemValor.ESTIMADO
    from itree.inventario.serializers import medidas_atuais_da_arvore

    atuais = {m.tipo: m for m in medidas_atuais_da_arvore(arvore)}
    assert atuais["altura"].valor == 10 and atuais["altura"].origem == OrigemValor.MEDIDO
    assert atuais["dap"].origem == OrigemValor.ESTIMADO


def test_medidas_de_arvore_nova_sao_estimadas_por_imagem(envio):
    enviar(envio, [det(medidas={"altura": {"valor": 850, "unidade": "cm", "incerteza": 100}})])
    m = Medida.objects.get()
    assert (m.valor, m.unidade, m.origem, m.metodo) == (8.5, "m", "estimado", "imagem")
    assert "incerteza" in m.observacao and m.data_medicao == date(2026, 11, 20)


def test_juncao_nao_rebaixa_nem_confirma_arvore(envio):
    arvore = arvore_em(confirmada=False, confianca=0.9)
    enviar(envio, [det(local=deslocar(PONTO_A, 1), confianca=0.4)])
    arvore.refresh_from_db()
    assert arvore.confirmada is False and arvore.confianca == 0.9


def test_data_mais_antiga_nao_recua_a_ultima_vez_vista(envio):
    enviar(envio, [det()], capturado_em="2026-11-20")
    enviar(envio, [det()], capturado_em="2026-10-01")
    assert Arvore.objects.get().ultima_vez_vista_em.date() == date(2026, 11, 20)


# --- Berço vazio e toco ---------------------------------------------------------------------


def test_berco_vazio_e_toco_nao_viram_arvore_viram_pontos_de_plantio(envio):
    lote = enviar(
        envio,
        [
            det("b", tipo="berco_vazio", contexto="calcada"),
            det("t", deslocar(PONTO_A, 30), tipo="toco"),
        ],
    )
    assert Arvore.objects.count() == 0 and (lote.arvores_criadas, lote.pontos_criados) == (0, 2)
    assert {p.tipo for p in PontoPlantio.objects.all()} == {"berco_vazio", "toco"}
    ponto = PontoPlantio.objects.get(tipo="berco_vazio")
    assert ponto.contexto == "calcada" and ponto.situacao == "aberto" and ponto.bairro is not None


def test_berco_no_lugar_de_arvore_existente_nao_a_altera(envio):
    arvore = arvore_em()
    enviar(envio, [det(tipo="berco_vazio")])
    assert PontoPlantio.objects.count() == 1 and arvore.observacoes_deteccao.count() == 0


def test_mesmo_berco_em_duas_passagens_e_um_so_ponto(envio):
    enviar(envio, [det(tipo="berco_vazio")], capturado_em="2026-10-01")
    lote2 = enviar(envio, [det(tipo="berco_vazio", local=deslocar(PONTO_A, 0.5))])
    assert PontoPlantio.objects.count() == 1 and lote2.pontos_criados == 0
    assert PontoPlantio.objects.get().ultima_vez_visto_em == date(2026, 11, 20)


# --- Possível remoção -----------------------------------------------------------------------


def ontem():
    return (timezone.localdate() - timedelta(days=1)).isoformat()


def test_arvore_conhecida_na_area_coberta_e_nao_vista_vira_sinal_de_remocao(envio):
    vista, sumida = arvore_em(), arvore_em(deslocar(PONTO_A, 40))
    fora = arvore_em(PONTO_B)  # fora da área coberta
    lote = enviar(
        envio, [det()], area_coberta=POLIGONO_A, capturado_em=timezone.localdate().isoformat()
    )
    assert lote.possiveis_remocoes == 1
    sinal = SinalRemocao.objects.get()
    assert (
        sinal.arvore == sumida and sinal.situacao == SituacaoSinal.PENDENTE and sinal.lote == lote
    )
    assert not SinalRemocao.objects.filter(arvore__in=[vista, fora]).exists()
    sumida.refresh_from_db()
    assert sumida.situacao == SituacaoArvore.ATIVA  # nada é removido sozinho


def test_sem_area_coberta_nao_ha_sinal(envio):
    arvore_em(deslocar(PONTO_A, 40))
    assert enviar(envio, [det()]).possiveis_remocoes == 0


def test_arvore_cadastrada_depois_da_captura_nao_e_sinalizada(envio):
    arvore_em(deslocar(PONTO_A, 40))
    lote = enviar(envio, [det()], area_coberta=POLIGONO_A, capturado_em=ontem())
    assert lote.possiveis_remocoes == 0


def test_so_arvores_ativas_e_sem_sinal_pendente_entram(envio):
    arvore_em(deslocar(PONTO_A, 40), situacao=SituacaoArvore.EXCLUIDA)
    pendente = arvore_em(deslocar(PONTO_A, 60))
    hoje = timezone.localdate().isoformat()
    enviar(envio, [det()], area_coberta=POLIGONO_A, capturado_em=hoje)
    assert list(SinalRemocao.objects.values_list("arvore", flat=True)) == [pendente.pk]
    lote2 = enviar(envio, [det()], area_coberta=POLIGONO_A, capturado_em=hoje)
    assert lote2.possiveis_remocoes == 0 and SinalRemocao.objects.count() == 1


def test_area_coberta_respeita_o_escopo_do_token(territorios, admin):
    token, _ = servico.criar_token("So B", [territorios["b"]], admin)
    envio = servico.Envio(canal="api", usuario=token.usuario, integracao=token)
    arvore_em(deslocar(PONTO_A, 40))  # no bairro A, fora do escopo do token
    lote = enviar(
        envio,
        [det("x", deslocar(PONTO_B, 10))],
        area_coberta=POLIGONO_A,
        capturado_em=timezone.localdate().isoformat(),
    )
    assert lote.possiveis_remocoes == 0


def test_arvore_vista_de_novo_descarta_o_sinal_pendente(envio):
    arvore = arvore_em()
    hoje = timezone.localdate().isoformat()
    enviar(
        envio, [det("longe", deslocar(PONTO_A, 100))], area_coberta=POLIGONO_A, capturado_em=hoje
    )
    assert SinalRemocao.objects.get().situacao == SituacaoSinal.PENDENTE
    enviar(envio, [det("aqui")], area_coberta=POLIGONO_A, capturado_em=hoje)
    sinal = SinalRemocao.objects.get(arvore=arvore)
    assert sinal.situacao == SituacaoSinal.DESCARTADO and "de novo" in sinal.motivo


# --- Revisão das remoções -------------------------------------------------------------------

REMOCOES = "/api/v1/deteccoes/remocoes"


@pytest.fixture
def sinal(envio):
    arvore_em(deslocar(PONTO_A, 40))
    enviar(envio, [det()], area_coberta=POLIGONO_A, capturado_em=timezone.localdate().isoformat())
    return SinalRemocao.objects.get()


def test_lista_de_possiveis_remocoes(cliente, revisor, sinal):
    r = cliente.como(revisor).get(REMOCOES)
    assert r.status_code == 200
    item = r.json()["results"][0]
    assert item["arvore_codigo"].startswith("ARV-") and item["situacao"] == "pendente"
    assert cliente.get(f"{REMOCOES}?situacao=descartado").json()["results"] == []


def test_confirmar_remocao_exclui_logicamente_com_justificativa(cliente, revisor, sinal):
    cliente.como(revisor)
    assert cliente.post(f"{REMOCOES}/{sinal.id}/confirmar", {}, format="json").status_code == 400
    r = cliente.post(
        f"{REMOCOES}/{sinal.id}/confirmar", {"motivo": "Vistoria: árvore cortada."}, format="json"
    )
    assert r.status_code == 200 and r.json()["situacao"] == "remocao_confirmada"
    sinal.arvore.refresh_from_db()
    assert sinal.arvore.situacao == SituacaoArvore.EXCLUIDA
    assert "cortada" in sinal.arvore.motivo_situacao
    assert (
        cliente.post(f"{REMOCOES}/{sinal.id}/descartar", {"motivo": "x"}, format="json").status_code
        == 400
    )


def test_descartar_mantem_a_arvore(cliente, revisor, sinal):
    r = cliente.como(revisor).post(
        f"{REMOCOES}/{sinal.id}/descartar", {"motivo": "Segue lá."}, format="json"
    )
    assert r.status_code == 200 and r.json()["situacao"] == "descartado"
    sinal.arvore.refresh_from_db()
    assert sinal.arvore.situacao == SituacaoArvore.ATIVA


def test_remocao_so_para_quem_revisa_e_dentro_do_escopo(
    cliente, gestor_municipal, tecnico_a, sinal, territorios
):
    assert cliente.como(gestor_municipal).get(REMOCOES).status_code == 200  # ler
    r = cliente.post(f"{REMOCOES}/{sinal.id}/confirmar", {"motivo": "x"}, format="json")
    assert r.status_code == 403  # gestor não revisa
    from .conftest import com_escopo, criar_usuario

    revisor_b = com_escopo(criar_usuario("rb@itree.teste", ["revisor"]), territorios["b"])
    r = cliente.como(revisor_b).post(
        f"{REMOCOES}/{sinal.id}/confirmar", {"motivo": "x"}, format="json"
    )
    assert r.status_code == 404  # fora do escopo
    assert cliente.get(REMOCOES).json()["results"] == []


# --- Auditoria ------------------------------------------------------------------------------


def test_o_que_o_lote_cria_fica_no_historico_com_o_contexto_do_lote(envio):
    from pghistory.models import Events

    lote = enviar(envio, [det()])
    arvore = Arvore.objects.get()
    evento = Events.objects.references(arvore).order_by("pgh_created_at").first()
    assert evento.pgh_context["evento"] == "deteccao_lote"
    assert evento.pgh_context["lote"] == str(lote.id)
    assert Events.objects.references(lote).exists()
