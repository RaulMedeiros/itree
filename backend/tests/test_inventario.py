import re
import uuid

import pytest

from itree.inventario.models import Arvore, Especie, Medida

from .conftest import PONTO_A, PONTO_B

pytestmark = pytest.mark.django_db

URL = "/api/v1/arvores"


def criar(cliente, usuario, **dados):
    corpo = {"localizacao": PONTO_A, **dados}
    return cliente.como(usuario).post(URL, corpo, format="json")


@pytest.fixture
def ipe(db):
    return Especie.objects.create(
        nome_cientifico="Handroanthus impetiginosus", nomes_comuns=["Ipê-roxo"]
    )


def test_criar_arvore_deriva_bairro_codigo_e_origem(cliente, tecnico_a, territorios):
    r = criar(cliente, tecnico_a, endereco="Rua 1, 100")
    assert r.status_code == 201, r.json()
    corpo = r.json()
    assert corpo["codigo"].startswith("ARV-")
    assert corpo["bairro"]["nome"] == "Bairro A"
    assert corpo["localizacao_origem"] == "estimada_web"
    assert corpo["origem_registro"] == "web"
    assert corpo["especie_estado"] == "nao_identificada"
    assert corpo["valida"] is True


def test_numeros_sao_sequenciais(cliente, tecnico_a):
    c1 = criar(cliente, tecnico_a).json()["codigo"]
    c2 = criar(cliente, tecnico_a).json()["codigo"]
    assert int(c2[4:]) == int(c1[4:]) + 1


def test_criar_fora_do_escopo_e_recusado(cliente, tecnico_a):
    r = criar(cliente, tecnico_a, localizacao=PONTO_B)
    assert r.status_code == 400
    assert "escopo" in r.json()["localizacao"][0]


def test_gps_de_campo_nao_pode_vir_do_web(cliente, tecnico_a):
    r = criar(cliente, tecnico_a, localizacao_origem="gps_campo")
    assert r.status_code == 400


def test_consulta_nao_cria(cliente, territorios):
    from .conftest import com_escopo, criar_usuario

    leitor = com_escopo(criar_usuario("c@itree.teste", ["consulta"]), territorios["municipio"])
    assert criar(cliente, leitor).status_code == 403


def test_escopo_na_listagem(cliente, tecnico_a, revisor):
    criar(cliente, revisor, localizacao=PONTO_A)
    criar(cliente, revisor, localizacao=PONTO_B)
    Arvore.objects.create(origem_registro="importacao")  # sem localização
    assert cliente.como(revisor).get(URL).json()["count"] == 3
    assert cliente.como(tecnico_a).get(URL).json()["count"] == 1


def test_contadores_distinguem_total_e_validos(cliente, revisor):
    criar(cliente, revisor)
    Arvore.objects.create(origem_registro="importacao")
    corpo = cliente.como(revisor).get(f"{URL}/contadores").json()
    assert corpo["total"] == 2 and corpo["validos"] == 1


def test_busca_por_codigo(cliente, revisor):
    codigo = criar(cliente, revisor).json()["codigo"]
    criar(cliente, revisor)
    r = cliente.como(revisor).get(URL, {"busca": codigo.lower()}).json()
    assert [a["codigo"] for a in r["results"]] == [codigo]


def test_filtro_com_uuid_invalido_responde_400(cliente, revisor):
    assert cliente.como(revisor).get(URL, {"especie": "xyz"}).status_code == 400


def test_so_revisor_confirma_especie(cliente, tecnico_a, revisor, ipe):
    arvore = criar(cliente, tecnico_a).json()
    dados = {"especie_id": str(ipe.id), "especie_estado": "confirmada"}
    r = cliente.como(tecnico_a).patch(f"{URL}/{arvore['id']}", dados, format="json")
    assert r.status_code == 400
    r = cliente.como(revisor).patch(f"{URL}/{arvore['id']}", dados, format="json")
    assert r.status_code == 200
    assert r.json()["especie"]["nome_cientifico"] == "Handroanthus impetiginosus"


def test_alterar_especie_confirmada_exige_justificativa(cliente, revisor, ipe):
    outra = Especie.objects.create(nome_cientifico="Licania tomentosa")
    arvore = criar(cliente, revisor, especie_id=str(ipe.id), especie_estado="confirmada").json()
    url = f"{URL}/{arvore['id']}"
    assert cliente.patch(url, {"especie_id": str(outra.id)}, format="json").status_code == 400
    r = cliente.patch(
        url, {"especie_id": str(outra.id), "motivo": "Revisão de campo"}, format="json"
    )
    assert r.status_code == 200
    historico = cliente.get(f"{url}/historico").json()
    alteracao = next(e for e in historico if e["acao"] == "alteracao")
    assert alteracao["contexto"]["motivo"] == "Revisão de campo"


