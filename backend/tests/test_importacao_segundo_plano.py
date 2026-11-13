"""Confirmação de importação grande em segundo plano (I5 da revisão de prontidão)."""

import pytest

from itree.contas.models import EscopoUsuario
from itree.core.geo import ResolvedorDeBairro, bairro_do_ponto
from itree.inventario import importacao, models, tasks
from itree.inventario.importacao import executar_confirmacao
from itree.inventario.models import Arvore, IdentificadorExterno, LoteImportacao

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario
from .test_importacao import URL, enviar

pytestmark = pytest.mark.django_db


def csv(n: int, ponto=PONTO_A) -> str:
    linhas = [
        f"I{i};Licania tomentosa;{ponto['latitude']};{ponto['longitude']};5;;Rua {i}"
        for i in range(1, n + 1)
    ]
    return "codigo;especie;lat;lon;altura_m;dap_cm;rua\n" + "\n".join(linhas) + "\n"


@pytest.fixture
def fila(monkeypatch):
    """Guarda as confirmações enfileiradas; o teste decide quando a tarefa roda."""
    enfileiradas: list[str] = []
    monkeypatch.setattr(tasks.confirmar_importacao, "delay", lambda i: enfileiradas.append(i))
    return enfileiradas


@pytest.fixture
def limite_baixo(settings):
    """Três linhas válidas ou mais já vão para a fila."""
    settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = 2


@pytest.fixture
def blocos_de_dois(monkeypatch):
    monkeypatch.setattr(importacao, "TAMANHO_BLOCO", 2)


def lote_pre_visualizado(cliente, revisor, n=5, **kwargs):
    r = enviar(cliente.como(revisor), csv(n), **kwargs)
    assert r.status_code == 201, r.json()
    return r.json()


def obter(cliente, lote):
    return cliente.get(f"{URL}/{lote['id']}").json()


def test_lote_grande_vai_para_segundo_plano(cliente, revisor, fila, limite_baixo):
    lote = lote_pre_visualizado(cliente, revisor)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 202, r.json()
    assert r.json()["id"] == lote["id"]
    assert r.json()["estado"] == "em_processamento"
    assert fila == [lote["id"]]
    assert Arvore.objects.count() == 0  # nada foi criado dentro da requisição

    tasks.confirmar_importacao(fila[0])
    final = obter(cliente, lote)
    assert final["estado"] == "confirmado"
    assert final["arvores_criadas"] == 5
    assert (final["linhas_processadas"], final["linhas_com_falha"]) == (5, 0)
    assert Arvore.objects.get(identificadores__valor="I1").criado_por == revisor


def test_lote_pequeno_continua_imediato(cliente, revisor, fila, settings):
    settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = 5
    lote = lote_pre_visualizado(cliente, revisor, n=5)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "confirmado"
    assert fila == []
    assert Arvore.objects.count() == 5


def test_limite_conta_so_linhas_validas(cliente, revisor, fila, settings):
    settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = 2
    conteudo = csv(3) + "X;Licania tomentosa;;;;;sem coordenada\n" * 10
    lote = enviar(cliente.como(revisor), conteudo).json()
    assert (lote["total_linhas"], lote["linhas_validas"]) == (13, 3)
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 202


def test_progresso_avanca_por_bloco(
    cliente, revisor, fila, limite_baixo, blocos_de_dois, monkeypatch
):
    lote = lote_pre_visualizado(cliente, revisor)
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert obter(cliente, lote)["linhas_processadas"] == 0

    vistos = []
    original = importacao._criar_arvore

    def espiar(*args, **kwargs):
        vistos.append(LoteImportacao.objects.get(pk=lote["id"]).linhas_processadas)
        return original(*args, **kwargs)

    monkeypatch.setattr(importacao, "_criar_arvore", espiar)
    tasks.confirmar_importacao(fila[0])
    # O ponto de retomada só avança ao fim de cada bloco de duas linhas.
    assert vistos == [0, 0, 2, 2, 4]
    final = obter(cliente, lote)
    assert (final["linhas_processadas"], final["total_linhas"]) == (5, 5)


def test_falha_numa_linha_nao_derruba_o_resto(
    cliente, revisor, fila, limite_baixo, blocos_de_dois, monkeypatch
):
    lote = lote_pre_visualizado(cliente, revisor)
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    original = importacao._criar_arvore

    def quebrar_a_terceira(lote_, d, *args, **kwargs):
        original(lote_, d, *args, **kwargs)  # cria a árvore e só então falha
        if d["id_externo"] == "I3":
            raise RuntimeError("falha simulada")

    monkeypatch.setattr(importacao, "_criar_arvore", quebrar_a_terceira)
    tasks.confirmar_importacao(fila[0])

    final = obter(cliente, lote)
    assert final["estado"] == "confirmado"
    assert final["arvores_criadas"] == 4
    assert final["linhas_com_falha"] == 1
    assert [f["indice"] for f in final["falhas"]] == [3]
    # A linha que falhou foi desfeita por inteiro, sem árvore nem identificador pela metade.
    assert not IdentificadorExterno.objects.filter(valor="I3").exists()
    assert Arvore.objects.count() == 4


