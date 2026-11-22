"""Simulador de detecções: gera um lote **sintético e declarado** e o envia pelo mesmo caminho
da API (``servico.enviar``, que a API também chama depois de validar o token).

    manage.py simular_deteccoes                 # um lote de vídeo de rua e um de satélite
    manage.py simular_deteccoes --semente 3     # outra variação (ids dos lotes mudam junto)

O lote vem do projeto ``simulador-itree`` ("dados sintéticos"), com fotos ``ilustrativa``: nada
aqui é detecção real. São pontos perto das árvores já semeadas (juntam-se a elas), alguns lugares
novos (viram árvores detectadas), um berço vazio, um toco e uma árvore conhecida que o lote não vê
(possível remoção). Serve às capturas de tela e à demonstração; exige árvores já cadastradas.
"""

import io
import json
import math
import random

from django.contrib.gis.geos import MultiPoint, Point
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from PIL import Image, ImageDraw

from itree.contas.models import Usuario
from itree.core import armazenamento
from itree.deteccao import servico
from itree.deteccao.models import CanalLote, TokenIntegracao
from itree.inventario.models import Arvore, Especie, SituacaoArvore
from itree.territorio.models import Territorio, TipoTerritorio

PROJETO = "simulador-itree"
NOME_DA_INTEGRACAO = "Simulador de detecções (dados sintéticos)"
CORES = [(76, 125, 70), (96, 140, 84), (60, 110, 80), (110, 150, 90)]


def deslocar(ponto: Point, leste_m: float, norte_m: float) -> dict:
    return {
        "longitude": ponto.x + leste_m / (111_320 * math.cos(math.radians(ponto.y))),
        "latitude": ponto.y + norte_m / 110_540,
    }


def foto_sintetica(rotulo: str, cor: tuple) -> bytes:
    """Imagem sintética que se declara como tal: não é fotografia de árvore real."""
    imagem = Image.new("RGB", (480, 320), (214, 226, 232))
    desenho = ImageDraw.Draw(imagem)
    desenho.rectangle([0, 230, 480, 320], fill=(150, 150, 150))
    desenho.rectangle([226, 140, 254, 240], fill=(110, 80, 55))
    desenho.ellipse([150, 40, 330, 190], fill=cor)
    desenho.text((12, 10), f"IMAGEM SINTÉTICA ({rotulo})", fill=(40, 40, 40))
    saida = io.BytesIO()
    imagem.save(saida, "JPEG", quality=70)
    return saida.getvalue()


