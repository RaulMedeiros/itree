"""Recebimento de detecções: token de integração, API, pacote, fotos, segundo plano e auditoria."""

import io
import json
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from itree.conectores import seguranca
from itree.deteccao import servico, tasks
from itree.deteccao.models import LoteDeteccao, SituacaoLote, TokenIntegracao
from itree.evidencias.models import Evidencia
from itree.inventario.models import Arvore

from .conftest import PONTO_A, com_escopo, criar_usuario
from .deteccao_util import LOTE_URL, com_token, corpo, deslocar, det, foto, imagem
from .test_galeria_miniaturas import s3  # noqa: F401 - fixture do armazenamento simulado

pytestmark = pytest.mark.django_db


@pytest.fixture
def integracao(cliente, territorios, admin):
    token, valor = com_token(cliente, [territorios["municipio"]], admin)
    return token


def enviar(cliente, dados, **extra):
    return cliente.post(LOTE_URL, dados, format="json", **extra)


# --- Token ---------------------------------------------------------------------------------


def test_sem_token_a_api_recusa(cliente):
    assert enviar(cliente, corpo()).status_code == 401


def test_token_valido_envia_e_assina_como_integracao(cliente, integracao):
    r = enviar(cliente, corpo())
    assert r.status_code == 201, r.json()
    lote = LoteDeteccao.objects.get()
    assert lote.integracao == integracao and lote.enviado_por == integracao.usuario
    assert lote.canal == "api" and lote.situacao == SituacaoLote.CONCLUIDO
    arvore = Arvore.objects.get()
    assert arvore.criado_por == integracao.usuario
    assert r.json()["arvores_criadas"] == 1 and r.json()["integracao_nome"] == integracao.nome


def test_valor_do_token_nao_fica_guardado(territorios, admin):
    token, valor = servico.criar_token("X", [territorios["municipio"]], admin)
    assert valor.startswith("itk_") and valor not in (token.hash, token.prefixo)
    assert token.prefixo == valor[:12] and len(token.hash) == 64
    assert not any(valor in str(v) for v in TokenIntegracao.objects.values())


def test_token_invalido_malformado_ou_de_outro_esquema(cliente):
    cliente.credentials(HTTP_AUTHORIZATION="Token inventado")
    assert enviar(cliente, corpo()).status_code == 401
    cliente.credentials(HTTP_AUTHORIZATION="Token")
    assert enviar(cliente, corpo()).status_code == 401
    cliente.credentials(HTTP_AUTHORIZATION="Token a b")
    assert enviar(cliente, corpo()).status_code == 401


def test_token_revogado_e_recusado_na_hora(cliente, integracao, admin):
    assert enviar(cliente, corpo()).status_code == 201
    servico.revogar_token(integracao, admin)
    r = enviar(cliente, corpo(id="lote-2"))
    assert r.status_code == 401
    assert LoteDeteccao.objects.count() == 1


def test_token_sem_a_permissao_de_enviar_e_barrado(cliente, integracao):
    integracao.permissoes = []
    integracao.save()
    assert enviar(cliente, corpo()).status_code == 403


def test_escopo_territorial_do_token_recusa_o_que_esta_fora(cliente, territorios, admin):
    com_token(cliente, [territorios["b"]], admin)  # só o Bairro B
    r = enviar(cliente, corpo([det("dentro", deslocar({"longitude": -38.535, "latitude": -3.755})), det("fora")]))
    assert r.status_code == 201, r.json()
    dados = r.json()
    assert (dados["arvores_criadas"], dados["recusadas"]) == (1, 1)
    assert dados["erros"][0]["id"] == "fora" and "escopo" in dados["erros"][0]["motivo"]
    assert Arvore.objects.get().bairro == territorios["b"]


def test_token_nao_autentica_o_resto_da_api(cliente, integracao):
    assert cliente.get("/api/v1/arvores").status_code == 401  # OIDC continua exigindo Bearer


def test_oidc_continua_funcionando_na_mesma_rota(cliente, revisor):
    assert cliente.como(revisor).get(LOTE_URL).status_code == 200


