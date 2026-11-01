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
    assert corpo == {"total": 2, "validos": 1}


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
    assert "m de distância" in pares[0]["criterio"]

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
