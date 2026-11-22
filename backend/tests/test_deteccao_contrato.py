"""Contrato de dados da detecção: validação e recusa de foto sem anonimização."""

import pytest

from itree.deteccao import contrato
from itree.deteccao.contrato import ErroContrato, RecusaDeteccao, validar_deteccao, validar_lote

from .deteccao_util import det, foto, lote


def test_lote_valido_normaliza_a_data_e_a_area():
    meta = validar_lote(
        lote(
            area_coberta={
                "type": "Polygon",
                "coordinates": [[[-38.6, -3.8], [-38.5, -3.8], [-38.5, -3.7], [-38.6, -3.8]]],
            }
        )
    )
    assert meta["capturado_em"].isoformat() == "2026-11-20"
    assert meta["area_coberta"].geom_type == "MultiPolygon"


@pytest.mark.parametrize(
    "mudanca",
    [{"sensor": "drone"}, {"id": ""}, {"capturado_em": "ontem"}, {"versao_modelo": None}],
)
def test_lote_invalido_e_recusado_inteiro(mudanca):
    with pytest.raises(ErroContrato):
        validar_lote(lote(**mudanca))


def test_sensor_so_aceita_satelite_ou_video_rua():
    assert validar_lote(lote(sensor="satelite"))["sensor"] == "satelite"
    with pytest.raises(ErroContrato, match="sensor"):
        validar_lote(lote(sensor="lidar"))


def test_foto_sem_anonimizacao_recusa_a_deteccao():
    sem = {"arquivo": "a.png", "capturada_em": "2026-11-20T10:00:00-03:00"}
    falsa = {**sem, "anonimizada": False}
    textual = {**sem, "anonimizada": "true"}  # só o booleano true vale
    for f in (sem, falsa, textual):
        with pytest.raises(RecusaDeteccao, match="anonimizada"):
            validar_deteccao(det(fotos=[f]))
    assert validar_deteccao(det(fotos=[foto()]))["fotos"][0]["anonimizada"] is True


def test_foto_precisa_de_arquivo_ou_url_e_de_data():
    with pytest.raises(RecusaDeteccao, match="arquivo"):
        validar_deteccao(det(fotos=[foto(url="https://x.test/a.jpg")]))
    with pytest.raises(RecusaDeteccao, match="capturada_em"):
        validar_deteccao(det(fotos=[{"arquivo": "a.png", "anonimizada": True}]))


def test_limite_de_fotos_por_deteccao(settings):
    settings.DETECCAO_MAX_FOTOS_POR_DETECCAO = 2
    with pytest.raises(RecusaDeteccao, match="no máximo 2"):
        validar_deteccao(det(fotos=[foto(f"{i}.png") for i in range(3)]))


@pytest.mark.parametrize(
    "mudanca,trecho",
    [
        ({"confianca": 1.2}, "confianca"),
        ({"confianca": None}, "confianca"),
        ({"incerteza_m": 0}, "incerteza_m"),
        ({"tipo": "arbusto"}, "tipo"),
        ({"contexto": "rua"}, "contexto"),
        ({"interferencias": ["lago"]}, "interferencias"),
        ({"sinais": ["doente"]}, "sinais"),
        ({"localizacao": {"longitude": 200, "latitude": 0}}, "longitude"),
        ({"localizacao": None}, "localizacao"),
        ({"qualidade_imagem": 2}, "qualidade_imagem"),
        ({"id": ""}, "id"),
    ],
)
def test_deteccao_invalida_traz_o_motivo(mudanca, trecho):
    with pytest.raises(RecusaDeteccao, match=trecho):
        validar_deteccao({**det(), **mudanca})


def test_especies_ate_tres_candidatas_com_probabilidade():
    candidatas = [{"nome_cientifico": f"Gen sp{i}", "probabilidade": 0.2} for i in range(3)]
    assert len(validar_deteccao(det(especies=candidatas))["especies"]) == 3
    with pytest.raises(RecusaDeteccao, match="no máximo 3"):
        validar_deteccao(det(especies=[*candidatas, candidatas[0]]))
    with pytest.raises(RecusaDeteccao, match="probabilidade"):
        validar_deteccao(det(especies=[{"nome_cientifico": "X y", "probabilidade": 3}]))


