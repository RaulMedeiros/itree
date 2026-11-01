"""Dados SINTÉTICOS para as capturas de tela de docs/telas.

Executado por gerar.sh dentro do contêiner da API (manage shell). Nada aqui
representa pessoas, árvores ou locais reais.
"""
import random
from datetime import timedelta
from decimal import Decimal

import pghistory
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas import fontes
from itree.contas.models import EscopoUsuario, Equipe, MembroEquipe, Usuario
from itree.inspecoes.serializers import InspecaoDeCampoSerializer
from itree.inspecoes.servicos import sincronizar_item
from itree.inventario import importacao
from itree.inventario.models import Arvore, Especie, LoteImportacao
from itree.ocorrencias.models import Ocorrencia, TipoOcorrencia
from itree.qualidade.models import InferenciaIA
from itree.tarefas.models import Tarefa
from itree.territorio.models import Territorio

DADOS = "/tmp/telas-dados"
random.seed(7)
agora = timezone.now()
hoje = timezone.localdate()
municipio = Territorio.objects.get(tipo="municipio")
gestor = Usuario.objects.get(email="gestor@itree.local")
gestor.papeis = sorted(set(gestor.papeis) | {"analista_ambiental", "coordenador"})
gestor.save()


def usuario(email, nome, papeis):
    u, _ = Usuario.objects.get_or_create(
        email=email, defaults={"username": email, "nome": nome, "papeis": papeis}
    )
    EscopoUsuario.objects.get_or_create(usuario=u, territorio=municipio)
    return u


tecnicos = [
    usuario("tiago.tecnico@itree.local", "Tiago Técnico", ["tecnico"]),
    usuario("clara.campos@itree.local", "Clara Campos", ["tecnico"]),
    usuario("bruno.brito@itree.local", "Bruno Brito", ["tecnico"]),
]
revisora = usuario("rita.revisora@itree.local", "Rita Revisora", ["revisor"])
usuario("ana.ambiental@itree.local", "Ana Lúcia Ambiental", ["analista_ambiental"])
usuario("caio.coord@itree.local", "Caio Coordenador", ["coordenador"])

equipe, _ = Equipe.objects.get_or_create(
    nome="Equipe de Arborização Leste", defaults={"coordenador": gestor}
)
for t in tecnicos[:2]:
    MembroEquipe.objects.get_or_create(equipe=equipe, usuario=t)
Equipe.objects.get_or_create(nome="Equipe de Poda Oeste", defaults={"coordenador": gestor})

ESPECIES = [
    ("Licania tomentosa", ["Oiti"]),
    ("Handroanthus impetiginosus", ["Ipê-roxo"]),
    ("Azadirachta indica", ["Nim"]),
    ("Terminalia catappa", ["Castanhola"]),
    ("Mangifera indica", ["Mangueira"]),
    ("Cassia fistula", ["Chuva-de-ouro"]),
    ("Caesalpinia ferrea", ["Pau-ferro", "Jucá"]),
    ("Anacardium occidentale", ["Cajueiro"]),
]
especies = []
for nome, comuns in ESPECIES:
    e, _ = Especie.objects.get_or_create(nome_cientifico=nome)
    if not e.nomes_comuns:
        e.nomes_comuns = comuns
        e.save()
    especies.append(e)

# --- Inventário importado (lote) -------------------------------------------
RUAS = ["Rua das Mangueiras", "Av. Beira-Mar", "Rua do Ipê", "Rua Sintética", "Av. Central",
        "Travessa do Oiti", "Rua das Flores", "Praça da Árvore"]
registros = []
for i in range(1, 241):
    lon = -38.5495 + random.random() * 0.029
    lat = -3.7495 + random.random() * 0.0095
    nome = random.choices(
        [e.nome_cientifico for e in especies] + ["Especie nao listada", ""],
        weights=[22, 10, 14, 9, 8, 6, 5, 4, 3, 6],
    )[0]
    registros.append({
        "cod": f"INV-{i:04d}", "lat": f"{lat:.6f}", "lon": f"{lon:.6f}", "esp": nome,
        "alt": f"{random.uniform(3, 16):.1f}", "dap": f"{random.uniform(10, 70):.0f}",
        "end": f"{random.choice(RUAS)}, {random.randint(10, 990)}",
    })
mapeamento = {"latitude": "lat", "longitude": "lon", "id_externo": "cod", "especie": "esp",
              "altura": "alt", "dap": "dap", "endereco": "end"}
linhas = importacao.interpretar(registros, mapeamento, 4326, fonte_ids="Inventário sintético 2024")
lote = LoteImportacao.objects.create(
    arquivo_nome="inventario-sintetico-2024.csv", formato="csv", fonte="Inventário sintético 2024",
    data_referencia=hoje - timedelta(days=400),
    mapeamento={**mapeamento, "srid": 4326, "fonte_ids": "Inventário sintético 2024"},
    usuario=gestor, total_linhas=len(linhas),
    linhas_validas=sum(1 for linha in linhas if not linha.erros),
    linhas=[linha.como_dict() for linha in linhas],
)
with pghistory.context(evento="importacao_inventario", lote=lote.numero):
    importacao.confirmar(lote, gestor)

