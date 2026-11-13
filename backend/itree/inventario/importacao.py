"""Importação em lote de inventário (RF-INV-010 a 012).

Fluxo: o arquivo é interpretado e validado numa **pré-visualização** guardada no
lote; nada é criado até a confirmação. A confirmação cria as árvores com
origem ``importado`` em todos os valores, na requisição (lote pequeno) ou em tarefa Celery
(lote grande), e pode ser desfeita como lote enquanto nenhum registro tiver sido alterado depois.
"""

import logging
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

import pghistory
from django.apps import apps
from django.conf import settings
from django.contrib.gis.geos import MultiPolygon, Point
from django.db import transaction
from django.db.models import ProtectedError
from django.utils import timezone

from itree.contas.acesso import area_do_escopo, filtrar_por_escopo
from itree.core.geo import ResolvedorDeBairro
from itree.territorio.models import Territorio

from . import duplicidades
from .leitura_arquivos import LIMITE_LINHAS, ErroArquivo, ler_registros
from .models import (
    UNIDADES_POR_TIPO,
    Arvore,
    Especie,
    EstadoEspecie,
    EstadoLote,
    IdentificadorExterno,
    LoteImportacao,
    Medida,
    MetodoMedida,
    ModoImportacao,
    OrigemLocalizacao,
    OrigemRegistro,
    OrigemValor,
    SituacaoArvore,
    TipoMedida,
)

__all__ = ["LIMITE_LINHAS", "ErroArquivo", "ler_registros"]

logger = logging.getLogger(__name__)

# Linhas por transação na confirmação: o andamento é gravado a cada bloco.
TAMANHO_BLOCO = 200
# Linhas com falha cujo motivo é guardado no lote; as demais só entram na contagem.
LIMITE_FALHAS_GUARDADAS = 500
MOTIVO_FALHA = "Erro inesperado ao criar a árvore desta linha; as demais seguiram."
MSG_JA_IMPORTADO = "Identificador já importado anteriormente; a linha será ignorada."

CAMPOS_MAPEAVEIS = {
    "latitude": "Latitude (ou Y)",
    "longitude": "Longitude (ou X)",
    "id_externo": "Identificador na fonte",
    "especie": "Espécie (nome científico ou popular)",
    "endereco": "Endereço",
    "altura": "Altura (m)",
    "dap": "DAP (cm)",
    "precisao": "Precisão da localização (m)",
}


class FalhaLinha(Exception):
    """Falha esperada de uma linha, com motivo próprio para o relatório do lote."""


@dataclass
class Linha:
    indice: int
    dados: dict = field(default_factory=dict)
    erros: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    # Identificador já existente na fonte: árvore e o que mudaria se o modo for "atualizar".
    existente: dict | None = None
    # Árvore ativa já cadastrada a poucos metros (só para linhas novas).
    duplicata: dict | None = None
    # Nome popular que serve a mais de uma espécie do catálogo.
    especie_ambigua: list[str] = field(default_factory=list)

    def como_dict(self) -> dict:
        resultado = {
            "indice": self.indice,
            "dados": self.dados,
            "erros": self.erros,
            "avisos": self.avisos,
        }
        if self.existente:
            resultado["existente"] = self.existente
        if self.duplicata:
            resultado["duplicata"] = self.duplicata
        if self.especie_ambigua:
            resultado["especie_ambigua"] = self.especie_ambigua
        return resultado


def _numero(valor) -> Decimal | None:
    if valor is None or str(valor).strip() == "":
        return None
    texto = str(valor).strip().replace(" ", "")
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".")
    else:
        texto = texto.replace(",", ".")
    numero = Decimal(texto)
    if not numero.is_finite():  # "Infinity", "NaN"...
        raise InvalidOperation(texto)
    return numero


def _normalizar(texto: str) -> str:
    """Sem acento, sem diferenciar maiúsculas e com espaços colapsados."""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    return " ".join(sem_acento.casefold().split())