def test_token_le_so_os_proprios_lotes(cliente, integracao, territorios, admin):
    lote_id = enviar(cliente, corpo()).json()["id"]
    assert cliente.get(f"{LOTE_URL}/{lote_id}").status_code == 200
    assert cliente.get(LOTE_URL).status_code == 403  # listar é de quem revisa
    outra, valor = servico.criar_token("Outra", [territorios["municipio"]], admin)
    cliente.credentials(HTTP_AUTHORIZATION=f"Token {valor}")
    assert cliente.get(f"{LOTE_URL}/{lote_id}").status_code == 404


# --- Administração de tokens ----------------------------------------------------------------

TOKENS = "/api/v1/admin/integracoes/tokens"


def test_admin_cria_token_e_ve_o_valor_uma_unica_vez(cliente, admin, territorios):
    cliente.como(admin)
    r = cliente.post(
        TOKENS, {"nome": "Projeto", "territorios_ids": [str(territorios["a"].id)]}, format="json"
    )
    assert r.status_code == 201, r.json()
    valor = r.json()["token"]
    assert valor.startswith("itk_") and r.json()["permissoes"] == ["deteccao.enviar"]
    lista = cliente.get(TOKENS).json()
    assert "token" not in lista[0] and lista[0]["prefixo"] == valor[:12]
    cliente.credentials(HTTP_AUTHORIZATION=f"Token {valor}")
    assert enviar(cliente, corpo()).status_code == 201


def test_token_exige_territorio_e_permissao_de_administrar(cliente, admin, revisor, territorios):
    r = cliente.como(admin).post(TOKENS, {"nome": "X", "territorios_ids": []}, format="json")
    assert r.status_code == 400
    corpo_ok = {"nome": "Y", "territorios_ids": [str(territorios["a"].id)]}
    assert cliente.como(revisor).post(TOKENS, corpo_ok, format="json").status_code == 403
    assert cliente.como(revisor).get(TOKENS).status_code == 403


def test_admin_revoga_pela_api(cliente, admin, integracao):
    cliente.como(admin)
    r = cliente.post(f"{TOKENS}/{integracao.id}/revogar")
    assert r.status_code == 200 and r.json()["ativo"] is False
    integracao.refresh_from_db()
    assert integracao.revogado_por == admin


def test_usuario_de_servico_nao_entra_por_oidc(cliente, integracao):
    u = integracao.usuario
    assert u.is_active is False and u.permissoes == frozenset()
    cliente.credentials(HTTP_AUTHORIZATION="Token x")  # e o e-mail dele não vira login
    from .conftest import emitir_token

    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {emitir_token(sub='fake', email=u.email)}"
    )
    assert cliente.get("/api/v1/eu").status_code == 401


# --- Limites e contrato na API -------------------------------------------------------------


def test_contrato_invalido_e_422_e_nao_grava_nada(cliente, integracao):
    r = enviar(cliente, corpo(sensor="drone"))
    assert r.status_code == 422 and "sensor" in r.json()["erros"][0]
    assert enviar(cliente, {"lote": corpo()["lote"], "deteccoes": []}).status_code == 422
    assert enviar(cliente, [1, 2]).status_code == 422
    assert LoteDeteccao.objects.count() == 0


def test_lote_repetido_e_409(cliente, integracao):
    assert enviar(cliente, corpo()).status_code == 201
    assert enviar(cliente, corpo()).status_code == 409
    assert Arvore.objects.count() == 1


def test_limite_de_deteccoes_por_lote(cliente, integracao, settings):
    settings.DETECCAO_MAX_DETECCOES = 2
    r = enviar(cliente, corpo([det("a"), det("b"), det("c")]))
    assert r.status_code == 422 and "limite" in r.json()["erros"][0]


def test_limite_de_tamanho_do_corpo(cliente, integracao, settings):
    settings.DETECCAO_MAX_CORPO_MB = 1
    r = cliente.post(
        LOTE_URL, corpo(), format="json", CONTENT_LENGTH=str(2 * 1024 * 1024)
    )
    assert r.status_code == 413


def test_deteccao_invalida_e_recusada_e_o_resto_segue(cliente, integracao):
    r = enviar(cliente, corpo([det("ok"), det("ruim", confianca=7)]))
    assert r.status_code == 201
    assert (r.json()["arvores_criadas"], r.json()["recusadas"]) == (1, 1)
    assert "confianca" in r.json()["erros"][0]["motivo"]


# --- Foto sem anonimização -----------------------------------------------------------------


