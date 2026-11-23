"""Recebimento e processamento dos lotes de detecção, tokens de integração e revisões.

Duas entradas viram a mesma coisa por dentro: a API (``POST /deteccoes/lotes``, com token de
integração ou pessoa com ``deteccao.enviar``) e o pacote ZIP (tela ou comando). Ambas chamam
``receber``, que valida o contrato, guarda as fotos já aceitas e registra o lote; o processamento
(``processar``) roda na própria requisição para lotes pequenos e em tarefa Celery para os grandes,
em blocos transacionais com ponto de retomada.
"""

import hashlib
import io
import logging
import secrets
from dataclasses import dataclass

import pghistory
from django.conf import settings
from django.contrib.gis.db.models import Union
from django.contrib.gis.geos import MultiPolygon
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from itree.conectores import seguranca
from itree.contas.acesso import area_do_escopo
from itree.contas.models import Usuario
from itree.core import armazenamento
from itree.core.geo import ResolvedorDeBairro
from itree.core.ids import uuid7
from itree.evidencias.miniaturas import gerar_miniatura
from itree.evidencias.models import EstadoEvidencia, Evidencia, OrigemEvidencia
from itree.inventario.importacao import CatalogoEspecies
from itree.inventario.models import Arvore, SituacaoArvore
from itree.territorio.models import Territorio

from . import juncao, pacote
from .contrato import (
    LIMITE_ERROS_GUARDADOS,
    TIPOS_FOTO,
    ErroContrato,
    RecusaDeteccao,
    agrupar,
    validar_deteccoes,
    validar_lote,
)
from .models import (
    CanalLote,
    LoteDeteccao,
    Observacao,
    SinalRemocao,
    SituacaoLote,
    SituacaoSinal,
    TokenIntegracao,
)

logger = logging.getLogger(__name__)

# Grupos por transação no processamento: o ponto de retomada avança a cada bloco.
TAMANHO_BLOCO = 100
PERMISSOES_DO_TOKEN = ("deteccao.enviar",)


class LoteJaRecebido(Exception):
    pass


class ArmazenamentoNaoConfigurado(Exception):
    pass


# ---------------------------------------------------------------------------------------------
# Tokens de integração
# ---------------------------------------------------------------------------------------------


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@transaction.atomic
def criar_token(nome: str, territorios, criado_por: Usuario) -> tuple[TokenIntegracao, str]:
    """Cria o token e devolve também o valor em claro, que **só existe agora**."""
    valor = f"itk_{secrets.token_urlsafe(32)}"
    identificador = uuid7()
    usuario = Usuario.objects.create(
        username=f"integracao:{identificador}",
        email=f"integracao-{identificador}@integracoes.itree.invalid",
        nome=f"Integração: {nome}",
        is_active=False,  # nunca entra por OIDC; só assina o que o token cria
        papeis=[],
    )
    token = TokenIntegracao.objects.create(
        id=identificador,
        nome=nome,
        prefixo=valor[:12],
        hash=_hash(valor),
        permissoes=list(PERMISSOES_DO_TOKEN),
        usuario=usuario,
        criado_por=criado_por,
    )
    token.territorios.set(territorios)
    return token, valor


def token_do_valor(valor: str) -> TokenIntegracao | None:
    return TokenIntegracao.objects.select_related("usuario").filter(hash=_hash(valor)).first()


def revogar_token(token: TokenIntegracao, por: Usuario) -> None:
    if token.revogado_em is None:
        token.revogado_em = timezone.now()
        token.revogado_por = por
        token.save(update_fields=["revogado_em", "revogado_por", "atualizado_em"])


def area_do_token(token: TokenIntegracao) -> MultiPolygon | None:
    area = Territorio.objects.filter(tokens_integracao=token).aggregate(area=Union("geom"))["area"]
    if area is not None and area.geom_type == "Polygon":
        area = MultiPolygon(area, srid=area.srid)
    return area


# ---------------------------------------------------------------------------------------------
# Recebimento
# ---------------------------------------------------------------------------------------------


@dataclass
class Envio:
    """Quem enviou, por qual canal e com que escopo territorial."""

    canal: str
    usuario: Usuario
    integracao: TokenIntegracao | None = None
    arquivo_nome: str = ""


