"""Importação em lote de inventário (RF-INV-010 a 012).

Fluxo: o arquivo é interpretado e validado numa **pré-visualização** guardada no
lote; nada é criado até a confirmação. A confirmação cria as árvores com
origem ``importado`` em todos os valores e pode ser desfeita como lote enquanto
nenhum registro tiver sido alterado depois.
"""

import csv
import io
import json
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.apps import apps
from django.contrib.gis.geos import MultiPolygon, Point
from django.db import transaction
from django.db.models import ProtectedError
from django.utils import timezone

from itree.contas.acesso import area_do_escopo
from itree.territorio.models import Territorio

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
    OrigemLocalizacao,
    OrigemRegistro,
    OrigemValor,
    TipoMedida,
)

LIMITE_LINHAS = 20_000

CAMPOS_MAPEAVEIS = {
    "latitude": "Latitude (ou Y)",
    "longitude": "Longitude (ou X)",
    "id_externo": "Identificador na fonte",
    "especie": "Nome científico",
    "endereco": "Endereço",
    "altura": "Altura (m)",
    "dap": "DAP (cm)",
    "precisao": "Precisão da localização (m)",
}


class ErroArquivo(Exception):
    pass


@dataclass
class Linha:
    indice: int
    dados: dict = field(default_factory=dict)
    erros: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)

    def como_dict(self) -> dict:
        return {
            "indice": self.indice,
            "dados": self.dados,
            "erros": self.erros,
            "avisos": self.avisos,
        }


def _decodificar(conteudo: bytes) -> str:
    for codificacao in ("utf-8-sig", "latin-1"):
        try:
            return conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
    raise ErroArquivo("Não foi possível ler o arquivo como texto (UTF-8 ou Latin-1).")


def ler_registros(conteudo: bytes, formato: str) -> tuple[list[str], list[dict]]:
    """Devolve (colunas, registros). Em GeoJSON, a geometria vira ``__lon``/``__lat``."""
    texto = _decodificar(conteudo)
    if formato == "csv":
        try:
            dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=",;\t")
        except csv.Error:
            dialeto = csv.excel
        leitor = csv.DictReader(io.StringIO(texto), dialect=dialeto)
        registros = [dict(r) for r in leitor]
        return list(leitor.fieldnames or []), registros
    if formato == "geojson":
        try:
            dados = json.loads(texto)
        except json.JSONDecodeError as exc:
            raise ErroArquivo(f"GeoJSON inválido: {exc.msg} (linha {exc.lineno}).") from exc
        feicoes = dados.get("features") if isinstance(dados, dict) else None
        if not isinstance(feicoes, list):
            raise ErroArquivo("O GeoJSON precisa ser uma FeatureCollection.")
        registros, colunas = [], []
        for feicao in feicoes:
            props = dict(feicao.get("properties") or {})
            geom = feicao.get("geometry") or {}
            if geom.get("type") == "Point" and len(geom.get("coordinates") or []) >= 2:
                props["__lon"], props["__lat"] = geom["coordinates"][:2]
            for chave in props:
                if chave not in colunas and not chave.startswith("__"):
                    colunas.append(chave)
            registros.append(props)
        return colunas, registros
    raise ErroArquivo("Formato não suportado. Use CSV ou GeoJSON.")


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


def _especies_por_nome() -> dict[str, Especie]:
    return {e.nome_cientifico.lower(): e for e in Especie.objects.filter(ativa=True)}