def test_foto_sem_anonimizacao_recusa_a_deteccao_e_nao_guarda_a_foto(cliente, integracao, s3):  # noqa: F811
    sem = {"arquivo": "a.png", "capturada_em": "2026-11-20T10:00:00-03:00"}
    r = cliente.post(
        LOTE_URL,
        {
            "dados": SimpleUploadedFile("dados.json", json.dumps(corpo([det("d1", fotos=[sem]), det("d2", deslocar(PONTO_A, 30))])).encode()),
            "fotos": SimpleUploadedFile("a.png", imagem()),
        },
        format="multipart",
    )
    assert r.status_code == 201, r.json()
    assert (r.json()["arvores_criadas"], r.json()["recusadas"]) == (1, 1)
    assert "anonimizada" in r.json()["erros"][0]["motivo"]
    assert Evidencia.objects.count() == 0
    assert s3.list_objects_v2(Bucket="itree-teste").get("KeyCount", 0) == 0


# --- Fotos: multipart ----------------------------------------------------------------------


def multipart(dados, **arquivos):
    partes = {"dados": SimpleUploadedFile("dados.json", json.dumps(dados).encode())}
    partes.update({k: SimpleUploadedFile(k, v) for k, v in arquivos.items()})
    return partes


def test_foto_em_multipart_vira_evidencia_da_arvore_com_origem_deteccao(cliente, integracao, s3):  # noqa: F811
    dados = corpo([det("d1", fotos=[foto("a.png")])])
    r = cliente.post(
        LOTE_URL,
        {
            "dados": SimpleUploadedFile("dados.json", json.dumps(dados).encode()),
            "fotos": SimpleUploadedFile("a.png", imagem(), content_type="image/png"),
        },
        format="multipart",
    )
    assert r.status_code == 201, r.json()
    evidencia = Evidencia.objects.get()
    assert evidencia.origem == "deteccao" and evidencia.anonimizada is True
    assert evidencia.arvore == Arvore.objects.get() and evidencia.tipo_conteudo == "image/png"
    assert evidencia.chave_miniatura  # a galeria não baixa o original
    assert evidencia.enviada_por == integracao.usuario
    assert evidencia.observacao.id_deteccao == "d1"
    assert s3.head_object(Bucket="itree-teste", Key=evidencia.chave)["ContentLength"] > 0


def test_foto_citada_e_ausente_ou_invalida_recusa_so_a_deteccao(cliente, integracao, s3):  # noqa: F811
    dados = corpo(
        [
            det("falta", fotos=[foto("nao-veio.png")]),
            det("lixo", deslocar(PONTO_A, 30), fotos=[foto("lixo.png")]),
            det("boa", deslocar(PONTO_A, 60), fotos=[foto("boa.png")]),
        ]
    )
    r = cliente.post(
        LOTE_URL,
        {
            "dados": SimpleUploadedFile("dados.json", json.dumps(dados).encode()),
            "f1": SimpleUploadedFile("lixo.png", b"isto nao e imagem"),
            "f2": SimpleUploadedFile("boa.png", imagem()),
        },
        format="multipart",
    )
    assert r.status_code == 201, r.json()
    motivos = {e["id"]: e["motivo"] for e in r.json()["erros"]}
    assert "não veio" in motivos["falta"] and "imagem válida" in motivos["lixo"]
    assert (r.json()["arvores_criadas"], r.json()["recusadas"]) == (1, 2)


def test_foto_grande_demais_e_recusada(cliente, integracao, s3, settings):  # noqa: F811
    settings.DETECCAO_MAX_FOTO_MB = 0  # qualquer foto passa do limite
    dados = corpo([det("d1", fotos=[foto("a.png")])])
    r = cliente.post(LOTE_URL, multipart(dados, **{"a.png": imagem()}), format="multipart")
    assert r.json()["recusadas"] == 1 and "limite" in r.json()["erros"][0]["motivo"]


def test_foto_sem_armazenamento_configurado_e_503(cliente, integracao, settings):
    settings.S3_BUCKET = ""
    dados = corpo([det("d1", fotos=[foto("a.png")])])
    r = cliente.post(LOTE_URL, multipart(dados, **{"a.png": imagem()}), format="multipart")
    assert r.status_code == 503 and LoteDeteccao.objects.count() == 0


# --- Fotos por URL: mesma proteção de rede dos conectores ------------------------------------


def foto_url(url="https://fotos.itree.teste/a.png"):
    return {"url": url, "capturada_em": "2026-11-20T10:00:00-03:00", "anonimizada": True}