def test_nao_confirma_duas_vezes(cliente, revisor, fila, limite_baixo):
    lote = lote_pre_visualizado(cliente, revisor)
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 202
    # Lote já em processamento: o segundo pedido é recusado e não enfileira outra tarefa.
    segundo = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert segundo.status_code == 400
    assert fila == [lote["id"]]

    tasks.confirmar_importacao(fila[0])
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 400
    # Reentrega da mesma mensagem da fila: nada é criado de novo.
    tasks.confirmar_importacao(fila[0])
    assert Arvore.objects.count() == 5
    assert IdentificadorExterno.objects.count() == 5


def test_bloco_interrompido_nao_fica_meio_aplicado_e_retoma(
    cliente, revisor, fila, limite_baixo, blocos_de_dois, monkeypatch
):
    lote = lote_pre_visualizado(cliente, revisor)
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    original = importacao._criar_arvore
    chamadas = []

    def estragar_no_segundo_bloco(*args, **kwargs):
        original(*args, **kwargs)
        chamadas.append(1)
        if len(chamadas) == 3:  # primeira linha do segundo bloco: o gravar do bloco vai falhar
            monkeypatch.setattr(importacao, "LIMITE_FALHAS_GUARDADAS", None)

    monkeypatch.setattr(importacao, "_criar_arvore", estragar_no_segundo_bloco)
    tasks.confirmar_importacao(fila[0])

    parcial = obter(cliente, lote)
    assert parcial["estado"] == "interrompido"
    assert "confirme de novo" in parcial["erro"]
    # O primeiro bloco valeu por inteiro; o segundo foi desfeito junto com o ponto de retomada.
    assert parcial["linhas_processadas"] == 2
    assert Arvore.objects.count() == 2

    monkeypatch.setattr(importacao, "LIMITE_FALHAS_GUARDADAS", 500)
    monkeypatch.setattr(importacao, "_criar_arvore", original)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 202
    tasks.confirmar_importacao(fila[-1])
    final = obter(cliente, lote)
    assert final["estado"] == "confirmado"
    assert final["arvores_criadas"] == 5  # sem duplicar as duas primeiras
    assert IdentificadorExterno.objects.count() == 5


def test_sem_fila_o_lote_volta_a_poder_ser_confirmado(cliente, revisor, limite_baixo, monkeypatch):
    def sem_broker(_):
        raise ConnectionError("broker fora do ar")

    monkeypatch.setattr(tasks.confirmar_importacao, "delay", sem_broker)
    lote = lote_pre_visualizado(cliente, revisor)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 202
    assert r.json()["estado"] == "interrompido"
    assert "fila" in r.json()["erro"]


def test_confirmar_exige_permissao(cliente, revisor, tecnico_a, fila, limite_baixo):
    lote = lote_pre_visualizado(cliente, revisor)
    assert cliente.como(tecnico_a).post(f"{URL}/{lote['id']}/confirmar").status_code == 403
    assert fila == []
    assert obter(cliente.como(revisor), lote)["estado"] == "pre_visualizado"


def test_lote_de_outro_usuario_fora_do_alcance(cliente, revisor, territorios, fila, limite_baixo):
    lote = lote_pre_visualizado(cliente, revisor)
    restrito = com_escopo(
        criar_usuario("restrito@itree.teste", ["revisor"], registro_profissional="CREA 9"),
        territorios["a"],
    )
    r = cliente.como(restrito).post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 404
    assert fila == []


def test_escopo_reduzido_depois_da_previa_barra_a_confirmacao(
    cliente, revisor, territorios, fila, limite_baixo
):
    lote = enviar(cliente.como(revisor), csv(5, PONTO_B)).json()
    assert lote["linhas_validas"] == 5
    EscopoUsuario.objects.filter(usuario=revisor).delete()
    com_escopo(revisor, territorios["a"])  # o ponto está no Bairro B
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 400
    assert "escopo" in str(r.json())
    assert fila == []
    assert LoteImportacao.objects.get(pk=lote["id"]).estado == "pre_visualizado"


def test_bairro_resolvido_em_lote_sem_consulta_por_linha(
    cliente, revisor, territorios, fila, limite_baixo, monkeypatch
):
    def proibido(_geom):
        raise AssertionError("o bairro deve vir do resolvedor em lote")

    monkeypatch.setattr(models, "bairro_do_ponto", proibido)
    lote = lote_pre_visualizado(cliente, revisor, n=3)
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    executar_confirmacao(lote["id"])
    assert Arvore.objects.filter(bairro=territorios["a"]).count() == 3


def test_resolvedor_de_bairro_concorda_com_a_consulta_por_ponto(territorios):
    from django.contrib.gis.geos import Point

    resolvedor = ResolvedorDeBairro()
    pontos = [
        Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326),
        Point(PONTO_B["longitude"], PONTO_B["latitude"], srid=4326),
        Point(-38.0, -3.0, srid=4326),  # fora de qualquer bairro
    ]
    for p in pontos:
        esperado = bairro_do_ponto(p)
        assert resolvedor.id_do_ponto(p) == (esperado.pk if esperado else None)
    assert resolvedor.id_do_ponto(None) is None
