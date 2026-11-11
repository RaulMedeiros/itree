"""Regras de inspeção: sincronização com o aplicativo e revisão no web (W-05)."""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

import pghistory
from django.db import transaction
from django.utils import timezone

from itree.contas.acesso import ponto_no_escopo
from itree.inventario.models import (
    UNIDADES_POR_TIPO,
    Arvore,
    EstadoEspecie,
    Medida,
    OrigemLocalizacao,
    SituacaoArvore,
)
from itree.notificacoes import servicos as notificacoes
from itree.ocorrencias.models import Ocorrencia, OrigemOcorrencia, TipoOcorrencia
from itree.tarefas.acesso import pode_atuar
from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, EstadoTarefa, Tarefa, TipoTarefa

from .models import CondicaoAparente, EstadoInspecao, Inspecao, SinalObservado

EDITAVEIS_NO_DISPOSITIVO = {EstadoInspecao.RASCUNHO, EstadoInspecao.DEVOLVIDA}
APLICAVEIS = ("especie", "condicao_aparente", "medidas", "localizacao")


class ErroInspecao(Exception):
    pass


@dataclass
class Resultado:
    id: str
    status: str  # criada | atualizada | ja_recebida | conflito | erro
    versao: int | None = None
    estado: str | None = None
    mensagem: str = ""
    erros: dict = field(default_factory=dict)


def _concluir_tarefa(inspecao: Inspecao) -> None:
    """RF-EQP-008: a tarefa de inspeção é concluída quando a inspeção é enviada à revisão."""
    tarefa = inspecao.tarefa
    if tarefa and tarefa.estado not in ESTADOS_FINAIS_TAREFA:
        tarefa.estado = EstadoTarefa.CONCLUIDA
        tarefa.concluida_em = timezone.now()
        tarefa.motivo_estado = f"Concluída pelo envio da inspeção {inspecao.codigo} para revisão."
        tarefa.save(update_fields=["estado", "concluida_em", "motivo_estado", "atualizado_em"])
        notificacoes.tarefa_concluida_ou_bloqueada(tarefa, autor=inspecao.tecnico)


def _gravar_medidas(inspecao: Inspecao, medidas: list[dict], usuario) -> None:
    inspecao.medidas.all().delete()
    for m in medidas:
        Medida.objects.create(
            arvore=inspecao.arvore,
            inspecao=inspecao,
            aplicada=False,
            tipo=m["tipo"],
            valor=Decimal(str(m["valor"])),
            unidade=UNIDADES_POR_TIPO[m["tipo"]],
            metodo=m["metodo"],
            origem=m["origem"],
            data_medicao=m.get("data_medicao") or inspecao.realizada_em.date(),
            responsavel=usuario,
            observacao=m.get("observacao", ""),
        )