class CatalogoEspecies:
    """Espécies ativas por nome científico e por nome popular (``Especie.nomes_comuns``)."""

    def __init__(self):
        self.por_cientifico: dict[str, Especie] = {}
        self.por_popular: dict[str, dict] = defaultdict(dict)
        self.nome_por_id: dict[str, str] = {}
        for especie in Especie.objects.filter(ativa=True):
            self.nome_por_id[str(especie.id)] = especie.nome_cientifico
            self.por_cientifico[_normalizar(especie.nome_cientifico)] = especie
            for nome in especie.nomes_comuns:
                self.por_popular[_normalizar(nome)][especie.id] = especie

    def resolver(self, texto: str) -> tuple[Especie | None, str, list[Especie]]:
        """(espécie, via, candidatas): via é "cientifico", "nome_popular" ou "". Com mais de uma
        espécie para o nome popular, a espécie é ``None`` e ``candidatas`` as lista."""
        chave = _normalizar(texto)
        if especie := self.por_cientifico.get(chave):
            return especie, "cientifico", []
        candidatas = list(self.por_popular.get(chave, {}).values())
        if len(candidatas) == 1:
            return candidatas[0], "nome_popular", []
        return None, "", candidatas


ROTULOS_DIFERENCA = {
    "endereco": "Endereço",
    "especie": "Espécie",
    "localizacao": "Localização",
    "altura": "Altura (m)",
    "dap": "DAP (cm)",
}
MEDIDAS_DA_FONTE = ((TipoMedida.ALTURA, "altura"), (TipoMedida.DAP, "dap"))
ESTADOS_ESPECIE_ATUALIZAVEIS = (EstadoEspecie.INFORMADA, EstadoEspecie.NAO_IDENTIFICADA)


def _texto(valor) -> str:
    return str(valor).replace(".", ",")


def _ultimas_medidas(arvore_ids, fonte: str) -> dict[tuple, Decimal]:
    """Último valor de altura e DAP que **esta fonte** já gravou em cada árvore."""
    medidas = Medida.objects.filter(
        arvore_id__in=list(arvore_ids),
        origem=OrigemValor.IMPORTADO,
        responsavel_texto=fonte,
        tipo__in=[tipo for tipo, _ in MEDIDAS_DA_FONTE],
    ).order_by("criado_em")
    return {(m.arvore_id, m.tipo): m.valor for m in medidas}


def calcular_diferencas(
    arvore: Arvore, d: dict, catalogo: CatalogoEspecies, ultimas_medidas: dict
) -> tuple[list[dict], list[str]]:
    """O que a linha ``d`` mudaria na árvore existente: ``[{campo, rotulo, antigo, novo}]``.

    Regras (nada além disto é alterado):
    - endereço: só se a fonte traz um endereço diferente;
    - espécie: só enquanto a árvore não tem espécie confirmada ou sugerida por IA; um nome que
      não casou com o catálogo só preenche árvore sem espécie;
    - localização: só se a origem atual é "importada";
    - altura e DAP: viram **novas medidas** da fonte quando diferem da última que ela gravou.
    Devolve também avisos sobre o que foi mantido de propósito.
    """
    diferencas: list[dict] = []
    avisos: list[str] = []

    def somar(campo, antigo, novo):
        diferencas.append(
            {"campo": campo, "rotulo": ROTULOS_DIFERENCA[campo], "antigo": antigo, "novo": novo}
        )

    novo_endereco = d.get("endereco", "")
    if novo_endereco and novo_endereco != arvore.endereco:
        somar("endereco", arvore.endereco, novo_endereco)

    novo_id, novo_texto = d.get("especie_id"), d.get("especie_texto", "")
    if novo_id or novo_texto:
        if arvore.especie_estado not in ESTADOS_ESPECIE_ATUALIZAVEIS:
            avisos.append("Espécie mantida: a árvore tem espécie confirmada ou sugerida.")
        elif novo_id:
            if str(arvore.especie_id) != novo_id:
                antigo = (
                    arvore.especie.nome_cientifico
                    if arvore.especie_id
                    else arvore.especie_texto_original
                )
                somar("especie", antigo, catalogo.nome_por_id.get(novo_id, novo_id))
        elif not arvore.especie_id and novo_texto != arvore.especie_texto_original:
            somar("especie", arvore.especie_texto_original, novo_texto)

    if "longitude" in d and arvore.geom is not None:
        mudou = (round(arvore.geom.x, 7), round(arvore.geom.y, 7)) != (
            round(d["longitude"], 7),
            round(d["latitude"], 7),
        )
        if mudou and arvore.localizacao_origem == OrigemLocalizacao.IMPORTADA:
            somar(
                "localizacao",
                f"{_texto(round(arvore.geom.y, 6))}, {_texto(round(arvore.geom.x, 6))}",
                f"{_texto(round(d['latitude'], 6))}, {_texto(round(d['longitude'], 6))}",
            )
        elif mudou:
            avisos.append("Localização mantida: a origem atual não é importada.")

    for tipo, chave in MEDIDAS_DA_FONTE:
        if not d.get(chave):
            continue
        novo = Decimal(d[chave]).quantize(Decimal("0.01"))
        antigo = ultimas_medidas.get((arvore.id, tipo))
        if antigo is None or antigo != novo:
            somar(chave, "" if antigo is None else _texto(antigo), _texto(novo))
    return diferencas, avisos


