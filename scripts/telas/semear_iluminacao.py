"""Árvores SINTÉTICAS de demonstração a 1,5–2,5 m de pontos de iluminação reais (executar com manage shell).

Roda depois de `importar_iluminacao_publica`. Sem isso, o acaso decide se alguma árvore sintética da
semeadura cai a até 3 m de um dos ~150 mil postes, e a captura `40-arvores-iluminacao` sairia vazia.
As árvores são inventadas, marcadas no endereço como sintéticas e não dizem nada sobre a realidade;
só os pontos de iluminação são dado da fonte oficial.
"""
import math
import random

from django.contrib.gis.geos import Point, Polygon

from itree.contas.models import Usuario
from itree.iluminacao.models import PontoIluminacao
from itree.inventario.models import Arvore, Especie

random.seed(20261115)
gestor = Usuario.objects.get(email="gestor@itree.local")
# Janela das capturas do mapa: a mesma da semeadura, em torno de (-38,535; -3,745).
janela = Polygon.from_bbox((-38.545, -3.750, -38.525, -3.740))
janela.srid = 4326
postes = list(PontoIluminacao.objects.filter(geom__within=janela).order_by("codigo")[:400])
if not postes:
    print("Sem pontos de iluminação na janela das capturas: nenhuma árvore sintética criada.")
else:
    especies = list(Especie.objects.filter(ativa=True)[:8])
    criadas = 0
    for p in random.sample(postes, min(8, len(postes))):
        # ~1,5 a 2,5 m (1 grau de latitude ≈ 111 km).
        distancia = random.uniform(1.5, 2.5) / 111_000
        angulo = random.uniform(0, 2 * math.pi)
        Arvore.objects.create(
            geom=Point(p.geom.x + distancia * math.cos(angulo), p.geom.y + distancia * math.sin(angulo), srid=4326),
            localizacao_origem="estimada_web",
            especie=random.choice(especies) if especies else None,
            especie_estado="informada" if especies else "nao_identificada",
            endereco="Árvore sintética de demonstração (perto de poste real)",
            origem_registro="web",
            criado_por=gestor,
        )
        criadas += 1
    print(f"{criadas} árvore(s) sintética(s) criada(s) perto de postes reais.")
