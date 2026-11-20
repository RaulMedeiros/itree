"""Galeria de fotos e linha do tempo visual da ficha da árvore.

Só junta o que já existe: o acesso a cada origem segue a permissão de leitura dela
(inspeções, ocorrências, tarefas) e o escopo territorial de hoje.
"""

from datetime import datetime, time

from django.utils import timezone
from rest_framework import serializers

from itree.contas.acesso import filtrar_por_escopo
from itree.contas.permissoes import Permissao
from itree.core import armazenamento
from itree.evidencias.models import EstadoEvidencia, Evidencia
from itree.inspecoes.models import EstadoInspecao, Inspecao
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import EstadoTarefa, Tarefa

from .models import Medida, TipoMedida

P = Permissao
ORIGENS = ("evidencia", "inspecao", "ocorrencia", "tarefa")
TIPOS_EVENTO = ("cadastro", "medicao", "inspecao", "ocorrencia", "tarefa", "poda")


class FotoArvoreSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    url = serializers.CharField(allow_null=True, help_text="URL temporária (5 min) do original.")
    url_miniatura = serializers.CharField(
        allow_null=True, help_text="URL temporária da miniatura; nula se não houver."
    )
    descricao = serializers.CharField()
    nome_original = serializers.CharField()
    data = serializers.DateTimeField(help_text="Captura, ou envio se a captura não é conhecida.")
    origem = serializers.ChoiceField(choices=ORIGENS)
    origem_id = serializers.UUIDField(allow_null=True)
    origem_codigo = serializers.CharField(allow_blank=True)
    autor = serializers.CharField()
    ilustrativa = serializers.BooleanField()


def _foto(ev: Evidencia, origem: str, origem_id, codigo: str) -> dict:
    disponivel = armazenamento.s3_configurado()
    return {
        "id": ev.id,
        "url": armazenamento.url_download(ev.chave) if disponivel else None,
        "url_miniatura": (
            armazenamento.url_download(ev.chave_miniatura)
            if disponivel and ev.chave_miniatura
            else None
        ),
        "descricao": ev.descricao,
        "nome_original": ev.nome_original,
        "data": ev.capturada_em or ev.criado_em,
        "origem": origem,
        "origem_id": origem_id,
        "origem_codigo": codigo,
        "autor": ev.enviada_por.nome or ev.enviada_por.email,
        "ilustrativa": ev.ilustrativa,
    }


def fotos_da_arvore(arvore, usuario) -> list[dict]:
    """Imagens disponíveis da árvore, das inspeções, das ocorrências e das tarefas ligadas
    a ela, em ordem cronológica."""
    base = Evidencia.objects.filter(
        estado=EstadoEvidencia.DISPONIVEL, tipo_conteudo__startswith="image/"
    ).select_related("enviada_por")
    fotos = [_foto(e, "evidencia", None, arvore.codigo) for e in base.filter(arvore=arvore)]
    if usuario.tem_permissao(P.INSPECOES_LER):
        inspecoes = {i.pk: i for i in Inspecao.objects.filter(arvore=arvore)}
        fotos += [
            _foto(e, "inspecao", e.inspecao_id, inspecoes[e.inspecao_id].codigo)
            for e in base.filter(inspecao__in=inspecoes)
        ]
    if usuario.tem_permissao(P.OCORRENCIAS_LER):
        ocorrencias = {
            o.pk: o for o in filtrar_por_escopo(Ocorrencia.objects.filter(arvore=arvore), usuario)
        }
        fotos += [
            _foto(e, "ocorrencia", e.ocorrencia_id, ocorrencias[e.ocorrencia_id].codigo)
            for e in base.filter(ocorrencia__in=ocorrencias)
        ]
    if usuario.tem_permissao(P.TAREFAS_LER):
        tarefas = {
            t.pk: t for t in filtrar_por_escopo(Tarefa.objects.filter(arvore=arvore), usuario)
        }
        fotos += [
            _foto(e, "tarefa", e.tarefa_id, tarefas[e.tarefa_id].codigo)
            for e in base.filter(tarefa__in=tarefas)
        ]
    fotos.sort(key=lambda f: (f["data"], str(f["id"])))
    return fotos


class EventoLinhaDoTempoSerializer(serializers.Serializer):
    id = serializers.CharField()
    tipo = serializers.ChoiceField(choices=TIPOS_EVENTO)
    data = serializers.DateTimeField()
    titulo = serializers.CharField()
    resumo = serializers.CharField(allow_blank=True)
    condicao = serializers.CharField(
        allow_blank=True, help_text="Condição aparente da inspeção validada; vazia nos demais."
    )
    origem_id = serializers.UUIDField(allow_null=True, help_text="Registro a abrir ao clicar.")


class PontoCondicaoSerializer(serializers.Serializer):
    data = serializers.DateTimeField()
    condicao = serializers.CharField()
    inspecao_codigo = serializers.CharField()