def _motivo_nao_atualizavel(arvore: Arvore, escopo_preparado) -> str | None:
    if arvore.situacao != SituacaoArvore.ATIVA:
        return f"A árvore com este identificador não está ativa ({arvore.get_situacao_display()})."
    if escopo_preparado is not None and (
        arvore.geom is None or not escopo_preparado.intersects(arvore.geom)
    ):
        return "A árvore com este identificador está fora do seu escopo territorial."
    return None


def interpretar(
    registros: list[dict],
    mapeamento: dict,
    srid: int,
    fonte_ids: str,
    escopo: MultiPolygon | None = None,
    raio_duplicatas_m: float | None = None,
) -> list[Linha]:
    """Valida cada linha. Com ``escopo``, pontos fora dele são recusados.

    Identificador que já existe na fonte não é erro de criação nem sobrescrita: a linha guarda
    a árvore e as diferenças (``existente``), e o modo escolhido na confirmação decide se vale.
    """
    if len(registros) > LIMITE_LINHAS:
        raise ErroArquivo(f"O arquivo tem {len(registros)} linhas; o limite é {LIMITE_LINHAS}.")

    catalogo = CatalogoEspecies()
    escopo_preparado = escopo.prepared if escopo is not None else None
    area_municipio = (
        Territorio.objects.filter(tipo="municipio").values_list("geom", flat=True).first()
    )
    ids_no_arquivo: dict[str, int] = {}

    def campo(registro: dict, nome: str):
        coluna = mapeamento.get(nome)
        return registro.get(coluna) if coluna else None

    ids_do_arquivo = {
        str(valor).strip()
        for registro in registros
        if (valor := campo(registro, "id_externo")) is not None and str(valor).strip()
    }
    existentes = {
        i.valor: i
        for i in IdentificadorExterno.objects.filter(
            fonte=fonte_ids, valor__in=ids_do_arquivo
        ).select_related("arvore", "arvore__especie")
    }
    ultimas = _ultimas_medidas({i.arvore_id for i in existentes.values()}, fonte_ids)

    linhas = []
    for indice, registro in enumerate(registros, start=1):
        linha = Linha(indice=indice)
        dados = linha.dados

        # Localização
        if registro.get("__erro_geometria"):
            x = y = None
            linha.erros.append(registro["__erro_geometria"])
        else:
            lon = registro.get("__lon") if "__lon" in registro else campo(registro, "longitude")
            lat = registro.get("__lat") if "__lat" in registro else campo(registro, "latitude")
            try:
                x, y = _numero(lon), _numero(lat)
            except InvalidOperation:
                x = y = None
                linha.erros.append("Coordenadas não numéricas.")
        if x is None or y is None:
            if not linha.erros:
                linha.erros.append("Sem coordenadas.")
        else:
            srid_linha = registro.get("__srid", srid)
            ponto = Point(float(x), float(y), srid=srid_linha)
            if srid_linha != 4326:
                ponto.transform(4326)
            if not (-180 <= ponto.x <= 180 and -90 <= ponto.y <= 90):
                linha.erros.append("Coordenadas fora do intervalo válido; verifique o SRC.")
            else:
                dados["longitude"], dados["latitude"] = round(ponto.x, 7), round(ponto.y, 7)
                if escopo_preparado is not None and not escopo_preparado.intersects(ponto):
                    linha.erros.append("Fora do seu escopo territorial.")
                if area_municipio is not None and not area_municipio.contains(ponto):
                    linha.avisos.append("Fora dos limites do município cadastrado.")

        # Identificador externo
        id_externo = str(campo(registro, "id_externo") or "").strip()
        if id_externo:
            dados["id_externo"] = id_externo
            if id_externo in ids_no_arquivo:
                linha.erros.append(
                    f"Identificador repetido no arquivo (linha {ids_no_arquivo[id_externo]})."
                )
            else:
                ids_no_arquivo[id_externo] = indice
            if id_externo in existentes:
                linha.erros.append(MSG_JA_IMPORTADO)

        # Espécie: nome científico e, na falta dele, nome popular do catálogo
        especie_texto = str(campo(registro, "especie") or "").strip()
        if especie_texto:
            dados["especie_texto"] = especie_texto
            especie, via, candidatas = catalogo.resolver(especie_texto)
            if especie:
                dados["especie_id"] = str(especie.id)
                if via == "nome_popular":
                    dados["especie_via"] = "nome_popular"
                    linha.avisos.append(
                        f"'{especie_texto}' é nome popular de {especie.nome_cientifico}; "
                        "a espécie entra como informada, sem validação."
                    )
            elif candidatas:
                linha.especie_ambigua = sorted(e.nome_cientifico for e in candidatas)
                linha.avisos.append(
                    f"Nome popular '{especie_texto}' é ambíguo ("
                    f"{', '.join(linha.especie_ambigua)}); a árvore fica sem espécie."
                )
            else:
                linha.avisos.append(f"Espécie '{especie_texto}' não encontrada no catálogo.")

        # Medidas e demais campos
        for nome in ("altura", "dap", "precisao"):
            bruto = campo(registro, nome)
            try:
                valor = _numero(bruto)
            except InvalidOperation:
                linha.erros.append(
                    f"Valor de {CAMPOS_MAPEAVEIS[nome].lower()} inválido: '{bruto}'."
                )
                continue
            if valor is not None:
                if valor <= 0:
                    linha.erros.append(f"{CAMPOS_MAPEAVEIS[nome]} deve ser positivo.")
                else:
                    dados[nome] = str(valor)
        endereco = str(campo(registro, "endereco") or "").strip()
        if endereco:
            dados["endereco"] = endereco[:300]

        # Árvore que já existe na fonte: o que mudaria, se o modo for "atualizar"
        if id_externo in existentes and linha.erros == [MSG_JA_IMPORTADO]:
            arvore = existentes[id_externo].arvore
            if motivo := _motivo_nao_atualizavel(arvore, escopo_preparado):
                linha.erros.append(motivo)
            else:
                diferencas, avisos = calcular_diferencas(arvore, dados, catalogo, ultimas)
                linha.existente = {
                    "arvore_id": str(arvore.id),
                    "codigo": arvore.codigo,
                    "diferencas": diferencas,
                }
                linha.avisos.extend(avisos)
        linhas.append(linha)

    _apontar_duplicatas(linhas, escopo, raio_duplicatas_m)
    return linhas


