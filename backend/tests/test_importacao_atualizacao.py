"""Modo atualização, espécie por nome popular e duplicatas por proximidade na importação
(RF-INV-016 a RF-INV-018)."""

import pytest
from django.apps import apps
from django.contrib.gis.geos import Point

from itree.contas.models import EscopoUsuario
from itree.inventario import importacao, tasks
from itree.inventario.models import (
    Arvore,
    Especie,
    IdentificadorExterno,
    LoteImportacao,
    Medida,
)

from .conftest import PONTO_B, com_escopo, criar_usuario
from .test_importacao import URL, enviar

pytestmark = pytest.mark.django_db

CABECALHO = "codigo;especie;lat;lon;altura_m;dap_cm;rua\n"
PRIMEIRA = CABECALHO + (
    "A1;Licania tomentosa;-3,755;-38,555;8,5;30;Rua 1\n"
    "A2;Licania tomentosa;-3,7552;-38,5552;6;20;Rua 2\n"
)


@pytest.fixture
def licania(db):
    return Especie.objects.create(
        nome_cientifico="Licania tomentosa", nomes_comuns=["Oiti", "Oití-da-praia"]
    )


@pytest.fixture
def ipe(db):
    return Especie.objects.create(
        nome_cientifico="Handroanthus albus", nomes_comuns=["Ipê-amarelo"]
    )


def importar(cliente, conteudo, **opcoes):
    """Pré-visualiza e confirma; devolve o lote final."""
    lote = enviar(cliente, conteudo).json()
    r = cliente.post(f"{URL}/{lote['id']}/confirmar", opcoes, format="json")
    assert r.status_code == 200, r.json()
    return r.json()


def previa(cliente, conteudo, **campos):
    r = enviar(cliente, conteudo, **campos)
    assert r.status_code == 201, r.json()
    return r.json()


def linha(lote, indice):
    return next(x for x in lote["linhas"] if x["indice"] == indice)


# --- Espécie por nome popular -----------------------------------------------------------------


def test_nome_popular_sem_acento_e_sem_caixa_casa_uma_especie(cliente, revisor, licania):
    lote = previa(
        cliente.como(revisor),
        CABECALHO + "P1;OITÍ;-3,755;-38,555;;;\nP2;oiti-da-praia;-3,756;-38,556;;;\n",
    )
    for indice in (1, 2):
        dados = linha(lote, indice)["dados"]
        assert dados["especie_id"] == str(licania.id)
        assert dados["especie_via"] == "nome_popular"
        assert any("nome popular de Licania tomentosa" in a for a in linha(lote, indice)["avisos"])
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    arvore = Arvore.objects.get(identificadores__valor="P1")
    assert arvore.especie == licania
    assert arvore.especie_estado == "informada"  # nunca "confirmada" por nome popular
    assert arvore.especie_texto_original == "OITÍ"


def test_nome_cientifico_tem_prioridade_e_ignora_acento_e_caixa(cliente, revisor, licania):
    lote = previa(cliente.como(revisor), CABECALHO + "P1;LICANIA TOMENTOSA;-3,755;-38,555;;;\n")
    assert linha(lote, 1)["dados"]["especie_id"] == str(licania.id)
    assert "especie_via" not in linha(lote, 1)["dados"]


def test_nome_popular_ambiguo_fica_sem_especie_e_aparece_na_previa(cliente, revisor, licania):
    outra = Especie.objects.create(nome_cientifico="Outra oiti", nomes_comuns=["Oiti"])
    lote = previa(cliente.como(revisor), CABECALHO + "P1;oiti;-3,755;-38,555;;;\n")
    l1 = linha(lote, 1)
    assert "especie_id" not in l1["dados"]
    assert l1["especie_ambigua"] == sorted([licania.nome_cientifico, outra.nome_cientifico])
    assert any("ambíguo" in a for a in l1["avisos"]) and l1["erros"] == []
    assert lote["resumo"]["ambiguas"] == 1
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    arvore = Arvore.objects.get()
    assert arvore.especie is None and arvore.especie_texto_original == "oiti"


def test_nome_popular_de_especie_inativa_nao_casa(cliente, revisor, licania):
    licania.ativa = False
    licania.save()
    lote = previa(cliente.como(revisor), CABECALHO + "P1;oiti;-3,755;-38,555;;;\n")
    assert "especie_id" not in linha(lote, 1)["dados"] and "especie_ambigua" not in linha(lote, 1)