def test_foto_por_url_e_baixada_com_a_protecao_dos_conectores(
    cliente, integracao, s3, settings, monkeypatch  # noqa: F811
):
    settings.ITREE_DETECCAO_HOSTS_FOTOS = ["fotos.itree.teste"]
    chamadas = []

    def falso_buscar(url, params=None, limite_bytes=None, hosts=None):
        chamadas.append((url, hosts, limite_bytes))
        return imagem()

    monkeypatch.setattr(seguranca, "buscar", falso_buscar)
    r = enviar(cliente, corpo([det("d1", fotos=[foto_url()])]))
    assert r.status_code == 201, r.json()
    assert chamadas == [("https://fotos.itree.teste/a.png", {"fotos.itree.teste"}, 10 * 1024 * 1024)]
    assert Evidencia.objects.get().origem == "deteccao"


@pytest.mark.parametrize(
    "url",
    [
        "http://fotos.itree.teste/a.png",  # sem TLS
        "https://outro.host/a.png",  # fora da lista
        "https://usuario:senha@fotos.itree.teste/a.png",  # credenciais
        "https://fotos.itree.teste:8443/a.png",  # porta
    ],
)
def test_foto_por_url_perigosa_nao_e_baixada_e_a_deteccao_segue(
    cliente, integracao, s3, settings, monkeypatch, url  # noqa: F811
):
    settings.ITREE_DETECCAO_HOSTS_FOTOS = ["fotos.itree.teste"]
    monkeypatch.setattr(seguranca, "_resolver", lambda host: ["93.184.216.34"])

    def nao_deve_buscar(*a, **k):
        raise AssertionError("a rede não podia ser tocada")

    monkeypatch.setattr(seguranca.requests, "get", nao_deve_buscar)
    r = enviar(cliente, corpo([det("d1", fotos=[foto_url(url)])]))
    assert r.status_code == 201, r.json()
    assert r.json()["arvores_criadas"] == 1 and Evidencia.objects.count() == 0
    assert "Foto não guardada" in r.json()["erros"][0]["motivo"]


def test_foto_por_url_em_ip_privado_e_recusada(cliente, integracao, s3, settings, monkeypatch):  # noqa: F811
    settings.ITREE_DETECCAO_HOSTS_FOTOS = ["fotos.itree.teste"]
    monkeypatch.setattr(seguranca, "_resolver", lambda host: ["10.0.0.5"])
    monkeypatch.setattr(seguranca, "_por_proxy", lambda url: False)
    r = enviar(cliente, corpo([det("d1", fotos=[foto_url()])]))
    assert r.json()["arvores_criadas"] == 1 and Evidencia.objects.count() == 0
    assert "não público" in r.json()["erros"][0]["motivo"]


def test_lista_de_hosts_de_fotos_vazia_nao_baixa_nada(cliente, integracao, s3):  # noqa: F811
    r = enviar(cliente, corpo([det("d1", fotos=[foto_url()])]))
    assert r.json()["arvores_criadas"] == 1 and Evidencia.objects.count() == 0


# --- Segundo plano -------------------------------------------------------------------------


@pytest.fixture
def fila(monkeypatch):
    enfileirados = []
    monkeypatch.setattr(tasks.processar_lote, "delay", lambda i: enfileirados.append(i))
    return enfileirados


def lote_grande(n=5):
    return corpo([det(f"d{i}", deslocar(PONTO_A, 10 * i)) for i in range(n)])


def test_lote_grande_vai_para_segundo_plano(cliente, integracao, fila, settings):
    settings.DETECCAO_LIMITE_SINCRONO = 3
    r = enviar(cliente, lote_grande())
    assert r.status_code == 202, r.json()
    assert r.json()["situacao"] == "em_processamento" and Arvore.objects.count() == 0
    assert fila == [r.json()["id"]]

    tasks.processar_lote(fila[0])
    final = cliente.get(f"{LOTE_URL}/{fila[0]}").json()
    assert final["situacao"] == "concluido" and final["arvores_criadas"] == 5
    assert Arvore.objects.count() == 5


def test_lote_no_limite_continua_imediato(cliente, integracao, fila, settings):
    settings.DETECCAO_LIMITE_SINCRONO = 5
    assert enviar(cliente, lote_grande()).status_code == 201 and fila == []