def sincronizar_item(dados: dict, usuario, dispositivo: str) -> Resultado:
    """Recebe uma inspeção do aplicativo. Idempotente por ID e versão.

    - ID novo: cria (versão 1).
    - Reenvio sem versão base de algo já recebido: ``ja_recebida`` (nada muda).
    - Versão base diferente da do servidor, ou inspeção já em revisão/validada:
      ``conflito`` — o servidor nunca resolve conflito em silêncio.
    """
    ident = str(dados["id"])
    arvore: Arvore = dados["arvore"]
    if arvore.situacao != SituacaoArvore.ATIVA:
        return Resultado(ident, "erro", mensagem="A árvore não está ativa no cadastro.")
    if arvore.geom is None or not ponto_no_escopo(usuario, arvore.geom):
        return Resultado(ident, "erro", mensagem="A árvore está fora do seu escopo territorial.")

    tarefa = dados.get("tarefa")
    if tarefa is not None:
        if tarefa.arvore_id != arvore.pk:
            return Resultado(ident, "erro", mensagem="A tarefa informada não é desta árvore.")
        if not pode_atuar(usuario, tarefa):
            return Resultado(
                ident,
                "erro",
                mensagem="Só o responsável, a equipe ou a coordenação podem concluir a tarefa.",
            )

    enviar = dados.get("enviar_para_revisao", False)
    campos = {
        "arvore": arvore,
        "tarefa": tarefa,
        "realizada_em": dados["realizada_em"],
        "geom": dados.get("geom"),
        "precisao_m": dados.get("precisao_m"),
        "arvore_confirmada": dados.get("arvore_confirmada", True),
        "especie": dados.get("especie"),
        "especie_texto": dados.get("especie_texto", ""),
        "condicao_aparente": dados.get("condicao_aparente", "nao_avaliada"),
        "sinais": sorted(set(dados.get("sinais", []))),
        "observacoes": dados.get("observacoes", ""),
        "requer_encaminhamento": dados.get("requer_encaminhamento", False),
        "dispositivo": dispositivo[:100],
    }

    with transaction.atomic():
        existente = Inspecao.objects.select_for_update().filter(pk=ident).first()
        if existente is None:
            inspecao = Inspecao(
                id=ident,
                tecnico=usuario,
                estado=EstadoInspecao.EM_REVISAO if enviar else EstadoInspecao.RASCUNHO,
                **campos,
            )
            inspecao.save()
            _gravar_medidas(inspecao, dados.get("medidas", []), usuario)
            if enviar:
                _concluir_tarefa(inspecao)
                notificacoes.inspecao_para_revisao(inspecao)
            return Resultado(ident, "criada", inspecao.versao, inspecao.estado)

        if existente.tecnico_id != usuario.pk:
            return Resultado(
                ident,
                "conflito",
                existente.versao,
                existente.estado,
                "Esta inspeção pertence a outro técnico.",
            )
        versao_base = dados.get("versao_base")
        if versao_base is None:
            return Resultado(
                ident,
                "ja_recebida",
                existente.versao,
                existente.estado,
                "Inspeção já recebida anteriormente.",
            )
        if versao_base != existente.versao:
            return Resultado(
                ident,
                "conflito",
                existente.versao,
                existente.estado,
                "A inspeção foi alterada no servidor desde o último envio.",
            )
        if existente.estado not in EDITAVEIS_NO_DISPOSITIVO:
            return Resultado(
                ident,
                "conflito",
                existente.versao,
                existente.estado,
                "A inspeção já está em revisão ou validada e não pode ser alterada.",
            )

        for nome, valor in campos.items():
            setattr(existente, nome, valor)
        existente.versao += 1
        if enviar:
            existente.estado = EstadoInspecao.EM_REVISAO
            existente.motivo_devolucao = ""
        existente.save()
        _gravar_medidas(existente, dados.get("medidas", []), usuario)
        if enviar:
            _concluir_tarefa(existente)
            notificacoes.inspecao_para_revisao(existente)
        return Resultado(ident, "atualizada", existente.versao, existente.estado)


@transaction.atomic
def validar(inspecao: Inspecao, revisor, aplicar: list[str], motivo: str = "") -> Inspecao:
    """Valida e aplica ao cadastro **somente** os valores escolhidos (RF-INSP-006)."""
    inspecao = Inspecao.objects.select_for_update().get(pk=inspecao.pk)
    if inspecao.estado != EstadoInspecao.EM_REVISAO:
        raise ErroInspecao("Só inspeções em revisão podem ser validadas.")
    desconhecidos = set(aplicar) - set(APLICAVEIS)
    if desconhecidos:
        raise ErroInspecao(f"Valores não aplicáveis: {', '.join(sorted(desconhecidos))}.")
    if inspecao.tecnico_id == revisor.pk:
        raise ErroInspecao("A inspeção deve ser validada por outra pessoa.")

    arvore = Arvore.objects.select_for_update().get(pk=inspecao.arvore_id)
    campos_arvore = ["ultima_inspecao_em", "atualizado_em"]
    if arvore.ultima_inspecao_em is None or inspecao.realizada_em > arvore.ultima_inspecao_em:
        arvore.ultima_inspecao_em = inspecao.realizada_em

    if "especie" in aplicar:
        if inspecao.especie_id is None:
            raise ErroInspecao("A inspeção não informou espécie do catálogo.")
        arvore.especie_id = inspecao.especie_id
        arvore.especie_estado = EstadoEspecie.CONFIRMADA
        campos_arvore += ["especie", "especie_estado"]
    if "condicao_aparente" in aplicar:
        arvore.condicao_aparente = inspecao.condicao_aparente
        arvore.condicao_aparente_em = inspecao.realizada_em
        campos_arvore += ["condicao_aparente", "condicao_aparente_em"]
    if "localizacao" in aplicar:
        if inspecao.geom is None:
            raise ErroInspecao("A inspeção não tem localização GPS.")
        arvore.geom = inspecao.geom
        arvore.localizacao_origem = OrigemLocalizacao.GPS_CAMPO
        arvore.precisao_m = inspecao.precisao_m
        campos_arvore += ["geom", "localizacao_origem", "precisao_m"]

    with pghistory.context(
        motivo=motivo or None, evento="validacao_inspecao", inspecao=inspecao.codigo
    ):
        arvore.save(update_fields=campos_arvore)
        if "medidas" in aplicar:
            inspecao.medidas.update(aplicada=True)
        inspecao.estado = EstadoInspecao.VALIDADA
        inspecao.revisor = revisor
        inspecao.validada_em = timezone.now()
        inspecao.aplicado_ao_cadastro = sorted(aplicar)
        inspecao.versao += 1
        inspecao.save()
    return inspecao