def _apontar_duplicatas(
    linhas: list[Linha], escopo: MultiPolygon | None, raio_m: float | None
) -> None:
    """Linhas novas e válidas a menos de ``raio_m`` de uma árvore ativa cadastrada. A árvore
    vizinha nunca tem o identificador da linha (a linha é nova), e só entram árvores do escopo."""
    raio = settings.IMPORTACAO_RAIO_DUPLICATAS_M if raio_m is None else raio_m
    pontos = [
        (linha.indice, linha.dados["longitude"], linha.dados["latitude"])
        for linha in linhas
        if not linha.erros and linha.existente is None
    ]
    arvores = Arvore.objects.filter(geom__intersects=escopo) if escopo is not None else None
    vizinhas = duplicidades.vizinhas_de_pontos(pontos, raio, arvores)
    if not vizinhas:
        return
    for linha in linhas:
        achada = vizinhas.get(linha.indice)
        if not achada:
            continue
        codigo = f"ARV-{achada['numero']:06d}"
        linha.duplicata = {
            "arvore_id": str(achada["id"]),
            "codigo": codigo,
            "distancia_m": achada["distancia_m"],
        }
        linha.avisos.append(
            f"A {_texto(achada['distancia_m'])} m da árvore {codigo}: possível duplicata."
        )