arvores = list(Arvore.objects.filter(lote=lote).order_by("numero"))
for a in random.sample(arvores, 90):
    if a.especie_id:
        a.especie_estado = "confirmada"
        a.save(update_fields=["especie_estado"])
for a in random.sample(arvores, 120):
    a.condicao_aparente = random.choice(["boa", "boa", "regular", "regular", "ruim", "critica"])
    a.condicao_aparente_em = agora - timedelta(days=random.randint(5, 500))
    a.save(update_fields=["condicao_aparente", "condicao_aparente_em"])

# --- Possíveis duplicidades: pontos estimados no web a ~1 m de árvores importadas
for a in random.sample(arvores, 3):
    Arvore.objects.create(
        geom=Point(a.geom.x + 0.00001, a.geom.y, srid=4326), localizacao_origem="estimada_web",
        especie=a.especie, especie_estado="informada" if a.especie_id else "nao_identificada",
        endereco=a.endereco, origem_registro="web", criado_por=gestor,
    )

# --- Evidências com foto ilustrativa (gerada aqui; não é foto real) ---------------
import io

from PIL import Image, ImageDraw, ImageFilter

from itree.core import armazenamento
from itree.core.ids import uuid7
from itree.evidencias.models import Evidencia


def ilustracao(semente):
    rnd = random.Random(semente)
    largura, altura = 1200, 900
    img = Image.new("RGB", (largura, altura))
    d = ImageDraw.Draw(img)
    for y in range(altura):
        t = y / altura
        d.line([(0, y), (largura, y)], fill=(int(150 + 60 * t), int(195 + 30 * t), int(235 + 10 * t)))
    d.rectangle([0, 640, largura, altura], fill=(168, 164, 158))
    d.rectangle([0, 600, largura, 640], fill=(120, 116, 110))
    d.polygon([(560, 640), (640, 640), (625, 330), (575, 330)], fill=(105, 78, 52))
    for _ in range(260):
        cx, cy, r = rnd.gauss(600, 170), rnd.gauss(240, 90), rnd.randint(30, 70)
        g = rnd.randint(95, 150)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(rnd.randint(30, 60), g, rnd.randint(40, 70)))
    buf = io.BytesIO()
    img.filter(ImageFilter.GaussianBlur(1.2)).save(buf, "PNG")
    return buf.getvalue()


arvores_com_foto = [a for a in arvores if a.especie_estado == "confirmada"][:3]
for i, a in enumerate(arvores_com_foto):
    conteudo = ilustracao(i)
    ident = uuid7()
    chave = f"evidencias/{agora:%Y/%m}/{ident}.png"
    armazenamento.cliente_interno().put_object(
        Bucket=armazenamento.settings.S3_BUCKET, Key=chave, Body=conteudo, ContentType="image/png"
    )
    Evidencia.objects.create(
        id=ident, chave=chave, nome_original=f"arvore-{a.codigo}.png", tipo_conteudo="image/png",
        tamanho=len(conteudo), descricao="Copa e tronco vistos da calçada (ilustração sintética)",
        capturada_em=agora - timedelta(days=3), estado="disponivel", enviada_por=tecnicos[0], arvore=a,
    )

# --- Ocorrências ---------------------------------------------------------------
tipos = {}
for nome, prazo in [("Galho caído", 3), ("Risco de queda", 1), ("Poda solicitada", 30),
                    ("Raiz danificando calçada", 20), ("Verificação de foco de calor", 5)]:
    tipos[nome], _ = TipoOcorrencia.objects.get_or_create(nome=nome, defaults={"prazo_padrao_dias": prazo})