# --- Duplicatas por proximidade ---------------------------------------------------------------


def arvore_em(longitude, latitude, **extras):
    return Arvore.objects.create(
        geom=Point(longitude, latitude, srid=4326),
        localizacao_origem="gps_campo",
        origem_registro="app",
        **extras,
    )


def test_linha_nova_colada_a_arvore_existente_e_apontada(cliente, revisor, territorios):
    existente = arvore_em(-38.555, -3.755)
    inativa = arvore_em(-38.5560, -3.7560, situacao="excluida")
    csv = CABECALHO + (
        "D1;;-3,75500900;-38,555;;;\n"  # ~1 m ao sul/norte da existente
        "D2;;-3,7552;-38,5552;;;\n"  # ~30 m
        "D3;;-3,7560;-38,5560;;;\n"  # em cima da excluída: não conta
    )
    lote = previa(cliente.como(revisor), csv)
    d1 = linha(lote, 1)
    assert d1["duplicata"]["arvore_id"] == str(existente.id)
    assert d1["duplicata"]["codigo"] == existente.codigo
    assert d1["duplicata"]["distancia_m"] < 2
    assert d1["erros"] == [] and any("possível duplicata" in a for a in d1["avisos"])
    assert "duplicata" not in linha(lote, 2) and "duplicata" not in linha(lote, 3)
    assert lote["resumo"]["duplicatas"] == 1 and lote["linhas_validas"] == 3
    assert inativa.pk  # a excluída existe, mas não conta como duplicata


def test_raio_das_duplicatas_vem_da_configuracao(cliente, revisor, territorios, settings):
    arvore_em(-38.555, -3.755)
    csv = CABECALHO + "D1;;-3,75500900;-38,555;;;\n"
    settings.IMPORTACAO_RAIO_DUPLICATAS_M = 0.5
    assert "duplicata" not in linha(previa(cliente.como(revisor), csv), 1)
    settings.IMPORTACAO_RAIO_DUPLICATAS_M = 5
    assert "duplicata" in linha(previa(cliente, csv), 1)


def test_ignorar_duplicatas_na_confirmacao(cliente, revisor, territorios):
    arvore_em(-38.555, -3.755)
    csv = CABECALHO + "D1;;-3,75500900;-38,555;;;\nD2;;-3,7552;-38,5552;;;\n"
    lote = previa(cliente.como(revisor), csv)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar", {"ignorar_duplicatas": True}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["ignorar_duplicatas"] is True and r.json()["linhas_ignoradas"] == 1
    assert list(IdentificadorExterno.objects.values_list("valor", flat=True)) == ["D2"]

    # Sem a opção, a duplicata apontada é criada mesmo assim (nada é descartado calado).
    lote = previa(cliente, CABECALHO + "D3;;-3,75500900;-38,555;;;\n")
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 200
    assert IdentificadorExterno.objects.filter(valor="D3").exists()


def test_duplicata_so_considera_arvores_do_escopo(cliente, territorios):
    so_a = com_escopo(
        criar_usuario("so_a@itree.teste", ["revisor"], registro_profissional="CREA 1"),
        territorios["a"],
    )
    arvore_em(PONTO_B["longitude"], PONTO_B["latitude"])
    # Ponto de A (no limite com B) colado a uma árvore de B: a de B não aparece para quem só vê A.
    lote = previa(cliente.como(so_a), CABECALHO + "D1;;-3,755;-38,5550;;;\n")
    assert "duplicata" not in linha(lote, 1)


# --- Modo atualização -------------------------------------------------------------------------

SEGUNDA = CABECALHO + (
    "A1;Licania tomentosa;-3,7551;-38,5551;9;30;Rua 1 (nova)\n"  # endereço, local e altura mudam
    "A2;Licania tomentosa;-3,7552;-38,5552;6;20;Rua 2\n"  # igual: sem mudança
    "A3;Licania tomentosa;-3,7570;-38,5570;4;;Rua 3\n"  # nova
)


@pytest.fixture
def base(cliente, revisor, licania):
    """Duas árvores importadas (A1, A2) da fonte "Inventário 2019"."""
    cliente.como(revisor)
    importar(cliente, PRIMEIRA)
    return cliente