def resumir(linhas: list[Linha]) -> dict:
    """Contagens da pré-visualização, guardadas no lote."""
    resumo = {"a_criar": 0, "a_atualizar": 0, "sem_mudanca": 0, "duplicatas": 0, "ambiguas": 0}
    for linha in linhas:
        if linha.existente is not None:
            resumo["a_atualizar" if linha.existente["diferencas"] else "sem_mudanca"] += 1
        elif not linha.erros:
            resumo["a_criar"] += 1
            resumo["duplicatas"] += 1 if linha.duplicata else 0
        resumo["ambiguas"] += 1 if linha.especie_ambigua else 0
    return resumo


CRIAR, ATUALIZAR, IGNORAR, INVALIDA = "criar", "atualizar", "ignorar", "invalida"


def classificar(linha: dict, modo: str, ignorar_duplicatas: bool) -> str:
    """O que a confirmação faz com uma linha da pré-visualização."""
    erros = linha["erros"]
    existente = linha.get("existente")
    if existente is not None:
        if erros != [MSG_JA_IMPORTADO]:
            return INVALIDA
        return (
            ATUALIZAR if modo == ModoImportacao.ATUALIZAR and existente["diferencas"] else IGNORAR
        )
    if erros:
        return INVALIDA
    if ignorar_duplicatas and linha.get("duplicata"):
        return IGNORAR
    return CRIAR


def _validar_confirmacao(lote: LoteImportacao, usuario) -> None:
    """Confere o que pode ter mudado desde a pré-visualização, só nas linhas ainda pendentes."""
    fonte_ids = lote.mapeamento.get("fonte_ids") or lote.fonte
    pendentes = lote.linhas[lote.linhas_processadas :]
    classes = [
        (linha, classificar(linha, lote.modo, lote.ignorar_duplicatas)) for linha in pendentes
    ]
    a_criar = [linha["dados"] for linha, classe in classes if classe == CRIAR]
    a_atualizar = [linha for linha, classe in classes if classe == ATUALIZAR]

    # O escopo do usuário e o cadastro podem ter mudado desde a pré-visualização.
    escopo = area_do_escopo(usuario)
    if escopo is None:
        raise ErroArquivo("Você não tem escopo territorial para importar árvores.")
    preparado = escopo.prepared
    if any(
        not preparado.intersects(Point(d["longitude"], d["latitude"], srid=4326))
        for d in [*a_criar, *(linha["dados"] for linha in a_atualizar)]
    ):
        raise ErroArquivo(
            "Há linhas fora do seu escopo territorial atual; refaça a pré-visualização."
        )
    ids_do_lote = [d["id_externo"] for d in a_criar if d.get("id_externo")]
    if IdentificadorExterno.objects.filter(fonte=fonte_ids, valor__in=ids_do_lote).exists():
        raise ErroArquivo(
            "Há identificadores deste lote importados depois da pré-visualização; refaça-a."
        )
    ids_a_atualizar = {linha["existente"]["arvore_id"] for linha in a_atualizar}
    visiveis = filtrar_por_escopo(Arvore.objects.filter(pk__in=ids_a_atualizar), usuario).count()
    if visiveis != len(ids_a_atualizar):
        raise ErroArquivo(
            "Há árvores a atualizar fora do seu escopo territorial atual; "
            "refaça a pré-visualização."
        )