@transaction.atomic
def devolver(inspecao: Inspecao, revisor, motivo: str) -> Inspecao:
    inspecao = Inspecao.objects.select_for_update().get(pk=inspecao.pk)
    if inspecao.estado != EstadoInspecao.EM_REVISAO:
        raise ErroInspecao("Só inspeções em revisão podem ser devolvidas.")
    if not motivo.strip():
        raise ErroInspecao("Informe o motivo da devolução.")
    with pghistory.context(motivo=motivo):
        inspecao.estado = EstadoInspecao.DEVOLVIDA
        inspecao.motivo_devolucao = motivo
        inspecao.revisor = revisor
        inspecao.versao += 1
        inspecao.save()
        notificacoes.inspecao_devolvida(inspecao, motivo)
    return inspecao


@dataclass
class Encaminhamento:
    """Resultado de "validar e encaminhar": a inspeção validada e o que ela gerou."""

    inspecao: Inspecao
    ocorrencia: Ocorrencia
    tarefa: Tarefa | None = None


def _condicao_observada(inspecao: Inspecao) -> str:
    """O que a inspeção observou, em texto: condição aparente e sinais (não é diagnóstico)."""
    condicao = CondicaoAparente(inspecao.condicao_aparente).label.lower()
    partes = [f"Inspeção {inspecao.codigo}: condição aparente {condicao}."]
    if inspecao.sinais:
        sinais = ", ".join(SinalObservado(s).label.lower() for s in inspecao.sinais)
        partes.append(f"Sinais observados: {sinais}.")
    return " ".join(partes)


@transaction.atomic
def validar_e_encaminhar(
    inspecao: Inspecao,
    revisor,
    *,
    aplicar: list[str],
    tipo: TipoOcorrencia,
    motivo: str = "",
    descricao: str = "",
    prazo: date | None = None,
    criar_tarefa: bool = False,
    responsavel=None,
    equipe=None,
) -> Encaminhamento:
    """Valida a inspeção e abre, na mesma operação, a ocorrência de origem nela (G-01).

    A ocorrência nasce vinculada à inspeção e à árvore, sem prioridade nem risco
    (que são decisões da gestão e de avaliação técnica). Com ``criar_tarefa``, já
    nasce uma tarefa de atendimento ligada à ocorrência. Qualquer falha desfaz tudo:
    não existe inspeção validada pela metade.
    """
    arvore = inspecao.arvore
    texto = descricao.strip() or inspecao.observacoes.strip()
    if not texto:
        raise ErroInspecao("Descreva o que deve ser atendido (a inspeção não tem observações).")
    inspecao = validar(inspecao, revisor, aplicar, motivo)
    arvore.refresh_from_db()
    if arvore.geom is None:
        raise ErroInspecao("A árvore não tem localização para abrir a ocorrência.")
    if prazo is None and tipo.prazo_padrao_dias:
        prazo = timezone.localdate() + timedelta(days=tipo.prazo_padrao_dias)

    with pghistory.context(
        evento="encaminhamento_inspecao", inspecao=inspecao.codigo, motivo=motivo or None
    ):
        ocorrencia = Ocorrencia.objects.create(
            tipo=tipo,
            arvore=arvore,
            geom=arvore.geom,
            endereco=arvore.endereco,
            descricao=texto,
            condicao_aparente=_condicao_observada(inspecao),
            prazo=prazo,
            origem=OrigemOcorrencia.INSPECAO,
            origem_referencia=inspecao.codigo,
            inspecao=inspecao,
            registrada_por=revisor,
        )
        tarefa = None
        if criar_tarefa:
            if responsavel is not None and not ponto_no_escopo(responsavel, ocorrencia.geom):
                raise ErroInspecao(
                    "O local da tarefa está fora do escopo territorial do responsável."
                )
            tarefa = Tarefa.objects.create(
                tipo=TipoTarefa.ATENDIMENTO_OCORRENCIA,
                ocorrencia=ocorrencia,
                geom=ocorrencia.geom,
                descricao=f"Atender {ocorrencia.codigo}, aberta a partir de {inspecao.codigo}.",
                responsavel=responsavel,
                equipe=equipe,
                prazo=prazo,
                criada_por=revisor,
            )
            notificacoes.tarefa_atribuida(tarefa, autor=revisor)
    return Encaminhamento(inspecao, ocorrencia, tarefa)