DESCRICOES = {
    "Galho caído": "Galho de grande porte caído sobre a calçada, bloqueando parcialmente a passagem.",
    "Risco de queda": "Inclinação acentuada do tronco após chuva forte; solo rachado na base.",
    "Poda solicitada": "Copa encostando na fiação de baixa tensão.",
    "Raiz danificando calçada": "Raízes superficiais levantando o calçamento em cerca de 10 cm.",
}
estados = ["aberta"] * 5 + ["em_triagem"] * 3 + ["encaminhada"] * 3 + ["em_atendimento"] * 3 + ["concluida"] * 3 + ["cancelada"]
for i, estado in enumerate(estados):
    a = random.choice(arvores)
    tipo = random.choice(list(DESCRICOES))
    prioridade = random.choice(["", "baixa", "media", "alta", "urgente"]) if estado != "aberta" else ""
    o = Ocorrencia(
        tipo=tipos[tipo], arvore=a, geom=a.geom, endereco=a.endereco, descricao=DESCRICOES[tipo],
        prioridade=prioridade, estado=estado, origem="web", registrada_por=gestor,
        prazo=hoje + timedelta(days=random.randint(-6, 20)) if estado not in ("concluida", "cancelada") else None,
        equipe=equipe if estado in ("encaminhada", "em_atendimento") else None,
        risco_confirmado=(tipo == "Risco de queda" and estado != "aberta"),
        risco_descricao="Confirmado em vistoria visual." if tipo == "Risco de queda" and estado != "aberta" else "",
    )
    # Registradas ao longo das últimas semanas; conclusão sempre depois do registro.
    registrada = agora - timedelta(days=random.randint(8, 40), hours=random.randint(0, 10))
    if estado == "concluida":
        o.concluida_em = registrada + timedelta(days=random.randint(1, 6), hours=random.randint(1, 20))
    if prioridade:
        o.prioridade_definida_por = gestor
        o.prioridade_definida_em = registrada + timedelta(hours=random.randint(2, 30))
    o.save()
    Ocorrencia.objects.filter(pk=o.pk).update(criado_em=registrada)

# --- Tarefas de inspeção --------------------------------------------------------
for i, a in enumerate(random.sample(arvores, 16)):
    estado = ["nao_iniciada", "nao_iniciada", "em_execucao", "concluida", "bloqueada"][i % 5]
    Tarefa.objects.create(
        tipo="inspecao_arvore", arvore=a, geom=a.geom, responsavel=tecnicos[i % 3],
        equipe=equipe if i % 3 < 2 else None, prazo=hoje + timedelta(days=random.randint(-5, 25)),
        estado=estado, criada_por=gestor,
        motivo_estado="Acesso bloqueado por obra no local." if estado == "bloqueada" else "",
        concluida_em=agora - timedelta(days=2) if estado == "concluida" else None,
    )

# --- Inspeções enviadas pelo aplicativo (via serviço de sincronização) ----------
import uuid
SINAIS = ["galhos_secos", "ferida", "fungos", "cavidade", "inclinacao", "conflito_rede"]
for i, a in enumerate(random.sample(arvores, 8)):
    tecnico = tecnicos[i % 3]
    dados = {
        "id": str(uuid.uuid4()), "arvore": str(a.id),
        "realizada_em": (agora - timedelta(days=i, hours=3)).isoformat(),
        "localizacao": {"longitude": a.geom.x + 0.00002, "latitude": a.geom.y - 0.00001},
        "precisao_m": round(random.uniform(2.5, 6), 1),
        "especie": str(random.choice(especies).id),
        "condicao_aparente": random.choice(["boa", "regular", "ruim"]),
        "sinais": random.sample(SINAIS, random.randint(0, 3)),
        "observacoes": random.choice(["", "Copa assimétrica.", "Base com cavidade pequena.",
                                      "Recomendo nova vistoria após o período chuvoso."]),
        "requer_encaminhamento": i % 4 == 0,
        "medidas": [
            {"tipo": "altura", "valor": f"{random.uniform(4, 15):.1f}", "metodo": "hipsometro", "origem": "medido"},
            {"tipo": "dap", "valor": f"{random.uniform(12, 65):.0f}", "metodo": "fita_diametrica", "origem": "medido"},
        ],
        "enviar_para_revisao": i < 6,
    }
    s = InspecaoDeCampoSerializer(data=dados)
    s.is_valid(raise_exception=True)
    with pghistory.context(usuario=str(tecnico.id), origem="app"):
        print("inspeção", sincronizar_item(s.validated_data, tecnico, "android-sintetico").status)

# --- Alertas ambientais -----------------------------------------------------------
for fonte, arquivo in [("inpe_focos", f"{DADOS}/focos-sinteticos.csv"), ("inpe_deter", f"{DADOS}/deter-sintetico.geojson")]:
    print("ingestão", fonte, fontes.ingerir(fonte, open(arquivo, "rb").read(), origem="arquivo sintético", usuario=gestor).novos)

# --- Sugestões de IA aguardando decisão ------------------------------------------
for a in random.sample([a for a in arvores if a.especie_estado != "confirmada"], 4):
    sugeridas = random.sample(especies, 2)
    InferenciaIA.objects.create(
        tarefa="especie", arvore=a, modelo="classificador-especies-demo", versao_modelo="0.3.1",
        resultado={"rotulos": [e.nome_cientifico for e in sugeridas]},
        alternativas=[{"especie_id": str(e.id), "nome": e.nome_cientifico} for e in sugeridas],
        registrada_por=gestor,
    )
print("árvores", Arvore.objects.count(), "ocorrências", Ocorrencia.objects.count(), "tarefas", Tarefa.objects.count())