def test_medidas_convertem_unidade_e_rejeitam_absurdo():
    d = validar_deteccao(
        det(
            medidas={
                "altura": {"valor": 850, "unidade": "cm", "incerteza": 100},
                "dap": {"valor": 250, "unidade": "mm"},
                "diametro_copa": {"valor": 6},
            }
        )
    )
    assert d["medidas"]["altura"] == {"valor": 8.5, "unidade": "m", "incerteza": 1.0}
    assert d["medidas"]["dap"]["valor"] == 25.0 and d["medidas"]["dap"]["unidade"] == "cm"
    assert d["medidas"]["diametro_copa"]["valor"] == 6.0
    with pytest.raises(RecusaDeteccao, match="unidade"):
        validar_deteccao(det(medidas={"altura": {"valor": 3, "unidade": "pé"}}))
    with pytest.raises(RecusaDeteccao, match="plausível"):
        validar_deteccao(det(medidas={"altura": {"valor": 500, "unidade": "m"}}))


def test_copa_precisa_ser_poligono_valido():
    quadrado = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [0, 0.0001], [0.0001, 0.0001], [0.0001, 0], [0, 0]]],
    }
    assert validar_deteccao(det(copa=quadrado))["copa"] == quadrado
    with pytest.raises(RecusaDeteccao, match="copa"):
        validar_deteccao(det(copa={"type": "Point", "coordinates": [0, 0]}))


def test_detecoes_repetidas_e_recusas_nao_derrubam_o_lote():
    validas, recusadas = contrato.validar_deteccoes(
        [det("a"), det("a"), det("b", confianca=9), {"sem": "id"}, det("c")]
    )
    assert [d["id"] for d in validas] == ["a", "c"]
    assert [r["id"] for r in recusadas] == ["a", "b", "#4"]
    assert "repetido" in recusadas[0]["motivo"]
    assert recusadas[1]["longitude"] == det()["localizacao"]["longitude"]


def test_limite_de_deteccoes_por_lote(settings):
    settings.DETECCAO_MAX_DETECCOES = 2
    with pytest.raises(ErroContrato, match="limite"):
        contrato.validar_deteccoes([det("a"), det("b"), det("c")])
    with pytest.raises(ErroContrato):
        contrato.validar_deteccoes([])


def test_agrupar_por_rastreamento_e_tipo():
    ds = [
        validar_deteccao(det("a", id_rastreamento="t1")),
        validar_deteccao(det("b")),
        validar_deteccao(det("c", id_rastreamento="t1")),
        validar_deteccao(det("d", id_rastreamento="t1", tipo="toco")),
        validar_deteccao(det("e")),
    ]
    grupos = contrato.agrupar(ds)
    assert [[d["id"] for d in g] for g in grupos] == [["a", "c"], ["b"], ["d"], ["e"]]


def test_registro_plano_do_pacote_vira_deteccao_da_api():
    registro = {
        "id_deteccao": "p1",
        "__lon": -38.5,
        "__lat": -3.7,
        "incerteza_m": 2,
        "confianca": 0.7,
        "especie_sugerida": "Licania tomentosa",
        "especie_probabilidade": 0.6,
        "altura_m": 7.5,
        "dap_cm": 20,
        "interferencias": "fiacao, poste",
        "sinais": '["morta"]',
        "fotos": '[{"arquivo":"fotos/a.jpg","capturada_em":"2026-11-20T10:00:00Z","anonimizada":true}]',
    }
    d = validar_deteccao(contrato.deteccao_de_registro(registro))
    assert d["especies"][0]["nome_cientifico"] == "Licania tomentosa"
    assert d["medidas"]["altura"]["valor"] == 7.5
    assert d["interferencias"] == ["fiacao", "poste"] and d["sinais"] == ["morta"]
    assert d["fotos"][0]["arquivo"] == "fotos/a.jpg"