def interpretar(
    registros: list[dict],
    mapeamento: dict,
    srid: int,
    fonte_ids: str,
    escopo: MultiPolygon | None = None,
) -> list[Linha]:
    """Valida cada linha. Com ``escopo``, pontos fora dele são recusados."""
    if len(registros) > LIMITE_LINHAS:
        raise ErroArquivo(f"O arquivo tem {len(registros)} linhas; o limite é {LIMITE_LINHAS}.")

    especies = _especies_por_nome()
    escopo_preparado = escopo.prepared if escopo is not None else None
    area_municipio = (
        Territorio.objects.filter(tipo="municipio").values_list("geom", flat=True).first()
    )
    ids_no_arquivo: dict[str, int] = {}
    ids_existentes = set(
        IdentificadorExterno.objects.filter(fonte=fonte_ids).values_list("valor", flat=True)
    )

    def campo(registro: dict, nome: str):
        coluna = mapeamento.get(nome)
        return registro.get(coluna) if coluna else None

    linhas = []
    for indice, registro in enumerate(registros, start=1):
        linha = Linha(indice=indice)
        dados = linha.dados

        # Localização
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
            ponto = Point(float(x), float(y), srid=srid)
            if srid != 4326:
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
            if id_externo in ids_existentes:
                linha.erros.append(
                    "Identificador já importado anteriormente; a linha será ignorada."
                )

        # Espécie
        especie_texto = str(campo(registro, "especie") or "").strip()
        if especie_texto:
            dados["especie_texto"] = especie_texto
            especie = especies.get(especie_texto.lower())
            if especie:
                dados["especie_id"] = str(especie.id)
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
        linhas.append(linha)
    return linhas


@transaction.atomic
def confirmar(lote: LoteImportacao, usuario) -> int:
    lote = LoteImportacao.objects.select_for_update().get(pk=lote.pk)
    if lote.estado != EstadoLote.PRE_VISUALIZADO:
        raise ErroArquivo("Este lote não está aguardando confirmação.")

    fonte_ids = lote.mapeamento.get("fonte_ids") or lote.fonte
    validas = [linha["dados"] for linha in lote.linhas if not linha["erros"]]

    # O escopo do usuário e o cadastro podem ter mudado desde a pré-visualização.
    escopo = area_do_escopo(usuario)
    if escopo is None:
        raise ErroArquivo("Você não tem escopo territorial para importar árvores.")
    preparado = escopo.prepared
    if any(
        not preparado.intersects(Point(d["longitude"], d["latitude"], srid=4326)) for d in validas
    ):
        raise ErroArquivo(
            "Há linhas fora do seu escopo territorial atual; refaça a pré-visualização."
        )
    ids_do_lote = [d["id_externo"] for d in validas if d.get("id_externo")]
    if IdentificadorExterno.objects.filter(fonte=fonte_ids, valor__in=ids_do_lote).exists():
        raise ErroArquivo(
            "Há identificadores deste lote importados depois da pré-visualização; refaça-a."
        )

    criadas = 0
    for linha in lote.linhas:
        if linha["erros"]:
            continue
        d = linha["dados"]
        arvore = Arvore.objects.create(
            geom=Point(d["longitude"], d["latitude"], srid=4326),
            localizacao_origem=OrigemLocalizacao.IMPORTADA,
            precisao_m=float(d["precisao"]) if d.get("precisao") else None,
            endereco=d.get("endereco", ""),
            especie_id=d.get("especie_id"),
            especie_estado=(
                EstadoEspecie.INFORMADA
                if d.get("especie_texto")
                else EstadoEspecie.NAO_IDENTIFICADA
            ),
            especie_texto_original=d.get("especie_texto", ""),
            origem_registro=OrigemRegistro.IMPORTACAO,
            lote=lote,
            criado_por=usuario,
        )
        if d.get("id_externo"):
            IdentificadorExterno.objects.create(
                arvore=arvore, fonte=fonte_ids, valor=d["id_externo"]
            )
        for tipo, chave in ((TipoMedida.ALTURA, "altura"), (TipoMedida.DAP, "dap")):
            if d.get(chave):
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
        criadas += 1

    lote.estado = EstadoLote.CONFIRMADO
    lote.confirmado_em = timezone.now()
    lote.save(update_fields=["estado", "confirmado_em", "atualizado_em"])
    return criadas


def motivo_impede_desfazer(lote: LoteImportacao) -> str | None:
    if lote.estado != EstadoLote.CONFIRMADO:
        return "Só lotes confirmados podem ser desfeitos."
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