class Command(BaseCommand):
    help = "Gera e envia um lote de detecções sintético (demonstração)."

    def add_arguments(self, parser):
        parser.add_argument("--semente", type=int, default=1, help="Variação do sorteio.")
        parser.add_argument("--arvores", type=int, default=40, help="Árvores semeadas a usar.")

    def handle(self, *args, **opts):
        sorteio = random.Random(opts["semente"])  # noqa: S311 - dados sintéticos, não é segredo
        existentes = list(
            Arvore.objects.filter(
                situacao=SituacaoArvore.ATIVA, geom__isnull=False, confirmada=True
            ).order_by("numero")[:400]
        )
        if len(existentes) < 8:
            raise CommandError("Cadastre ou semeie ao menos 8 árvores antes de simular.")
        escolhidas = sorteio.sample(existentes, min(opts["arvores"], len(existentes)))
        if not armazenamento.s3_configurado():
            self.stderr.write("Armazenamento não configurado: o lote segue sem fotos.")
        envio = self._envio()
        nomes = list(Especie.objects.filter(ativa=True).values_list("nome_cientifico", flat=True))

        self._video(sorteio, escolhidas, nomes, envio, opts["semente"])
        self._satelite(sorteio, existentes, nomes, envio, opts["semente"])

    def _envio(self) -> servico.Envio:
        token = TokenIntegracao.objects.filter(
            nome=NOME_DA_INTEGRACAO, revogado_em__isnull=True
        ).first()
        if token is None:
            admin = Usuario.objects.filter(papeis__contains=["administrador"]).first()
            municipios = Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO)
            token, _ = servico.criar_token(NOME_DA_INTEGRACAO, municipios, admin)
        return servico.Envio(canal=CanalLote.API, usuario=token.usuario, integracao=token)

    def _enviar(self, lote: dict, deteccoes: list[dict], envio, fotos: dict | None = None):
        try:
            resultado = servico.enviar(lote, deteccoes, envio, fotos)
        except servico.LoteJaRecebido as exc:
            raise CommandError(f"{exc} Use outra --semente.") from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"Lote sintético {resultado.id_externo} ({resultado.sensor}): "
                f"{resultado.arvores_criadas} criada(s), {resultado.arvores_juntadas} juntada(s), "
                f"{resultado.recusadas} recusada(s), {resultado.pontos_criados} ponto(s) de "
                f"plantio, {resultado.possiveis_remocoes} possível(is) remoção(ões)."
            )
        )
        for erro in resultado.erros[:5]:
            self.stderr.write(f"  {erro['id']}: {erro['motivo']}")

    def _fotos(self, deteccao: dict, rotulo: str, sorteio, fotos: dict) -> None:
        if not armazenamento.s3_configurado():
            return
        nome = f"fotos/{deteccao['id']}.jpg"
        fotos[nome] = _Foto(foto_sintetica(rotulo, sorteio.choice(CORES)))
        deteccao["fotos"] = [
            {
                "arquivo": nome,
                "capturada_em": timezone.now().isoformat(),
                "anonimizada": True,  # imagem sintética: não há rosto nem placa
                "ilustrativa": True,
            }
        ]

    def _base(self, sorteio, ident: str, ponto: dict, confianca: float, nomes: list) -> dict:
        principal = sorteio.choice(nomes) if nomes else "Licania tomentosa"
        outras = [n for n in nomes if n != principal]
        especies = [{"nome_cientifico": principal, "probabilidade": round(confianca * 0.9, 2)}]
        if outras:
            especies.append(
                {
                    "nome_cientifico": sorteio.choice(outras),
                    "probabilidade": round((1 - confianca) * 0.6, 2),
                }
            )
        return {
            "id": ident,
            "tipo": "arvore",
            "localizacao": ponto,
            "incerteza_m": round(sorteio.uniform(0.8, 3.5), 1),
            "confianca": confianca,
            "especies": especies,
            "medidas": {
                "altura": {
                    "valor": round(sorteio.uniform(4, 14), 1),
                    "unidade": "m",
                    "incerteza": 1.5,
                },
                "diametro_copa": {"valor": round(sorteio.uniform(3, 9), 1), "unidade": "m"},
            },
            "contexto": sorteio.choice(["calcada", "calcada", "canteiro", "praca"]),
            "interferencias": sorteio.sample(
                ["fiacao", "poste", "fachada"], k=sorteio.randint(0, 2)
            ),
            "sinais": sorteio.sample(
                ["galhos_secos", "copa_rala", "inclinacao"], k=sorteio.randint(0, 1)
            ),
            "qualidade_imagem": round(sorteio.uniform(0.55, 0.95), 2),
        }

    def _video(self, sorteio, escolhidas, nomes, envio, semente):
        hoje = timezone.localdate()
        vistas = escolhidas[1:]  # a primeira escolhida não é vista: possível remoção
        # Área coberta: ~9 m em volta de cada árvore escolhida. Só o que está lá dentro pode virar
        # possível remoção, então o simulador não sinaliza o resto do cadastro.
        casco = MultiPoint([a.geom for a in escolhidas], srid=4326).buffer(0.00008)
        deteccoes, fotos = [], {}
        for i, arvore in enumerate(vistas):
            confianca = round(sorteio.choice([0.45, 0.62, 0.74, 0.86, 0.93]), 2)
            for quadro in range(sorteio.choice([1, 1, 2, 3])):  # mesma árvore em vários quadros
                d = self._base(
                    sorteio,
                    f"v{semente}-{i:03d}-{quadro}",
                    deslocar(arvore.geom, sorteio.uniform(-1.2, 1.2), sorteio.uniform(-1.2, 1.2)),
                    confianca,
                    nomes,
                )
                d["id_rastreamento"] = f"v{semente}-t{i:03d}"
                if quadro == 0 and i < 6:
                    self._fotos(d, "vídeo de rua", sorteio, fotos)
                deteccoes.append(d)
        base = vistas[0].geom
        for j in range(8):  # lugares novos: viram árvores detectadas
            ponto = deslocar(base, sorteio.uniform(-60, 60), sorteio.uniform(-60, 60))
            d = self._base(
                sorteio, f"v{semente}-n{j}", ponto, round(sorteio.uniform(0.3, 0.95), 2), nomes
            )
            d["id_rastreamento"] = f"v{semente}-tn{j}"
            if j < 3:
                self._fotos(d, "vídeo de rua", sorteio, fotos)
            deteccoes.append(d)
        for tipo, deslocamento in (("berco_vazio", 25), ("berco_vazio", -30), ("toco", 40)):
            deteccoes.append(
                {
                    "id": f"v{semente}-{tipo}-{deslocamento}",
                    "tipo": tipo,
                    "localizacao": deslocar(base, deslocamento, deslocamento / 2),
                    "incerteza_m": 1.5,
                    "confianca": round(sorteio.uniform(0.6, 0.9), 2),
                    "contexto": "calcada",
                }
            )
        lote = {
            "id": f"simulado-video-{semente}",
            "projeto_origem": PROJETO,
            "versao_modelo": "simulador (dados sintéticos)",
            "sensor": "video_rua",
            "capturado_em": hoje.isoformat(),
            "area_coberta": json.loads(casco.json),
        }
        # A árvore sumida está dentro da área coberta e fora das detecções: possível remoção.
        self._enviar(lote, deteccoes, envio, fotos)

    def _satelite(self, sorteio, existentes, nomes, envio, semente):
        referencia = sorteio.choice(existentes).geom
        deteccoes = []
        for j in range(6):
            ponto = deslocar(referencia, sorteio.uniform(-150, 150), sorteio.uniform(-150, 150))
            d = self._base(
                sorteio, f"s{semente}-{j}", ponto, round(sorteio.uniform(0.35, 0.8), 2), nomes
            )
            d["incerteza_m"] = round(sorteio.uniform(3, 6), 1)  # imagem de satélite: menos precisa
            d.pop("interferencias"), d.pop("sinais"), d.pop("contexto")
            deteccoes.append(d)
        lote = {
            "id": f"simulado-satelite-{semente}",
            "projeto_origem": PROJETO,
            "versao_modelo": "simulador (dados sintéticos)",
            "sensor": "satelite",
            "capturado_em": timezone.localdate().isoformat(),
        }
        self._enviar(lote, deteccoes, envio)


class _Foto:
    def __init__(self, conteudo: bytes):
        self._conteudo = conteudo
        self.tamanho = len(conteudo)

    def ler(self) -> bytes:
        return self._conteudo