def test_previa_mostra_o_relatorio_de_diferencas_e_nao_grava(base):
    antes = Arvore.objects.get(identificadores__valor="A1")
    lote = previa(base, SEGUNDA)
    assert lote["resumo"] == {
        "a_criar": 1,
        "a_atualizar": 1,
        "sem_mudanca": 1,
        "duplicatas": 0,
        "ambiguas": 0,
    }
    existente = linha(lote, 1)["existente"]
    assert existente["arvore_id"] == str(antes.id) and existente["codigo"] == antes.codigo
    mudancas = {d["campo"]: d for d in existente["diferencas"]}
    assert set(mudancas) == {"endereco", "localizacao", "altura"}
    assert (mudancas["endereco"]["antigo"], mudancas["endereco"]["novo"]) == (
        "Rua 1",
        "Rua 1 (nova)",
    )
    assert (mudancas["altura"]["antigo"], mudancas["altura"]["novo"]) == ("8,50", "9,00")
    assert mudancas["localizacao"]["antigo"] == "-3,755, -38,555"
    assert mudancas["localizacao"]["novo"] == "-3,7551, -38,5551"
    assert linha(lote, 2)["existente"]["diferencas"] == []
    assert "existente" not in linha(lote, 3)
    # A previa nunca altera nada.
    antes.refresh_from_db()
    assert antes.endereco == "Rua 1" and Arvore.objects.count() == 2


def test_modo_criar_continua_so_criando(base):
    lote = previa(base, SEGUNDA)
    r = base.post(f"{URL}/{lote['id']}/confirmar")  # sem corpo: modo criar
    assert r.status_code == 200 and r.json()["modo"] == "criar"
    assert (r.json()["linhas_atualizadas"], r.json()["linhas_ignoradas"]) == (0, 2)
    assert Arvore.objects.count() == 3
    assert Arvore.objects.get(identificadores__valor="A1").endereco == "Rua 1"
    assert Medida.objects.filter(arvore__identificadores__valor="A1").count() == 2


def test_modo_atualizar_aplica_so_o_que_a_previa_mostrou(base):
    a2_antes = Arvore.objects.get(identificadores__valor="A2").atualizado_em
    lote = previa(base, SEGUNDA)
    r = base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 200, r.json()
    corpo = r.json()
    assert (corpo["modo"], corpo["linhas_atualizadas"], corpo["linhas_ignoradas"]) == (
        "atualizar",
        1,
        1,
    )
    assert corpo["arvores_criadas"] == 1 and Arvore.objects.count() == 3

    a1 = Arvore.objects.get(identificadores__valor="A1")
    assert a1.endereco == "Rua 1 (nova)"
    assert (a1.geom.x, a1.geom.y) == (-38.5551, -3.7551)
    assert a1.lote_id != corpo["id"]  # continua no lote de origem; o lote novo só criou A3
    # Medidas: a anterior fica, a nova entra como medida importada da fonte.
    alturas = Medida.objects.filter(arvore=a1, tipo="altura").order_by("criado_em")
    assert [str(m.valor) for m in alturas] == ["8.50", "9.00"]
    assert alturas.last().origem == "importado" and alturas.last().responsavel_texto == (
        "Inventário 2019"
    )
    assert Medida.objects.filter(arvore=a1, tipo="dap").count() == 1  # DAP igual: sem nova medida
    a2 = Arvore.objects.get(identificadores__valor="A2")
    assert a2.atualizado_em == a2_antes and Medida.objects.filter(arvore=a2).count() == 2


def test_atualizacao_fica_na_auditoria_com_o_contexto_do_lote(base):
    lote = previa(base, SEGUNDA)
    base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    a1 = Arvore.objects.get(identificadores__valor="A1")
    evento = (
        apps.get_model("inventario", "ArvoreEvent")
        .objects.filter(pgh_obj_id=a1.pk, pgh_label="update")
        .select_related("pgh_context")
        .get()
    )
    contexto = evento.pgh_context.metadata
    assert contexto["lote"] == LoteImportacao.objects.get(pk=lote["id"]).numero
    assert contexto["modo"] == "atualizar" and contexto["evento"] == "importacao_inventario"