def test_medidas_com_origem_e_metodo(cliente, tecnico_a):
    arvore = criar(cliente, tecnico_a).json()
    url = f"{URL}/{arvore['id']}/medidas"
    r = cliente.post(
        url,
        {"tipo": "altura", "valor": "8.5", "metodo": "visual", "origem": "medido"},
        format="json",
    )
    assert r.status_code == 400  # estimativa visual não é medida
    r = cliente.post(
        url,
        {
            "tipo": "dap",
            "valor": "32",
            "metodo": "fita_diametrica",
            "origem": "medido",
            "data_medicao": "2026-10-01",
        },
        format="json",
    )
    assert r.status_code == 201, r.json()
    assert r.json()["unidade"] == "cm"
    detalhe = cliente.get(f"{URL}/{arvore['id']}").json()
    assert [m["tipo"] for m in detalhe["medidas_atuais"]] == ["dap"]
    assert any(
        e["entidade"] == "Medida" for e in cliente.get(f"{URL}/{arvore['id']}/historico").json()
    )


def test_exclusao_logica_com_justificativa(cliente, tecnico_a, revisor):
    arvore = criar(cliente, tecnico_a).json()
    url = f"{URL}/{arvore['id']}/excluir"
    assert cliente.como(tecnico_a).post(url, {"motivo": "x"}, format="json").status_code == 403
    assert cliente.como(revisor).post(url, {}, format="json").status_code == 400
    r = cliente.post(url, {"motivo": "Árvore suprimida com autorização 12/2026"}, format="json")
    assert r.json()["situacao"] == "excluida"
    assert Arvore.objects.filter(pk=arvore["id"]).exists()  # nunca apagada
    assert (
        cliente.patch(f"{URL}/{arvore['id']}", {"endereco": "x"}, format="json").status_code == 400
    )
    assert cliente.get(URL).json()["count"] == 0
    assert cliente.get(URL, {"situacao": "todas"}).json()["count"] == 1