def preparar_confirmacao(
    lote: LoteImportacao,
    usuario,
    modo: str | None = None,
    ignorar_duplicatas: bool | None = None,
) -> bool:
    """Valida o pedido e marca o lote "em processamento"; não cria nenhuma árvore.

    Só um pedido passa por aqui por vez (trava da linha do lote): o segundo encontra o lote já
    em processamento e é recusado, então a mesma importação nunca é confirmada duas vezes.
    Aceita também um lote interrompido, que retoma do ponto em que parou e **mantém** o modo e
    a opção de duplicatas escolhidos na primeira confirmação.

    Devolve ``True`` se o lote é grande (acima de ``IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA``
    linhas a criar ou atualizar ainda pendentes) e deve ir para a fila; ``False`` se cabe na
    própria requisição.
    """
    with transaction.atomic():
        lote = LoteImportacao.objects.select_for_update().get(pk=lote.pk)
        if lote.estado not in (EstadoLote.PRE_VISUALIZADO, EstadoLote.INTERROMPIDO):
            raise ErroArquivo("Este lote não está aguardando confirmação.")
        if lote.estado == EstadoLote.PRE_VISUALIZADO:
            lote.modo = modo or ModoImportacao.CRIAR
            lote.ignorar_duplicatas = bool(ignorar_duplicatas)
        _validar_confirmacao(lote, usuario)
        pendentes = sum(
            1
            for linha in lote.linhas[lote.linhas_processadas :]
            if classificar(linha, lote.modo, lote.ignorar_duplicatas) in (CRIAR, ATUALIZAR)
        )
        lote.estado = EstadoLote.EM_PROCESSAMENTO
        lote.confirmado_por = usuario
        lote.erro = ""
        lote.save(
            update_fields=[
                "estado",
                "confirmado_por",
                "erro",
                "modo",
                "ignorar_duplicatas",
                "atualizado_em",
            ]
        )
    return pendentes > settings.IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA


def _criar_medidas(lote: LoteImportacao, arvore: Arvore, d: dict, chaves=None) -> None:
    for tipo, chave in MEDIDAS_DA_FONTE:
        if d.get(chave) and (chaves is None or chave in chaves):
            Medida.objects.create(
                arvore=arvore,
                tipo=tipo,
                valor=Decimal(d[chave]),
                unidade=UNIDADES_POR_TIPO[tipo],
                metodo=MetodoMedida.DESCONHECIDO,
                origem=OrigemValor.IMPORTADO,
                data_medicao=lote.data_referencia,
                responsavel_texto=lote.fonte,
            )


def _criar_arvore(lote: LoteImportacao, d: dict, usuario, fonte_ids: str, bairros) -> None:
    ponto = Point(d["longitude"], d["latitude"], srid=4326)
    arvore = Arvore(
        geom=ponto,
        localizacao_origem=OrigemLocalizacao.IMPORTADA,
        precisao_m=float(d["precisao"]) if d.get("precisao") else None,
        endereco=d.get("endereco", ""),
        especie_id=d.get("especie_id"),
        especie_estado=(
            EstadoEspecie.INFORMADA if d.get("especie_texto") else EstadoEspecie.NAO_IDENTIFICADA
        ),
        especie_texto_original=d.get("especie_texto", ""),
        origem_registro=OrigemRegistro.IMPORTACAO,
        lote=lote,
        criado_por=usuario,
    )
    arvore.bairro_id = bairros.id_do_ponto(ponto)
    arvore._bairro_pronto = True
    arvore.save()
    if d.get("id_externo"):
        IdentificadorExterno.objects.create(arvore=arvore, fonte=fonte_ids, valor=d["id_externo"])
    _criar_medidas(lote, arvore, d)