def test_localizacao_so_muda_se_a_origem_atual_e_importada(base):
    a1 = Arvore.objects.get(identificadores__valor="A1")
    a1.localizacao_origem = "gps_campo"
    a1.save()
    lote = previa(base, SEGUNDA)
    campos = {d["campo"] for d in linha(lote, 1)["existente"]["diferencas"]}
    assert campos == {"endereco", "altura"}
    assert any("Localização mantida" in a for a in linha(lote, 1)["avisos"])
    base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    a1.refresh_from_db()
    assert (a1.geom.x, a1.geom.y) == (-38.555, -3.755) and a1.endereco == "Rua 1 (nova)"


def test_especie_informada_e_atualizada_mas_confirmada_e_preservada(base, ipe):
    csv = CABECALHO + (
        "A1;Ipê-amarelo;-3,755;-38,555;8,5;30;Rua 1\nA2;Ipê-amarelo;-3,7552;-38,5552;6;20;Rua 2\n"
    )
    a2 = Arvore.objects.get(identificadores__valor="A2")
    a2.especie_estado = "confirmada"
    a2.save()
    lote = previa(base, csv)
    especie = {d["campo"]: d for d in linha(lote, 1)["existente"]["diferencas"]}["especie"]
    assert (especie["antigo"], especie["novo"]) == ("Licania tomentosa", "Handroanthus albus")
    assert linha(lote, 2)["existente"]["diferencas"] == []
    assert any("Espécie mantida" in a for a in linha(lote, 2)["avisos"])
    base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    a1 = Arvore.objects.get(identificadores__valor="A1")
    assert a1.especie == ipe and a1.especie_estado == "informada"
    a2.refresh_from_db()
    assert a2.especie.nome_cientifico == "Licania tomentosa" and a2.especie_estado == "confirmada"


def test_arvore_alterada_depois_da_previa_nao_e_sobrescrita(base):
    lote = previa(base, SEGUNDA)
    a1 = Arvore.objects.get(identificadores__valor="A1")
    a1.endereco = "Corrigido à mão"
    a1.save()
    r = base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 200 and r.json()["linhas_com_falha"] == 1
    assert r.json()["linhas_atualizadas"] == 0
    a1.refresh_from_db()
    assert a1.endereco == "Corrigido à mão" and a1.geom.x == -38.555
    falha = base.get(f"{URL}/{lote['id']}").json()["falhas"][0]
    assert falha["indice"] == 1 and "mudou depois da pré-visualização" in falha["motivo"]


def test_lote_que_atualizou_nao_pode_ser_desfeito(base):
    lote = previa(base, SEGUNDA)
    base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    detalhe = base.get(f"{URL}/{lote['id']}").json()
    assert detalhe["pode_desfazer"] is False
    assert "atualizou árvores já existentes" in detalhe["motivo_nao_desfazer"]
    r = base.post(f"{URL}/{lote['id']}/desfazer", {"motivo": "x"}, format="json")
    assert r.status_code == 400 and Arvore.objects.count() == 3


def test_modo_invalido_e_recusado(base):
    lote = previa(base, SEGUNDA)
    r = base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "apagar"}, format="json")
    assert r.status_code == 400
    assert LoteImportacao.objects.get(pk=lote["id"]).estado == "pre_visualizado"


def test_atualizar_exige_permissao_de_importar(cliente, tecnico_a, base):
    lote = previa(base, SEGUNDA)
    r = cliente.como(tecnico_a).post(
        f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json"
    )
    assert r.status_code == 403


def test_arvore_de_outro_territorio_nao_aparece_nem_e_atualizada(cliente, base, territorios):
    """Quem só vê o bairro A não enxerga nem altera a árvore do bairro B pelo identificador."""
    base.post(  # árvore do bairro B, já importada pela fonte
        f"{URL}/{previa(base, CABECALHO + 'B1;Licania tomentosa;-3,755;-38,535;7;;Rua B\n')['id']}"
        "/confirmar"
    )
    arvore_b = Arvore.objects.get(identificadores__valor="B1")
    so_a = com_escopo(
        criar_usuario("so_a@itree.teste", ["revisor"], registro_profissional="CREA 1"),
        territorios["a"],
    )
    csv = CABECALHO + "B1;Licania tomentosa;-3,755;-38,555;9;;Rua invadida\n"
    lote = previa(cliente.como(so_a), csv)
    l1 = linha(lote, 1)
    assert "existente" not in l1  # nada do estado atual da árvore de B vaza na previa
    assert any("fora do seu escopo territorial" in e for e in l1["erros"])
    assert "Rua B" not in str(lote)
    r = cliente.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 200 and r.json()["linhas_atualizadas"] == 0
    arvore_b.refresh_from_db()
    assert arvore_b.endereco == "Rua B"