def _tipo_da_imagem(conteudo: bytes) -> tuple[str, str]:
    """(tipo, extensão) de uma imagem válida; levanta ``RecusaDeteccao``."""
    limite = settings.DETECCAO_MAX_FOTO_MB * 1024 * 1024
    if len(conteudo) > limite:
        raise RecusaDeteccao(f"foto acima do limite de {settings.DETECCAO_MAX_FOTO_MB} MB.")
    try:
        with Image.open(io.BytesIO(conteudo)) as imagem:
            formato = imagem.format
            imagem.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise RecusaDeteccao("foto não é uma imagem válida.") from None
    if formato not in TIPOS_FOTO:
        raise RecusaDeteccao("foto: use JPEG, PNG ou WebP.")
    return TIPOS_FOTO[formato]


def _chave_foto(lote_id, extensao: str) -> str:
    return f"evidencias/deteccoes/{lote_id}/{uuid7()}.{extensao}"


def _guardar_fotos_enviadas(deteccao: dict, fotos: dict, lote_id, chaves: list[str]) -> None:
    """Guarda no armazenamento as fotos que vieram no próprio envio (multipart ou pacote) e anota
    a chave. Foto por URL só é baixada no processamento. Levanta ``RecusaDeteccao``."""
    for foto in deteccao["fotos"]:
        if not foto["arquivo"]:
            continue
        origem = pacote.procurar_foto(fotos, foto["arquivo"])
        if origem is None:
            raise RecusaDeteccao(f"foto '{foto['arquivo']}' não veio no envio.")
        limite = settings.DETECCAO_MAX_FOTO_MB * 1024 * 1024
        if origem.tamanho > limite:
            raise RecusaDeteccao(f"foto acima do limite de {settings.DETECCAO_MAX_FOTO_MB} MB.")
        conteudo = origem.ler()
        tipo, extensao = _tipo_da_imagem(conteudo)
        chave = _chave_foto(lote_id, extensao)
        armazenamento.gravar(chave, conteudo, tipo)
        chaves.append(chave)
        foto.update(chave=chave, tipo=tipo, tamanho=len(conteudo))


def receber(lote_bruto, deteccoes_brutas, envio: Envio, fotos: dict | None = None) -> LoteDeteccao:
    """Valida o contrato, guarda as fotos aceitas e registra o lote (ainda sem processar).

    Levanta ``ErroContrato`` (422), ``LoteJaRecebido`` (409) ou ``ArmazenamentoNaoConfigurado``
    (503, quando há fotos e não há armazenamento). Detecção inválida não derruba o lote: é
    recusada, com o motivo guardado.
    """
    fotos = fotos or {}
    meta = validar_lote(lote_bruto)
    validas, recusadas = validar_deteccoes(deteccoes_brutas)
    total = len(deteccoes_brutas)
    if LoteDeteccao.objects.filter(
        projeto_origem=meta["projeto_origem"], id_externo=meta["id_externo"]
    ).exists():
        raise LoteJaRecebido(
            f"O lote {meta['id_externo']} do projeto {meta['projeto_origem']} já foi recebido."
        )
    if any(d["fotos"] for d in validas) and not armazenamento.s3_configurado():
        raise ArmazenamentoNaoConfigurado()

    lote_id = uuid7()
    chaves: list[str] = []
    aceitas = []
    for d in validas:
        try:
            _guardar_fotos_enviadas(d, fotos, lote_id, chaves)
            aceitas.append(d)
        except RecusaDeteccao as exc:
            recusadas.append(
                {
                    "id": d["id"],
                    "motivo": str(exc),
                    "longitude": d["longitude"],
                    "latitude": d["latitude"],
                }
            )
    try:
        lote = _criar_lote(
            lote_id, meta, envio, total, recusadas, {"grupos": agrupar(aceitas), "chaves": chaves}
        )
    except IntegrityError as exc:
        # Reenvio simultâneo do mesmo lote: o outro venceu a corrida. Responde 409 e não deixa
        # as fotos deste envio órfãs no bucket.
        for chave in chaves:
            try:
                armazenamento.apagar(chave)
            except Exception:  # noqa: BLE001
                logger.warning("Foto órfã %s não apagada", chave, exc_info=True)
        raise LoteJaRecebido(
            f"O lote {meta['id_externo']} do projeto {meta['projeto_origem']} já foi recebido."
        ) from exc
    return lote


def _criar_lote(lote_id, meta, envio, total, recusadas, carga) -> LoteDeteccao:
    with transaction.atomic():
        return LoteDeteccao.objects.create(
            id=lote_id,
            **meta,
            canal=envio.canal,
            arquivo_nome=envio.arquivo_nome,
            integracao=envio.integracao,
            enviado_por=envio.usuario,
            total=total,
            recusadas=len(recusadas),
            erros=recusadas[:LIMITE_ERROS_GUARDADOS],
            carga=carga,
        )