def test_processamento_retoma_do_ponto_gravado(cliente, integracao, fila, settings, monkeypatch):
    settings.DETECCAO_LIMITE_SINCRONO = 1
    monkeypatch.setattr(servico, "TAMANHO_BLOCO", 2)
    lote_id = enviar(cliente, lote_grande()).json()["id"]
    original = servico._processar_grupo
    vistos = []

    def espiar(lote, grupo, *a):
        vistos.append(LoteDeteccao.objects.get(pk=lote_id).processadas)
        if grupo[0]["id"] == "d3":
            raise KeyboardInterrupt  # simula a morte do worker no meio do segundo bloco
        return original(lote, grupo, *a)

    monkeypatch.setattr(servico, "_processar_grupo", espiar)
    with pytest.raises(KeyboardInterrupt):
        tasks.processar_lote(lote_id)
    assert LoteDeteccao.objects.get(pk=lote_id).processadas == 2
    assert Arvore.objects.count() == 2

    monkeypatch.setattr(servico, "_processar_grupo", original)
    tasks.processar_lote(lote_id)  # reentrega: continua do bloco gravado, sem duplicar
    final = LoteDeteccao.objects.get(pk=lote_id)
    assert final.situacao == "concluido" and Arvore.objects.count() == 5
    assert final.arvores_criadas == 5 and final.processadas == 5


def test_lote_concluido_nao_e_tratado_de_novo(cliente, integracao, fila):
    lote_id = enviar(cliente, corpo()).json()["id"]
    tasks.processar_lote(lote_id)
    assert Arvore.objects.count() == 1


def test_falha_numa_deteccao_nao_derruba_o_lote(cliente, integracao, fila, settings, monkeypatch):
    settings.DETECCAO_LIMITE_SINCRONO = 1
    lote_id = enviar(cliente, lote_grande(3)).json()["id"]
    from itree.deteccao import juncao

    original = juncao.tratar_arvore

    def quebrar_a_segunda(agregado, *a, **k):
        if agregado.deteccoes[0]["id"] == "d1":
            raise RuntimeError("falha simulada")
        return original(agregado, *a, **k)

    monkeypatch.setattr(juncao, "tratar_arvore", quebrar_a_segunda)
    tasks.processar_lote(lote_id)
    lote = LoteDeteccao.objects.get(pk=lote_id)
    assert lote.situacao == "concluido" and (lote.arvores_criadas, lote.recusadas) == (2, 1)
    assert lote.erros[0]["id"] == "d1" and Arvore.objects.count() == 2


def test_fila_indisponivel_marca_o_lote_como_falho(cliente, integracao, settings, monkeypatch):
    settings.DETECCAO_LIMITE_SINCRONO = 1

    def sem_broker(_):
        raise ConnectionError("redis fora do ar")

    monkeypatch.setattr(tasks.processar_lote, "delay", sem_broker)
    r = enviar(cliente, lote_grande(3))
    assert r.status_code == 201 and r.json()["situacao"] == "falhou"
    assert "fila" in r.json()["erro"]


# --- Pacote --------------------------------------------------------------------------------


def zip_pacote(dados=None, geojson=True, fotos=None, lote_json=True, extra=None) -> bytes:
    dados = dados or corpo()
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [d["localizacao"]["longitude"], d["localizacao"]["latitude"]]},
            "properties": {
                "id_deteccao": d["id"],
                **{k: v for k, v in d.items() if k not in ("id", "localizacao")},
            },
        }
        for d in dados["deteccoes"]
    ]
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        if lote_json:
            z.writestr("lote.json", json.dumps(dados["lote"]))
        if geojson:
            z.writestr("deteccoes.geojson", json.dumps({"type": "FeatureCollection", "features": features}))
        for nome, conteudo in (fotos or {}).items():
            z.writestr(nome, conteudo)
        for nome, conteudo in (extra or {}).items():
            z.writestr(nome, conteudo)
    return saida.getvalue()


def enviar_pacote(cliente, conteudo, nome="pacote.zip"):
    return cliente.post(
        f"{LOTE_URL}/pacote", {"arquivo": SimpleUploadedFile(nome, conteudo)}, format="multipart"
    )


