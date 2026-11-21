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
from django.db import transaction

from itree.inspecoes.models import Inspecao
from itree.inspecoes.servicos import sincronizar_item, validar
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

# Espécies reais comuns na arborização de Fortaleza: família e origem conforme
# a literatura botânica (catálogo municipal; as referências externas vêm à parte).
ESPECIES = [
    ("Licania tomentosa", ["Oiti"], "Chrysobalanaceae", True),
    ("Handroanthus impetiginosus", ["Ipê-roxo"], "Bignoniaceae", True),
    ("Azadirachta indica", ["Nim"], "Meliaceae", False),
    ("Terminalia catappa", ["Castanhola"], "Combretaceae", False),
    ("Mangifera indica", ["Mangueira"], "Anacardiaceae", False),
    ("Cassia fistula", ["Chuva-de-ouro"], "Fabaceae", False),
    ("Libidibia ferrea", ["Pau-ferro", "Jucá"], "Fabaceae", True),
    ("Anacardium occidentale", ["Cajueiro"], "Anacardiaceae", True),
]
especies = []
for nome, comuns, familia, nativa in ESPECIES:
    e, _ = Especie.objects.get_or_create(nome_cientifico=nome)
    e.nomes_comuns = e.nomes_comuns or comuns
    e.familia = e.familia or familia
    e.nativa_brasil = nativa if e.nativa_brasil is None else e.nativa_brasil
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
    importacao.preparar_confirmacao(lote, gestor)
    importacao.executar_confirmacao(lote.pk)

arvores = list(Arvore.objects.filter(lote=lote).order_by("numero"))
for a in random.sample(arvores, 90):
    if a.especie_id:
        a.especie_estado = "confirmada"
        a.save(update_fields=["especie_estado"])
com_condicao = random.sample(arvores, 120)
for a in com_condicao:
    a.condicao_aparente = random.choice(["boa", "boa", "boa", "regular", "regular", "ruim", "morta"])
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


def ilustracao(semente, copa=1.0):
    """Ilustração sintética de uma árvore na calçada; `copa` escala o tamanho da copa."""
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
        cx, cy = rnd.gauss(600, 170 * copa), rnd.gauss(300 - 60 * copa, 90 * copa)
        r = rnd.randint(30, 70) * copa
        g = rnd.randint(95, 150)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(rnd.randint(30, 60), g, rnd.randint(40, 70)))
    buf = io.BytesIO()
    img.filter(ImageFilter.GaussianBlur(1.2)).save(buf, "PNG")
    return buf.getvalue()


from itree.evidencias.miniaturas import gerar_miniatura


def gravar_foto(semente, quando, descricao, autor, copa=1.0, **vinculo):
    """Foto SINTÉTICA (gerada aqui, declarada na legenda) com a miniatura da galeria."""
    conteudo = ilustracao(semente, copa)
    ident = uuid7()
    chave = f"evidencias/{agora:%Y/%m}/{ident}.png"
    armazenamento.cliente_interno().put_object(
        Bucket=armazenamento.settings.S3_BUCKET, Key=chave, Body=conteudo, ContentType="image/png"
    )
    ev = Evidencia.objects.create(
        id=ident, chave=chave, nome_original=f"ilustracao-{semente}.png", tipo_conteudo="image/png",
        tamanho=len(conteudo), descricao=f"{descricao} (ilustração sintética)",
        capturada_em=quando, estado="disponivel", enviada_por=autor,
        ilustrativa=True,  # imagem gerada aqui: a interface mostra o selo "Ilustração"
        **vinculo,
    )
    gerar_miniatura(ev)
    return ev