def receber_pacote(conteudo: bytes, envio: Envio) -> LoteDeteccao:
    """Pacote ZIP: ``lote.json`` + ``deteccoes.geojson`` ou ``deteccoes.gpkg`` + fotos."""
    from itree.inventario.leitura_arquivos import ErroArquivo

    try:
        dados, zip_ = pacote.ler_pacote(conteudo)
    except ErroArquivo as exc:
        raise ErroContrato(str(exc)) from exc
    try:
        return receber(dados.lote, dados.deteccoes, envio, dados.fotos)
    finally:
        zip_.close()


# ---------------------------------------------------------------------------------------------
# Processamento
# ---------------------------------------------------------------------------------------------


def _area(lote: LoteDeteccao) -> MultiPolygon | None:
    """Escopo territorial do envio: o do token de integração ou o da pessoa que enviou."""
    if lote.integracao_id:
        return area_do_token(lote.integracao)
    return area_do_escopo(lote.enviado_por)


def _baixar_foto(foto: dict) -> tuple[bytes, str, str]:
    """Foto por URL, com a proteção de rede dos conectores. Levanta ``RecusaDeteccao``."""
    hosts = {h.strip().lower() for h in settings.ITREE_DETECCAO_HOSTS_FOTOS if h.strip()}
    try:
        conteudo = seguranca.buscar(
            foto["url"],
            limite_bytes=settings.DETECCAO_MAX_FOTO_MB * 1024 * 1024,
            hosts=hosts,
        )
    except seguranca.ErroConector as exc:
        raise RecusaDeteccao(str(exc)) from exc
    tipo, extensao = _tipo_da_imagem(conteudo)
    return conteudo, tipo, extensao


def _registrar_fotos(arvore: Arvore, observacoes: list[Observacao], lote, deteccoes, avisos):
    """Evidências da árvore com origem "detecção". Foto que não pôde ser guardada vira aviso do
    lote, sem derrubar a detecção."""
    por_id = {o.id_deteccao: o for o in observacoes}
    for d in deteccoes:
        for foto in d["fotos"]:
            try:
                chave = foto.get("chave")
                if chave:
                    tipo, tamanho = foto["tipo"], foto["tamanho"]
                else:
                    conteudo, tipo, extensao = _baixar_foto(foto)
                    chave = _chave_foto(lote.id, extensao)
                    armazenamento.gravar(chave, conteudo, tipo)
                    tamanho = len(conteudo)
                    foto["chave"] = chave
                evidencia = Evidencia.objects.create(
                    chave=chave,
                    nome_original=(foto["arquivo"] or foto["url"].rsplit("/", 1)[-1] or "foto")[
                        -255:
                    ],
                    tipo_conteudo=tipo,
                    tamanho=tamanho,
                    descricao=(
                        f"Detecção automática {d['id']} ({lote.get_sensor_display().lower()}, "
                        f"lote {lote.id_externo})."
                    ),
                    capturada_em=foto["capturada_em"],
                    ilustrativa=foto["ilustrativa"],
                    origem=OrigemEvidencia.DETECCAO,
                    anonimizada=True,
                    estado=EstadoEvidencia.DISPONIVEL,
                    enviada_por=lote.enviado_por,
                    arvore=arvore,
                    observacao=por_id.get(d["id"]),
                )
                gerar_miniatura(evidencia)
            except RecusaDeteccao as exc:
                avisos.append({"id": d["id"], "motivo": f"Foto não guardada: {exc}"})
            except Exception:  # noqa: BLE001 - a falha de uma foto não derruba a detecção
                logger.warning("Foto da detecção %s não guardada", d["id"], exc_info=True)
                avisos.append({"id": d["id"], "motivo": "Foto não guardada: erro inesperado."})


def _recusar(lote: LoteDeteccao, grupo: list[dict], motivo: str) -> None:
    for d in grupo:
        lote.recusadas += 1
        if len(lote.erros) < LIMITE_ERROS_GUARDADOS:
            lote.erros.append(
                {
                    "id": d["id"],
                    "motivo": motivo,
                    "longitude": d["longitude"],
                    "latitude": d["latitude"],
                }
            )


def _processar_grupo(lote, grupo, area, catalogo, resolvedor) -> None:
    agregado = juncao.agregar(grupo)
    if area is None or not area.intersects(agregado.ponto):
        _recusar(lote, grupo, "Fora do escopo territorial do envio.")
        return
    if agregado.tipo != "arvore":
        if juncao.tratar_ponto_plantio(agregado, lote, resolvedor):
            lote.pontos_criados += 1
        return
    arvore, resultado = juncao.tratar_arvore(agregado, lote, catalogo, resolvedor)
    if resultado == "criou":
        lote.arvores_criadas += 1
    else:
        lote.arvores_juntadas += 1
    observacoes = list(Observacao.objects.filter(lote=lote, arvore=arvore))
    avisos: list[dict] = []
    _registrar_fotos(arvore, observacoes, lote, grupo, avisos)
    for aviso in avisos:
        if len(lote.erros) < LIMITE_ERROS_GUARDADOS:
            lote.erros.append(aviso)