def test_escopo_reduzido_entre_previa_e_confirmacao_recusa_a_atualizacao(
    cliente, base, territorios
):
    lote = previa(base, SEGUNDA)  # A1 e A2 estão em A; A3 também
    EscopoUsuario.objects.filter(usuario__email="revisor@itree.teste").delete()
    com_escopo(
        criar_usuario("revisor2@itree.teste", ["revisor"], registro_profissional="CREA 9"),
        territorios["b"],
    )
    r = base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 400  # sem escopo algum: nada é gravado
    assert Arvore.objects.get(identificadores__valor="A1").endereco == "Rua 1"


def test_atualizacao_grande_vai_para_segundo_plano_e_mantem_o_modo(base, monkeypatch, settings):
    settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = 1
    fila = []
    monkeypatch.setattr(tasks.confirmar_importacao, "delay", lambda i: fila.append(i))
    lote = previa(base, SEGUNDA)  # 1 a atualizar + 1 a criar = 2 > 1
    r = base.post(f"{URL}/{lote['id']}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 202 and r.json()["modo"] == "atualizar"
    assert Arvore.objects.get(identificadores__valor="A1").endereco == "Rua 1"  # ainda nada
    tasks.confirmar_importacao(fila[0])
    final = base.get(f"{URL}/{lote['id']}").json()
    assert final["estado"] == "confirmado" and final["linhas_atualizadas"] == 1
    assert Arvore.objects.get(identificadores__valor="A1").endereco == "Rua 1 (nova)"


def test_so_conta_para_o_limite_o_que_sera_gravado(base, settings):
    settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = 1
    lote = previa(base, SEGUNDA)  # no modo criar, só A3 conta (1 <= 1): imediato
    r = base.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 200


def test_lote_antigo_sem_existente_continua_ignorando_o_identificador_repetido(base):
    lote_id = previa(base, SEGUNDA)["id"]
    lote = LoteImportacao.objects.get(pk=lote_id)
    for linha_ in lote.linhas:  # lote guardado antes desta versão: sem o campo `existente`
        linha_.pop("existente", None)
    lote.save()
    r = base.post(f"{URL}/{lote_id}/confirmar", {"modo": "atualizar"}, format="json")
    assert r.status_code == 200 and r.json()["linhas_atualizadas"] == 0
    assert Arvore.objects.get(identificadores__valor="A1").endereco == "Rua 1"


def test_classificar_linhas():
    existente = {"arvore_id": "x", "codigo": "ARV-1", "diferencas": [{"campo": "endereco"}]}
    ja = importacao.MSG_JA_IMPORTADO
    assert importacao.classificar({"erros": [], "dados": {}}, "criar", False) == "criar"
    assert importacao.classificar({"erros": ["x"]}, "criar", False) == "invalida"
    assert (
        importacao.classificar({"erros": [], "duplicata": {"codigo": "A"}}, "criar", True)
        == "ignorar"
    )
    assert (
        importacao.classificar({"erros": [ja], "existente": existente}, "atualizar", False)
        == "atualizar"
    )
    assert (
        importacao.classificar({"erros": [ja], "existente": existente}, "criar", False) == "ignorar"
    )
    assert (
        importacao.classificar({"erros": [ja, "outro"], "existente": existente}, "atualizar", False)
        == "invalida"
    )


def test_lote_anterior_ao_resumo_continua_listavel(cliente, revisor):
    """Lotes gravados antes da migração 0009 têm ``resumo`` vazio: a lista não pode quebrar."""
    LoteImportacao.objects.create(
        arquivo_nome="antigo.csv", formato="csv", fonte="Base antiga", usuario=revisor, resumo={}
    )
    r = cliente.como(revisor).get(URL)
    assert r.status_code == 200
    assert r.json()["results"][0]["resumo"] == {
        "a_criar": 0,
        "a_atualizar": 0,
        "sem_mudanca": 0,
        "duplicatas": 0,
        "ambiguas": 0,
    }
