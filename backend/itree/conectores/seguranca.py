"""Busca segura de fontes externas.

O servidor busca endereços que **alguém cadastrou**, então a busca é tratada como SSRF em
potencial. Regras (todas com teste):

- só HTTPS, sem credenciais no endereço, na porta 443;
- o host precisa estar em ``ITREE_CONECTORES_HOSTS_PERMITIDOS`` (também em cada redirecionamento);
- o DNS é resolvido antes e depois de conectar: IP privado, loopback, link-local, reservado,
  multicast ou não especificado é recusado;
- redirecionamentos são seguidos à mão (no máximo 3), cada um revalidado;
- tempo limite e limite de bytes lidos por streaming.

O conteúdo baixado é dado não confiável: aqui ele só vira bytes.
"""

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import requests
from django.conf import settings

MAX_REDIRECIONAMENTOS = 3
USER_AGENT = "iTree-Conectores/1.0 (plataforma de arborização urbana)"


class ErroConector(Exception):
    """Falha esperada de um conector, com mensagem que cabe na tela."""


def hosts_permitidos() -> set[str]:
    return {h.strip().lower() for h in settings.ITREE_CONECTORES_HOSTS_PERMITIDOS if h.strip()}


def _ip_publico(ip: str) -> bool:
    try:
        endereco = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return False
    if getattr(endereco, "ipv4_mapped", None):
        endereco = endereco.ipv4_mapped
    return endereco.is_global and not endereco.is_multicast


def _resolver(host: str) -> list[str]:
    try:
        return sorted({i[4][0] for i in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
    except OSError as exc:
        raise ErroConector(f"Não foi possível resolver o endereço de {host}.") from exc


def validar_url(url: str) -> str:
    """Confere esquema, host e IPs resolvidos; devolve o host. Levanta ``ErroConector``."""
    partes = urlsplit(url)
    if partes.scheme.lower() != "https":
        raise ErroConector("Só endereços HTTPS são aceitos.")
    if partes.username or partes.password:
        raise ErroConector("O endereço não pode conter usuário ou senha.")
    host = (partes.hostname or "").lower()
    if not host:
        raise ErroConector("Endereço inválido.")
    if host not in hosts_permitidos():
        raise ErroConector(
            f"O host {host} não está na lista de fontes permitidas. "
            "Peça à administração do servidor para incluí-lo."
        )
    try:
        porta = partes.port
    except ValueError as exc:
        raise ErroConector("Endereço inválido.") from exc
    if porta not in (None, 443):
        raise ErroConector("Só a porta 443 é aceita.")
    if _por_proxy(url):
        # Com proxy de saída (ambientes com egress controlado), quem resolve o nome e conecta é
        # o proxy: a verificação local de IP não tem o que conferir. A lista de hosts e o HTTPS
        # continuam valendo, e a política de rede é a do proxy.
        return host
    enderecos = _resolver(host)
    if not enderecos or not all(_ip_publico(ip) for ip in enderecos):
        raise ErroConector(f"O host {host} resolve para um endereço não público.")
    return host


def _por_proxy(url: str) -> bool:
    return requests.utils.select_proxy(url, requests.utils.get_environ_proxies(url)) is not None


def _conferir_conexao(resposta: requests.Response) -> None:
    """Depois de conectar, o IP real do par também precisa ser público (DNS rebinding)."""
    if _por_proxy(resposta.url):
        return
    try:
        soquete = resposta.raw._connection.sock  # noqa: SLF001
        ip = soquete.getpeername()[0]
    except (AttributeError, OSError):
        return  # transporte simulado ou já fechado: a verificação anterior vale
    if not _ip_publico(ip):
        resposta.close()
        raise ErroConector("A conexão foi feita com um endereço não público.")


def _mensagem_limite(limite: int) -> str:
    return f"A resposta da fonte passa do limite de {limite // (1024 * 1024)} MB."


def buscar(url: str, params: dict | None = None, limite_bytes: int | None = None) -> bytes:
    """GET seguro com limite de bytes. Devolve o corpo ou levanta ``ErroConector``."""
    limite = limite_bytes or settings.ITREE_CONECTORES_MAX_BYTES
    timeout = settings.ITREE_CONECTORES_TIMEOUT
    atual, parametros = url, params
    for _ in range(MAX_REDIRECIONAMENTOS + 1):
        validar_url(atual)
        try:
            resposta = requests.get(
                atual,
                params=parametros,
                timeout=timeout,
                stream=True,
                allow_redirects=False,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*;q=0.5"},
            )
        except requests.RequestException as exc:
            raise ErroConector(f"Não foi possível acessar a fonte: {type(exc).__name__}.") from exc
        with resposta:
            _conferir_conexao(resposta)
            if resposta.status_code in (301, 302, 303, 307, 308):
                destino = resposta.headers.get("Location")
                if not destino:
                    raise ErroConector("A fonte redirecionou sem informar o destino.")
                atual, parametros = urljoin(atual, destino), None
                continue
            if resposta.status_code != 200:
                raise ErroConector(f"A fonte respondeu com o código {resposta.status_code}.")
            anunciado = resposta.headers.get("Content-Length", "")
            if anunciado.isdigit() and int(anunciado) > limite:
                raise ErroConector(_mensagem_limite(limite))
            partes, lidos = [], 0
            try:
                for pedaco in resposta.iter_content(chunk_size=64 * 1024):
                    lidos += len(pedaco)
                    if lidos > limite:
                        raise ErroConector(_mensagem_limite(limite))
                    partes.append(pedaco)
            except requests.RequestException as exc:
                raise ErroConector(
                    f"A conexão com a fonte caiu durante a leitura: {type(exc).__name__}."
                ) from exc
            return b"".join(partes)
    raise ErroConector("A fonte redirecionou mais vezes do que o permitido.")