arvores_com_foto = [a for a in arvores if a.especie_estado == "confirmada"][:3]
for i, a in enumerate(arvores_com_foto):
    gravar_foto(i, agora - timedelta(days=3), "Copa e tronco vistos da calçada", tecnicos[0], arvore=a)

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
# Abertas recentes e um histórico de concluídas ao longo do ano (série mensal).
estados = (
    ["aberta"] * 5 + ["em_triagem"] * 3 + ["encaminhada"] * 3 + ["em_atendimento"] * 3
    + ["concluida"] * 22 + ["cancelada"] * 2
)
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
    if estado not in ("concluida", "cancelada"):
        dias = random.randint(8, 40)
    else:  # algumas concluídas no período atual (tempo médio de atendimento)
        dias = random.randint(10, 22) if i % 5 == 0 else random.randint(10, 340)
    registrada = agora - timedelta(days=dias, hours=random.randint(0, 10))
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
# Inspeções do último ano: as mais recentes aguardam revisão; as demais ficam
# validadas no histórico (série mensal da visão geral).
for i, a in enumerate(random.sample(arvores, 30)):
    tecnico = tecnicos[i % 3]
    dados = {
        "id": str(uuid.uuid4()), "arvore": str(a.id),
        "realizada_em": (
            agora - timedelta(days=i if i < 8 else random.randint(15, 340), hours=3)
        ).isoformat(),
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
        "enviar_para_revisao": i < 6 or i >= 8,
    }
    s = InspecaoDeCampoSerializer(data=dados)
    s.is_valid(raise_exception=True)
    with pghistory.context(usuario=str(tecnico.id), origem="app"):
        resultado = sincronizar_item(s.validated_data, tecnico, "android-sintetico")
    if i >= 8:  # histórico: validada pela revisora, aplicando condição e medidas
        with transaction.atomic(), pghistory.context(usuario=str(revisora.id), origem="web"):
            validar(Inspecao.objects.get(pk=resultado.id), revisora, ["condicao_aparente", "medidas"])

# --- Histórico visual SINTÉTICO de uma árvore (galeria, linha do tempo e comparação) ---------
# A primeira árvore com foto ganha 3 inspeções validadas (condição boa → regular → ruim, com
# altura e DAP), uma ocorrência de poda atendida e fotos ilustrativas ao longo de quase um ano.
# Tudo inventado para as capturas: as fotos são geradas com o Pillow e a legenda diz isso.
a0 = arvores_com_foto[0]
revisao = [(330, "boa", "6.5", "22", 0.7, "Copa jovem, ainda rala"),
           (170, "regular", "7.8", "27", 0.85, "Copa mais cheia, galhos baixos"),
           (60, "ruim", "8.4", "31", 1.15, "Galho encostando na fiação")]
fotos_inspecao = []
for k, (dias, condicao, altura, dap, copa, legenda) in enumerate(revisao):
    quando = agora - timedelta(days=dias)
    dados = {
        "id": str(uuid.uuid4()), "arvore": str(a0.id), "realizada_em": quando.isoformat(),
        "localizacao": {"longitude": a0.geom.x + 0.00002, "latitude": a0.geom.y - 0.00001},
        "precisao_m": 3.5, "especie": str(a0.especie_id), "condicao_aparente": condicao,
        "sinais": ["conflito_rede"] if condicao == "ruim" else [], "observacoes": legenda,
        "requer_encaminhamento": condicao == "ruim",
        "medidas": [
            {"tipo": "altura", "valor": altura, "metodo": "hipsometro", "origem": "medido"},
            {"tipo": "dap", "valor": dap, "metodo": "fita_diametrica", "origem": "medido"},
        ],
        "enviar_para_revisao": True,
    }
    s = InspecaoDeCampoSerializer(data=dados)
    s.is_valid(raise_exception=True)
    with pghistory.context(usuario=str(tecnicos[0].id), origem="app"):
        resultado = sincronizar_item(s.validated_data, tecnicos[0], "android-sintetico")
    with transaction.atomic(), pghistory.context(usuario=str(revisora.id), origem="web"):
        validar(Inspecao.objects.get(pk=resultado.id), revisora, ["condicao_aparente", "medidas"])
    gravar_foto(100 + k, quando, legenda, tecnicos[0], copa, inspecao_id=resultado.id)