def _atualizar_arvore(
    lote: LoteImportacao, linha: dict, fonte_ids: str, bairros, catalogo: CatalogoEspecies
) -> None:
    """Aplica à árvore existente **só** o que a pré-visualização mostrou. Se a árvore mudou
    desde então, a linha falha com motivo claro e nada é gravado nela."""
    d, previsto = linha["dados"], linha["existente"]
    ident = IdentificadorExterno.objects.filter(fonte=fonte_ids, valor=d["id_externo"]).first()
    if ident is None or str(ident.arvore_id) != previsto["arvore_id"]:
        raise FalhaLinha("O identificador deixou de apontar para a mesma árvore; refaça a prévia.")
    arvore = (
        Arvore.objects.select_for_update(of=("self",))
        .select_related("especie")
        .get(pk=ident.arvore_id)
    )
    if arvore.situacao != SituacaoArvore.ATIVA:
        raise FalhaLinha("A árvore deixou de estar ativa depois da pré-visualização.")
    diferencas, _ = calcular_diferencas(
        arvore, d, catalogo, _ultimas_medidas([arvore.id], fonte_ids)
    )
    if diferencas != previsto["diferencas"]:
        raise FalhaLinha("A árvore mudou depois da pré-visualização; nada foi alterado nela.")
    campos = {item["campo"] for item in diferencas}
    if "endereco" in campos:
        arvore.endereco = d["endereco"]
    if "especie" in campos:
        if d.get("especie_id"):
            arvore.especie_id = d["especie_id"]
        arvore.especie_estado = EstadoEspecie.INFORMADA
        arvore.especie_texto_original = d.get("especie_texto", "")
    if "localizacao" in campos:
        ponto = Point(d["longitude"], d["latitude"], srid=4326)
        arvore.geom = ponto
        arvore.bairro_id = bairros.id_do_ponto(ponto)
        if d.get("precisao"):
            arvore.precisao_m = float(d["precisao"])
    if campos & {"endereco", "especie", "localizacao"}:
        arvore._bairro_pronto = True
        arvore.save()
    _criar_medidas(lote, arvore, d, chaves=campos)


def executar_confirmacao(lote_id) -> None:
    """Cria (e, no modo "atualizar", atualiza) as árvores do lote em blocos; serve à requisição
    (lote pequeno) e à tarefa Celery.

    Cada bloco é uma transação que grava as árvores **e** avança ``linhas_processadas``: ou o
    bloco inteiro vale, com o ponto de retomada, ou nada dele vale. Uma reentrega da tarefa, ou
    duas execuções ao mesmo tempo, travam a linha do lote a cada bloco e seguem do ponto
    gravado, então nenhuma linha é aplicada duas vezes (a unicidade do identificador externo é
    a segunda barreira). Cada linha roda em um ponto de salvamento: uma que falha entra em
    ``falhas`` e as demais seguem. Um erro fora das linhas deixa o lote "interrompido", e
    confirmar de novo retoma de onde parou.
    """
    lote = LoteImportacao.objects.select_related("confirmado_por").get(pk=lote_id)
    if lote.estado != EstadoLote.EM_PROCESSAMENTO:
        return
    usuario = lote.confirmado_por
    linhas = lote.linhas  # lido uma vez; o JSON é grande e não muda durante a confirmação
    fonte_ids = lote.mapeamento.get("fonte_ids") or lote.fonte
    contexto = {
        "user": str(usuario.pk),
        "origem": "web",
        "evento": "importacao_inventario",
        "modo": lote.modo,
    }
    try:
        bairros = ResolvedorDeBairro()
        catalogo = CatalogoEspecies()
        with pghistory.context(lote=lote.numero, **contexto):
            while True:
                with transaction.atomic():
                    atual = (
                        LoteImportacao.objects.select_for_update()
                        .defer("linhas")
                        .get(pk=lote_id)  # estado e ponto de retomada atuais
                    )
                    if atual.estado != EstadoLote.EM_PROCESSAMENTO:
                        return
                    inicio = atual.linhas_processadas
                    if inicio >= len(linhas):
                        atual.estado = EstadoLote.CONFIRMADO
                        atual.confirmado_em = timezone.now()
                        atual.save(update_fields=["estado", "confirmado_em", "atualizado_em"])
                        return
                    falhas = []
                    atualizadas = ignoradas = 0
                    bloco = linhas[inicio : inicio + TAMANHO_BLOCO]
                    for linha in bloco:
                        classe = classificar(linha, atual.modo, atual.ignorar_duplicatas)
                        if classe == IGNORAR:
                            ignoradas += 1
                        if classe not in (CRIAR, ATUALIZAR):
                            continue
                        try:
                            with transaction.atomic():
                                if classe == CRIAR:
                                    _criar_arvore(
                                        atual, linha["dados"], usuario, fonte_ids, bairros
                                    )
                                else:
                                    _atualizar_arvore(atual, linha, fonte_ids, bairros, catalogo)
                                    atualizadas += 1
                        except Exception as exc:
                            if isinstance(exc, FalhaLinha):
                                motivo = str(exc)
                            else:
                                logger.exception(
                                    "Falha na linha %s do lote %s", linha["indice"], atual.numero
                                )
                                motivo = MOTIVO_FALHA
                            falhas.append({"indice": linha["indice"], "motivo": motivo})
                    atual.linhas_processadas = inicio + len(bloco)
                    atual.linhas_com_falha += len(falhas)
                    atual.linhas_atualizadas += atualizadas
                    atual.linhas_ignoradas += ignoradas
                    espaco = max(LIMITE_FALHAS_GUARDADAS - len(atual.falhas), 0)
                    atual.falhas = [*atual.falhas, *falhas[:espaco]]
                    atual.save(
                        update_fields=[
                            "linhas_processadas",
                            "linhas_com_falha",
                            "linhas_atualizadas",
                            "linhas_ignoradas",
                            "falhas",
                            "atualizado_em",
                        ]
                    )
    except Exception:
        logger.exception("A confirmação do lote %s foi interrompida", lote_id)
        registrar_interrupcao(
            lote_id,
            "A confirmação foi interrompida por um erro inesperado. As árvores já criadas "
            "continuam no inventário; confirme de novo para continuar do ponto em que parou.",
        )