CONTADORES_LOTE = ("arvores_criadas", "arvores_juntadas", "recusadas", "pontos_criados")


def sinalizar_remocoes(lote: LoteDeteccao) -> int:
    """Árvore ativa, conhecida antes da captura, dentro da área coberta (e do escopo do envio) que
    o lote não viu vira sinal de possível remoção. Nunca remove: só abre a revisão. Sem área
    coberta não há como saber o que o lote deveria ter visto, então não há sinal."""
    if lote.area_coberta is None:
        return 0
    escopo = _area(lote)
    if escopo is None:
        # Sem escopo territorial o envio não vale em lugar nenhum (como em filtrar_por_escopo).
        return 0
    area = lote.area_coberta.intersection(escopo)
    if area.empty:
        return 0
    vistas = Observacao.objects.filter(lote=lote).values("arvore_id")
    candidatas = Arvore.objects.filter(
        situacao=SituacaoArvore.ATIVA,
        geom__intersects=area,
        criado_em__date__lte=lote.capturado_em,
    ).exclude(pk__in=vistas)
    novos = 0
    for arvore in candidatas.exclude(
        Q(sinais_remocao__situacao=SituacaoSinal.PENDENTE) | Q(sinais_remocao__lote=lote)
    ).iterator():
        _, criado = SinalRemocao.objects.get_or_create(arvore=arvore, lote=lote)
        novos += criado
    return novos


def _concluir(lote: LoteDeteccao, chaves_usadas: set[str]) -> None:
    lote.possiveis_remocoes = lote.sinais_remocao.count()
    # Fotos aceitas no envio de detecções que acabaram recusadas: ficariam órfãs no bucket.
    for chave in set(lote.carga.get("chaves", [])) - chaves_usadas:
        try:
            armazenamento.apagar(chave)
        except Exception:  # noqa: BLE001
            logger.warning("Foto órfã %s não apagada", chave, exc_info=True)
    lote.situacao = SituacaoLote.CONCLUIDO
    lote.processado_em = timezone.now()
    lote.carga = {}
    lote.erro = ""
    lote.save()


def processar(lote_id) -> LoteDeteccao | None:
    """Processa o lote em blocos, retomando do ponto gravado. Idempotente: lote já concluído
    não é tratado de novo."""
    with transaction.atomic():
        lote = LoteDeteccao.objects.select_for_update().filter(pk=lote_id).first()
        if lote is None or lote.situacao in (SituacaoLote.CONCLUIDO,):
            return lote
        lote.situacao = SituacaoLote.EM_PROCESSAMENTO
        lote.save(update_fields=["situacao", "atualizado_em"])
    grupos = lote.carga["grupos"]
    area = _area(lote)
    catalogo, resolvedor = CatalogoEspecies(), ResolvedorDeBairro()
    contexto = {"evento": "deteccao_lote", "lote": str(lote.id), "projeto": lote.projeto_origem}
    try:
        with pghistory.context(**contexto):
            while lote.processadas < len(grupos):
                inicio = lote.processadas
                fim = min(inicio + TAMANHO_BLOCO, len(grupos))
                with transaction.atomic():
                    for grupo in grupos[lote.processadas : fim]:
                        try:
                            with transaction.atomic():
                                _processar_grupo(lote, grupo, area, catalogo, resolvedor)
                        except Exception:  # noqa: BLE001 - um grupo ruim não derruba o lote
                            logger.exception("Grupo de detecções do lote %s falhou", lote.pk)
                            _recusar(lote, grupo, "Erro inesperado ao tratar esta detecção.")
                    lote.processadas = fim
                    # Só os contadores: regravar a carga (vários MB) a cada bloco custa caro. Ela
                    # muda só quando uma foto por URL ganhou chave (para a retomada não baixar de
                    # novo).
                    campos = [*CONTADORES_LOTE, "erros", "processadas", "atualizado_em"]
                    if any(
                        f.get("url")
                        for g in grupos[inicio:fim]
                        for d in g
                        for f in d.get("fotos", [])
                    ):
                        campos.append("carga")
                    lote.save(update_fields=campos)
            with transaction.atomic():
                sinalizar_remocoes(lote)
                usadas = set(
                    Evidencia.objects.filter(
                        origem=OrigemEvidencia.DETECCAO, observacao__lote=lote
                    ).values_list("chave", flat=True)
                )
                _concluir(lote, usadas)
    except Exception as exc:
        logger.exception("Processamento do lote %s interrompido", lote.pk)
        LoteDeteccao.objects.filter(pk=lote.pk).update(
            situacao=SituacaoLote.FALHOU, erro=f"{type(exc).__name__}: {exc}"[:1000]
        )
        lote.refresh_from_db()
    return lote