poda = tipos["Poda solicitada"]
oco_poda = Ocorrencia.objects.create(
    tipo=poda, arvore=a0, geom=a0.geom, endereco=a0.endereco, estado="concluida", origem="web",
    descricao="Copa encostando na fiação de baixa tensão.", registrada_por=gestor,
    prioridade="alta", concluida_em=agora - timedelta(days=45),
)
Ocorrencia.objects.filter(pk=oco_poda.pk).update(criado_em=agora - timedelta(days=65))
gravar_foto(110, agora - timedelta(days=65), "Copa sobre a fiação, antes da poda", gestor, 1.15,
            ocorrencia=oco_poda)
Tarefa.objects.create(
    tipo="atendimento_ocorrencia", arvore=a0, ocorrencia=oco_poda, geom=a0.geom,
    responsavel=tecnicos[0], estado="concluida", criada_por=gestor, concluida_em=agora - timedelta(days=45),
    resultado="Poda de levantamento e de afastamento da fiação realizada.",
)
gravar_foto(111, agora - timedelta(days=40), "Copa depois da poda de afastamento", tecnicos[0], 0.8,
            arvore=a0)
gravar_foto(112, agora - timedelta(days=200), "Árvore em 2026, antes da primeira inspeção do ano",
            tecnicos[1], 0.8, arvore=a0)

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
# --- Histórico SINTÉTICO dos indicadores instantâneos (M-11) -------------------
# Valores inventados só para as capturas de tela: 12 registros mensais (último dia
# de cada mês) que evoluem de ~60% até o valor de hoje, com pequena oscilação.
# Em produção, quem grava isso é a tarefa diária `registrar_indicadores`.
from itree.indicadores import instantaneos
from itree.indicadores.models import RegistroIndicador

rnd_hist = random.Random(11)
for territorio in Territorio.objects.all():
    atuais = instantaneos.calcular_territorio(territorio, hoje=hoje, agora=agora)
    dia = hoje.replace(day=1)
    for passo in range(1, 13):
        dia = dia - timedelta(days=1)  # último dia do mês anterior, andando para trás
        fator = max(0.0, 1 - 0.4 * passo / 12 + rnd_hist.uniform(-0.03, 0.03))
        for indicador, (num, den) in atuais.items():
            denominador = None if den is None else round(den * fator)
            # Percentuais evoluem em proporção à base; contagens, ao seu próprio valor.
            numerador = round(num * fator)
            if denominador is not None:
                numerador = min(numerador, denominador)
            RegistroIndicador.objects.update_or_create(
                data=dia, territorio=territorio, indicador=indicador,
                defaults={"numerador": numerador, "denominador": denominador},
            )
        dia = dia.replace(day=1)
instantaneos.registrar(hoje)

# --- Linha do tempo do mapa: datas de cadastro espalhadas em 18 meses ------------------
# SINTÉTICO. As árvores de demonstração nasceram todas no dia da semeadura; aqui o cadastro delas
# é distribuído em ~18 meses (sempre antes da primeira inspeção validada de cada uma) e a condição
# das 120 avaliadas ganha a inspeção validada que a originou, na data em que foi "aplicada". Assim
# o mapa de uma data passada difere do de hoje: menos árvores e outras condições.
from django.db.models import Min

for a in com_condicao:
    Inspecao.objects.create(
        arvore=a, tecnico=tecnicos[0], realizada_em=a.condicao_aparente_em,
        condicao_aparente=a.condicao_aparente, estado="validada", revisor=gestor,
        validada_em=a.condicao_aparente_em, aplicado_ao_cadastro=["condicao_aparente"],
        observacoes="Inspeção sintética de demonstração (linha do tempo).",
    )
primeira_inspecao = dict(
    Inspecao.objects.filter(estado="validada").values_list("arvore_id").annotate(m=Min("realizada_em"))
)
for a in Arvore.objects.all():
    quando = agora - timedelta(days=random.randint(0, 540), hours=random.randint(0, 20))
    limite = primeira_inspecao.get(a.id)
    if limite is not None and quando >= limite:
        quando = limite - timedelta(days=random.randint(1, 30))
    Arvore.objects.filter(pk=a.pk).update(criado_em=quando)

print("árvores", Arvore.objects.count(), "ocorrências", Ocorrencia.objects.count(), "tarefas", Tarefa.objects.count())