def test_duplicidades_revisao_e_fusao(cliente, revisor, ipe):
    a = criar(cliente, revisor, localizacao={"longitude": -38.555, "latitude": -3.755}).json()
    b = criar(
        cliente,
        revisor,
        localizacao={"longitude": -38.55501, "latitude": -3.75501},
        especie_id=str(ipe.id),
    ).json()
    criar(cliente, revisor, localizacao={"longitude": -38.551, "latitude": -3.751})  # longe

    pares = cliente.get(f"{URL}/duplicidades").json()
    assert len(pares) == 1
    assert {pares[0]["arvore_a"]["id"], pares[0]["arvore_b"]["id"]} == {a["id"], b["id"]}
    assert re.search(r"a \d+,\d m de distância", pares[0]["criterio"])

    cliente.post(
        f"{URL}/{b['id']}/medidas",
        {"tipo": "altura", "valor": "7", "metodo": "trena", "origem": "medido"},
        format="json",
    )
    sem_motivo = cliente.post(f"{URL}/{a['id']}/fundir", {"descartar": b["id"]}, format="json")
    assert sem_motivo.status_code == 400
    r = cliente.post(
        f"{URL}/{a['id']}/fundir",
        {"descartar": b["id"], "campos_da_outra": ["especie"], "motivo": "Mesmo indivíduo"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["especie"]["id"] == str(ipe.id)
    assert Medida.objects.get().arvore_id.hex == a["id"].replace("-", "")
    fundida = cliente.get(f"{URL}/{b['id']}").json()
    assert fundida["situacao"] == "fundida"
    assert fundida["fundida_em"] == a["id"]
    assert cliente.get(f"{URL}/duplicidades").json() == []


def test_par_nao_duplicado_sai_da_fila(cliente, revisor):
    a = criar(cliente, revisor, localizacao={"longitude": -38.555, "latitude": -3.755}).json()
    b = criar(cliente, revisor, localizacao={"longitude": -38.55501, "latitude": -3.755}).json()
    r = cliente.post(
        f"{URL}/nao-duplicadas", {"arvore_a": b["id"], "arvore_b": a["id"]}, format="json"
    )
    assert r.status_code == 204
    assert cliente.get(f"{URL}/duplicidades").json() == []


def test_catalogo_de_especies(cliente, admin, tecnico_a, ipe):
    assert cliente.como(tecnico_a).get("/api/v1/especies", {"busca": "ipê"}).json()["count"] == 1
    assert (
        cliente.post("/api/v1/especies", {"nome_cientifico": "X y"}, format="json").status_code
        == 403
    )
    r = cliente.como(admin).post(
        "/api/v1/especies", {"nome_cientifico": "Cassia fistula"}, format="json"
    )
    assert r.status_code == 201


@pytest.fixture
def arvores_ordenaveis(territorios):
    """Quatro árvores com condição e última inspeção diferentes (uma nunca inspecionada)."""
    from datetime import timedelta

    from django.utils import timezone

    agora = timezone.now()
    dados = [
        ("boa", agora - timedelta(days=10)),
        ("ruim", agora - timedelta(days=100)),
        ("regular", None),
        ("", agora - timedelta(days=50)),
    ]
    arvores = []
    for condicao, inspecao in dados:
        arvores.append(
            Arvore.objects.create(
                geom=_ponto(PONTO_A),
                bairro=territorios["a"],
                localizacao_origem="estimada_web",
                condicao_aparente=condicao,
                ultima_inspecao_em=inspecao,
            )
        )
    return arvores  # [boa, ruim, regular, sem condição]


def _ponto(p):
    from django.contrib.gis.geos import Point

    return Point(p["longitude"], p["latitude"], srid=4326)


def _codigos(cliente, **params):
    r = cliente.get(URL, params)
    assert r.status_code == 200, r.json()
    return [a["codigo"] for a in r.json()["results"]]


def test_ordenar_por_ultima_inspecao_deixa_sem_inspecao_no_fim(
    cliente, gestor_municipal, arvores_ordenaveis
):
    cliente.como(gestor_municipal)
    boa, ruim, sem_inspecao, sem_condicao = (a.codigo for a in arvores_ordenaveis)
    # Crescente: a inspeção mais antiga primeiro.
    assert _codigos(cliente, ordenar="ultima_inspecao_em") == [
        ruim,
        sem_condicao,
        boa,
        sem_inspecao,
    ]
    # Decrescente: a mais recente primeiro; nunca inspecionada continua no fim.
    assert _codigos(cliente, ordenar="-ultima_inspecao_em") == [
        boa,
        sem_condicao,
        ruim,
        sem_inspecao,
    ]


def test_ordenar_por_condicao_aparente_do_melhor_ao_pior_e_sem_avaliacao_no_fim(
    cliente, gestor_municipal, arvores_ordenaveis
):
    cliente.como(gestor_municipal)
    boa, ruim, regular, sem_condicao = (a.codigo for a in arvores_ordenaveis)
    assert _codigos(cliente, ordenar="condicao_aparente") == [boa, regular, ruim, sem_condicao]
    # Do pior para o melhor, sem avaliação continua no fim.
    assert _codigos(cliente, ordenar="-condicao_aparente") == [ruim, regular, boa, sem_condicao]


def test_ordenacao_desconhecida_mantem_a_padrao(cliente, gestor_municipal, arvores_ordenaveis):
    cliente.como(gestor_municipal)
    padrao = _codigos(cliente)
    assert _codigos(cliente, ordenar="endereco") == padrao
    assert padrao == sorted(padrao, reverse=True)


def test_filtro_ids_limita_a_lista_e_a_exportacao(cliente, gestor_municipal, arvores_ordenaveis):
    cliente.como(gestor_municipal)
    escolhidas = arvores_ordenaveis[:2]
    ids = ",".join(str(a.id) for a in escolhidas)
    assert sorted(_codigos(cliente, ids=ids)) == sorted(a.codigo for a in escolhidas)
    r = cliente.get(
        "/api/v1/relatorios/exportar", {"conjunto": "arvores", "formato": "csv", "ids": ids}
    )
    assert r.status_code == 200
    dados = [ln for ln in r.content.decode("utf-8-sig").splitlines() if not ln.startswith("#")]
    assert len(dados) - 1 == 2
    assert cliente.get(URL, {"ids": "nao-e-uuid"}).status_code == 400


def test_exportar_arvores_por_post_com_ids_sem_limite_de_url(
    cliente, gestor_municipal, arvores_ordenaveis
):
    cliente.como(gestor_municipal)
    ids = [str(a.id) for a in arvores_ordenaveis[:2]]
    r = cliente.post(
        "/api/v1/relatorios/exportar-arvores", {"formato": "csv", "ids": ids}, format="json"
    )
    assert r.status_code == 200, r.content
    dados = [ln for ln in r.content.decode("utf-8-sig").splitlines() if not ln.startswith("#")]
    assert len(dados) - 1 == 2
    # Mesmo com milhares de ids (que estourariam a URL), o pedido é aceito.
    muitos = ids + [str(uuid.uuid4()) for _ in range(3000)]
    r = cliente.post(
        "/api/v1/relatorios/exportar-arvores", {"formato": "csv", "ids": muitos}, format="json"
    )
    assert r.status_code == 200
    dados = [ln for ln in r.content.decode("utf-8-sig").splitlines() if not ln.startswith("#")]
    assert len(dados) - 1 == 2


def test_exportar_arvores_por_post_usa_os_filtros_quando_todos_filtrados(
    cliente, gestor_municipal, arvores_ordenaveis
):
    cliente.como(gestor_municipal)
    r = cliente.post(
        "/api/v1/relatorios/exportar-arvores",
        {"formato": "csv", "todos_filtrados": True, "filtros": {"condicao_aparente": "ruim"}},
        format="json",
    )
    assert r.status_code == 200
    dados = [ln for ln in r.content.decode("utf-8-sig").splitlines() if not ln.startswith("#")]
    assert len(dados) - 1 == 1 and arvores_ordenaveis[1].codigo in dados[1]


def test_exportar_arvores_por_post_exige_ids_ou_todos_filtrados_e_permissao(
    cliente, gestor_municipal, tecnico_a, arvores_ordenaveis
):
    url = "/api/v1/relatorios/exportar-arvores"
    cliente.como(gestor_municipal)
    assert cliente.post(url, {"formato": "csv"}, format="json").status_code == 400
    corpo = {"formato": "csv", "todos_filtrados": True, "ids": [str(arvores_ordenaveis[0].id)]}
    assert cliente.post(url, corpo, format="json").status_code == 400
    assert cliente.post(url, {"formato": "pdf", "ids": ["x"]}, format="json").status_code == 400
    corpo = {"formato": "csv", "ids": [str(arvores_ordenaveis[0].id)]}
    assert cliente.como(tecnico_a).post(url, corpo, format="json").status_code == 403


def test_contadores_informam_o_limite_do_lote_de_tarefas(cliente, gestor_municipal):
    from itree.core.parametros import LIMITE_LOTE

    corpo = cliente.como(gestor_municipal).get(f"{URL}/contadores").json()
    assert corpo["limite_tarefas_em_lote"] == LIMITE_LOTE


def test_filtro_especie_nao_confirmada_exclui_so_as_confirmadas(cliente, revisor, ipe):
    confirmada = criar(cliente, revisor, especie_id=str(ipe.id), especie_estado="confirmada").json()
    informada = criar(cliente, revisor, especie_id=str(ipe.id), especie_estado="informada").json()
    sem_especie = criar(cliente, revisor).json()
    r = cliente.como(revisor).get(URL, {"especie_estado": "nao_confirmada"}).json()
    ids = {a["id"] for a in r["results"]}
    assert ids == {informada["id"], sem_especie["id"]}
    assert confirmada["id"] not in ids


def test_ordenar_por_atraso_poe_as_nunca_inspecionadas_no_topo(
    cliente, gestor_municipal, arvores_ordenaveis
):
    """M-15: nunca inspecionadas primeiro; depois a inspeção mais antiga para a mais recente."""
    cliente.como(gestor_municipal)
    boa, ruim, sem_inspecao, sem_condicao = (a.codigo for a in arvores_ordenaveis)
    assert _codigos(cliente, ordenar="atraso") == [sem_inspecao, ruim, sem_condicao, boa]
    # A ordenação por última inspeção segue deixando as nunca inspecionadas no fim.
    assert _codigos(cliente, ordenar="ultima_inspecao_em")[-1] == sem_inspecao


def test_atraso_desempata_as_nunca_inspecionadas_pelo_numero(
    cliente, gestor_municipal, territorios
):
    for _ in range(3):
        Arvore.objects.create(
            geom=_ponto(PONTO_A), bairro=territorios["a"], localizacao_origem="estimada_web"
        )
    cliente.como(gestor_municipal)
    codigos = _codigos(cliente, ordenar="atraso")
    assert codigos == sorted(codigos)