def test_pacote_pela_tela_cria_o_mesmo_que_a_api(cliente, revisor, s3):  # noqa: F811
    dados = corpo([det("p1", fotos=[foto("fotos/p1.png")]), det("p2", deslocar(PONTO_A, 40), tipo="toco")])
    r = enviar_pacote(cliente.como(revisor), zip_pacote(dados, fotos={"fotos/p1.png": imagem()}))
    assert r.status_code == 201, r.json()
    assert r.json()["canal"] == "pacote" and r.json()["arquivo_nome"] == "pacote.zip"
    assert (r.json()["arvores_criadas"], r.json()["pontos_criados"]) == (1, 1)
    assert Arvore.objects.get().criado_por == revisor
    assert Evidencia.objects.get().origem == "deteccao"


def test_pacote_exige_a_permissao_de_enviar(cliente, gestor_municipal, tecnico_a):
    assert enviar_pacote(cliente.como(gestor_municipal), zip_pacote()).status_code == 403
    assert enviar_pacote(cliente.como(tecnico_a), zip_pacote()).status_code == 403


def test_pacote_respeita_o_escopo_de_quem_envia(cliente, revisor, territorios):
    revisor.escopos.all().delete()
    com_escopo(revisor, territorios["b"])
    r = enviar_pacote(cliente.como(revisor), zip_pacote())  # ponto no Bairro A
    assert r.json()["recusadas"] == 1 and Arvore.objects.count() == 0


@pytest.mark.parametrize(
    "kwargs,trecho",
    [
        ({"lote_json": False}, "lote.json"),
        ({"geojson": False}, "deteccoes"),
        ({"extra": {"deteccoes.gpkg": b"x"}}, "só um"),
    ],
)
def test_pacote_incompleto_e_422(cliente, revisor, kwargs, trecho):
    r = enviar_pacote(cliente.como(revisor), zip_pacote(**kwargs))
    assert r.status_code == 422 and trecho in r.json()["erros"][0]


def test_pacote_que_nao_e_zip_e_422(cliente, revisor):
    r = enviar_pacote(cliente.como(revisor), b"nao sou zip")
    assert r.status_code == 422
    assert enviar_pacote(cliente, b"x", nome="dados.csv").status_code == 400


def test_pacote_com_membros_demais_e_recusado(cliente, revisor, settings):
    settings.DETECCAO_PACOTE_MAX_MEMBROS = 3
    r = enviar_pacote(cliente.como(revisor), zip_pacote(extra={"a.png": b"1", "b.png": b"2"}))
    assert r.status_code == 422 and "limite" in r.json()["erros"][0]


def test_pacote_ignora_caminhos_perigosos_e_nao_escreve_no_disco(cliente, revisor, s3, tmp_path):  # noqa: F811
    dados = corpo([det("p1", fotos=[foto("../../etc/passwd.png")])])
    pacote_zip = zip_pacote(dados, extra={"../../etc/passwd.png": imagem(), "/abs.png": b"x"})
    r = enviar_pacote(cliente.como(revisor), pacote_zip)
    assert r.status_code == 201, r.json()
    # a foto é achada pelo nome, em memória; nada é gravado fora do bucket
    assert Evidencia.objects.get().arvore is not None


def test_pacote_geopackage(cliente, revisor, tmp_path):
    """GeoPackage não tem listas: campos de lista e objetos vão como texto JSON ou separado por vírgula."""
    from .test_importacao_formatos import ogr2ogr

    feicoes = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [PONTO_A["longitude"], PONTO_A["latitude"]]},
                "properties": {
                    "id_deteccao": "g1",
                    "tipo": "arvore",
                    "incerteza_m": 2.0,
                    "confianca": 0.7,
                    "especie_sugerida": "Licania tomentosa",
                    "especie_probabilidade": 0.6,
                    "altura_m": 7.5,
                    "interferencias": "fiacao,poste",
                },
            }
        ],
    }
    caminho = ogr2ogr(tmp_path, feicoes, "GPKG", "deteccoes.gpkg")
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        z.writestr("lote.json", json.dumps(corpo()["lote"]))
        z.writestr("deteccoes.gpkg", caminho.read_bytes())
    r = enviar_pacote(cliente.como(revisor), saida.getvalue())
    assert r.status_code == 201, r.json()
    assert r.json()["arvores_criadas"] == 1
    from itree.deteccao.models import Observacao

    assert Observacao.objects.get().valores["interferencias"] == ["fiacao", "poste"]
    assert Arvore.objects.get().medidas.get().valor == 7.5