class PontoMedidaSerializer(serializers.Serializer):
    data = serializers.DateField()
    valor = serializers.FloatField()
    unidade = serializers.CharField()
    origem = serializers.CharField()


class SerieMedidaSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=[TipoMedida.ALTURA, TipoMedida.DAP])
    unidade = serializers.CharField()
    pontos = PontoMedidaSerializer(many=True)


class LinhaDoTempoSerializer(serializers.Serializer):
    eventos = EventoLinhaDoTempoSerializer(many=True)
    condicao = PontoCondicaoSerializer(many=True)
    medidas = SerieMedidaSerializer(many=True)


def _data_da_medida(m: Medida):
    if m.data_medicao:
        return timezone.make_aware(datetime.combine(m.data_medicao, time(12)))
    return m.criado_em


def linha_do_tempo(arvore, usuario) -> dict:
    eventos = [
        {
            "id": f"cadastro-{arvore.pk}",
            "tipo": "cadastro",
            "data": arvore.criado_em,
            "titulo": "Cadastro da árvore",
            "resumo": f"{arvore.codigo} cadastrada.",
            "condicao": "",
            "origem_id": None,
        }
    ]
    condicao: list[dict] = []

    medidas = list(arvore.medidas.filter(aplicada=True).order_by("data_medicao", "criado_em"))
    por_data: dict = {}
    for m in medidas:
        por_data.setdefault(m.data_medicao or m.criado_em.date(), []).append(m)
    for dia, grupo in por_data.items():
        eventos.append(
            {
                "id": f"medicao-{dia}",
                "tipo": "medicao",
                "data": _data_da_medida(grupo[0]),
                "titulo": "Medição",
                "resumo": "; ".join(
                    f"{m.get_tipo_display()} {m.valor:g} {m.unidade}" for m in grupo
                ),
                "condicao": "",
                "origem_id": None,
            }
        )
    series = []
    for tipo in (TipoMedida.ALTURA, TipoMedida.DAP):
        pontos = [
            {
                "data": m.data_medicao or m.criado_em.date(),
                "valor": float(m.valor),
                "unidade": m.unidade,
                "origem": m.origem,
            }
            for m in medidas
            if m.tipo == tipo
        ]
        if pontos:
            series.append({"tipo": tipo, "unidade": pontos[-1]["unidade"], "pontos": pontos})

    if usuario.tem_permissao(P.INSPECOES_LER):
        for i in Inspecao.objects.filter(arvore=arvore).order_by("realizada_em"):
            validada = i.estado == EstadoInspecao.VALIDADA
            eventos.append(
                {
                    "id": f"inspecao-{i.pk}",
                    "tipo": "inspecao",
                    "data": i.realizada_em,
                    "titulo": f"Inspeção {i.codigo}",
                    "resumo": (
                        f"Condição aparente: {i.get_condicao_aparente_display()}."
                        if validada
                        else f"{i.get_estado_display()}; a condição só vale depois de validada."
                    ),
                    "condicao": i.condicao_aparente if validada else "",
                    "origem_id": i.pk,
                }
            )
            if validada:
                condicao.append(
                    {
                        "data": i.validada_em or i.realizada_em,
                        "condicao": i.condicao_aparente,
                        "inspecao_codigo": i.codigo,
                    }
                )
    if usuario.tem_permissao(P.OCORRENCIAS_LER):
        for o in filtrar_por_escopo(
            Ocorrencia.objects.filter(arvore=arvore).select_related("tipo"), usuario
        ):
            eventos.append(
                {
                    "id": f"ocorrencia-{o.pk}",
                    "tipo": "ocorrencia",
                    "data": o.criado_em,
                    "titulo": f"Ocorrência {o.codigo}",
                    "resumo": f"{o.tipo.nome} ({o.get_estado_display()}).",
                    "condicao": "",
                    "origem_id": o.pk,
                }
            )
    if usuario.tem_permissao(P.TAREFAS_LER):
        tarefas = filtrar_por_escopo(
            Tarefa.objects.filter(arvore=arvore, estado=EstadoTarefa.CONCLUIDA).select_related(
                "ocorrencia__tipo"
            ),
            usuario,
        )
        for t in tarefas:
            tipo_oco = t.ocorrencia.tipo.nome if t.ocorrencia_id else ""
            poda = "poda" in tipo_oco.lower()
            eventos.append(
                {
                    "id": f"tarefa-{t.pk}",
                    "tipo": "poda" if poda else "tarefa",
                    "data": t.concluida_em or t.atualizado_em,
                    "titulo": f"{'Poda concluída' if poda else 'Tarefa concluída'} {t.codigo}",
                    "resumo": t.resultado or t.get_tipo_display(),
                    "condicao": "",
                    "origem_id": t.pk,
                }
            )
    eventos.sort(key=lambda e: (e["data"], e["id"]))
    condicao.sort(key=lambda c: c["data"])
    return {"eventos": eventos, "condicao": condicao, "medidas": series}