def enfileirar(lote: LoteDeteccao) -> None:
    """Põe o lote na fila; sem fila, ele não pode ficar "em processamento" para sempre."""
    from .tasks import processar_lote

    lote.situacao = SituacaoLote.EM_PROCESSAMENTO
    lote.save(update_fields=["situacao", "atualizado_em"])
    try:
        processar_lote.delay(str(lote.pk))
    except Exception:  # noqa: BLE001
        logger.exception("Não foi possível enfileirar o lote %s", lote.pk)
        lote.situacao = SituacaoLote.FALHOU
        lote.erro = "Não foi possível colocar o lote na fila de processamento. Reenvie."
        lote.save(update_fields=["situacao", "erro", "atualizado_em"])


def processar_ou_enfileirar(lote: LoteDeteccao) -> LoteDeteccao:
    """Até ``DETECCAO_LIMITE_SINCRONO`` detecções, na própria requisição; acima, Celery."""
    if lote.total <= settings.DETECCAO_LIMITE_SINCRONO:
        return processar(lote.pk)
    enfileirar(lote)
    lote.refresh_from_db()
    return lote


def enviar(lote_bruto, deteccoes_brutas, envio: Envio, fotos=None) -> LoteDeteccao:
    return processar_ou_enfileirar(receber(lote_bruto, deteccoes_brutas, envio, fotos))


def enviar_pacote(conteudo: bytes, envio: Envio) -> LoteDeteccao:
    return processar_ou_enfileirar(receber_pacote(conteudo, envio))


# ---------------------------------------------------------------------------------------------
# Revisão humana
# ---------------------------------------------------------------------------------------------


class ErroRevisao(Exception):
    pass


@transaction.atomic
def confirmar_arvore(arvore: Arvore, por: Usuario, motivo: str = "") -> Arvore:
    """Promove a árvore detectada a "confirmada" (revisão humana ou inspeção validada)."""
    arvore = Arvore.objects.select_for_update().get(pk=arvore.pk)
    if arvore.confirmada:
        raise ErroRevisao("A árvore já está confirmada.")
    if arvore.situacao != SituacaoArvore.ATIVA:
        raise ErroRevisao("Só árvores ativas podem ser confirmadas.")
    with pghistory.context(motivo=motivo or None, evento="confirmacao_arvore"):
        arvore.confirmada = True
        arvore.confirmada_em = timezone.now()
        arvore.confirmada_por = por
        arvore.save(
            update_fields=["confirmada", "confirmada_em", "confirmada_por", "atualizado_em"]
        )
    return arvore


@transaction.atomic
def decidir_remocao(
    sinal: SinalRemocao, por: Usuario, confirmar: bool, motivo: str
) -> SinalRemocao:
    """Confirmar a remoção exclui a árvore (exclusão lógica, com a justificativa); descartar só
    fecha o sinal."""
    sinal = SinalRemocao.objects.select_for_update().select_related("arvore").get(pk=sinal.pk)
    if sinal.situacao != SituacaoSinal.PENDENTE:
        raise ErroRevisao("Este sinal já foi decidido.")
    if not motivo.strip():
        raise ErroRevisao("Informe a justificativa.")
    with pghistory.context(motivo=motivo, evento="revisao_possivel_remocao"):
        sinal.situacao = SituacaoSinal.REMOCAO_CONFIRMADA if confirmar else SituacaoSinal.DESCARTADO
        sinal.decidido_por, sinal.decidido_em, sinal.motivo = por, timezone.now(), motivo
        sinal.save()
        arvore = sinal.arvore
        if confirmar and arvore.situacao == SituacaoArvore.ATIVA:
            arvore.situacao = SituacaoArvore.EXCLUIDA
            arvore.motivo_situacao = (
                f"Remoção confirmada (detecção, lote {sinal.lote.id_externo}): {motivo}"
            )
            arvore.save(update_fields=["situacao", "motivo_situacao", "atualizado_em"])
    return sinal


__all__ = ["CanalLote"]