def registrar_interrupcao(lote_id, erro: str) -> None:
    LoteImportacao.objects.filter(pk=lote_id, estado=EstadoLote.EM_PROCESSAMENTO).update(
        estado=EstadoLote.INTERROMPIDO, erro=erro, atualizado_em=timezone.now()
    )


def motivo_impede_desfazer(lote: LoteImportacao) -> str | None:
    if lote.estado != EstadoLote.CONFIRMADO:
        return "Só lotes confirmados podem ser desfeitos."
    if lote.linhas_atualizadas:
        return (
            "O lote atualizou árvores já existentes, e essas alterações não são desfeitas em lote."
        )
    arvores = lote.arvores.all()
    # Qualquer alteração posterior à criação fica registrada na auditoria.
    eventos = apps.get_model("inventario", "ArvoreEvent").objects
    if eventos.filter(pgh_obj__lote=lote, pgh_label="update").exists():
        return "Há árvores deste lote alteradas depois da importação."
    if arvores.filter(ocorrencias__isnull=False).exists():
        return "Há ocorrências vinculadas a árvores deste lote."
    if arvores.filter(evidencias__isnull=False).exists():
        return "Há evidências vinculadas a árvores deste lote."
    if arvores.filter(inspecoes__isnull=False).exists():
        return "Há inspeções vinculadas a árvores deste lote."
    if arvores.filter(tarefas__isnull=False).exists():
        return "Há tarefas vinculadas a árvores deste lote."
    if arvores.filter(fundidas__isnull=False).exists():
        return "Há árvores fundidas em árvores deste lote."
    if Medida.objects.filter(
        arvore__lote=lote, origem__in=[OrigemValor.MEDIDO, OrigemValor.ESTIMADO]
    ).exists():
        return "Há medidas registradas depois da importação."
    return None


@transaction.atomic
def desfazer(lote: LoteImportacao) -> int:
    lote = LoteImportacao.objects.select_for_update().get(pk=lote.pk)
    if motivo := motivo_impede_desfazer(lote):
        raise ErroArquivo(motivo)
    arvores = Arvore.objects.filter(lote=lote)
    total = arvores.count()
    Medida.objects.filter(arvore__lote=lote).delete()
    IdentificadorExterno.objects.filter(arvore__lote=lote).delete()
    try:
        arvores.delete()
    except ProtectedError as exc:
        # Defesa para vínculos novos que motivo_impede_desfazer ainda não conheça.
        raise ErroArquivo("Há registros vinculados a árvores deste lote.") from exc
    lote.estado = EstadoLote.DESFEITO
    lote.desfeito_em = timezone.now()
    lote.save(update_fields=["estado", "desfeito_em", "atualizado_em"])
    return total
