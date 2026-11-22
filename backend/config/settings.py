"""Configuração do backend. Todos os valores sensíveis ou de ambiente vêm de
variáveis de ambiente (ver ``.env.example``)."""

from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Ambiente: desenvolvimento | homologacao | demonstracao | producao (RNF-OPS-001).
# Em "demonstracao" a API sinaliza que os dados são fictícios (RN-PROV-008).
AMBIENTE = env.str("ITREE_AMBIENTE", default="desenvolvimento")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "pgtrigger",
    "pghistory",
    "itree.core",
    "itree.territorio",
    "itree.areas_verdes",
    "itree.iluminacao",
    "itree.imoveis",
    "itree.contas",
    "itree.auditoria",
    "itree.inventario",
    "itree.evidencias",
    "itree.ocorrencias",
    "itree.mapa",
    "itree.inspecoes",
    "itree.tarefas",
    "itree.indicadores",
    "itree.alertas",
    "itree.relatorios",
    "itree.qualidade",
    "itree.notificacoes",
    "itree.conectores",
    "itree.deteccao",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "itree.auditoria.middleware.AuditoriaMiddleware",
    "itree.contas.acesso.CacheEscopoMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": env.db_url("DATABASE_URL", default="postgis://itree:itree@localhost:5432/itree")
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "contas.Usuario"

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Fortaleza"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# --- Armazenamento de arquivos (S3-compatível; ADR-0001) --------------------
# Fotos e documentos ficam em um bucket privado. O navegador envia e baixa
# arquivos direto do armazenamento por URLs pré-assinadas de curta duração,
# geradas com o endereço público (S3_ENDPOINT_URL_PUBLICO), que pode diferir do
# endereço interno usado pelos contêineres.
S3_BUCKET = env.str("S3_BUCKET", default="")
S3_ENDPOINT_URL = env.str("S3_ENDPOINT_URL", default=None)
S3_ENDPOINT_URL_PUBLICO = env.str("S3_ENDPOINT_URL_PUBLICO", default=S3_ENDPOINT_URL)
S3_ACCESS_KEY_ID = env.str("S3_ACCESS_KEY_ID", default=None)
S3_SECRET_ACCESS_KEY = env.str("S3_SECRET_ACCESS_KEY", default=None)
S3_REGION = env.str("S3_REGION", default="us-east-1")

STORAGES = {
    "default": (
        {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {
                "bucket_name": S3_BUCKET,
                "endpoint_url": S3_ENDPOINT_URL,
                "access_key": S3_ACCESS_KEY_ID,
                "secret_key": S3_SECRET_ACCESS_KEY,
                "region_name": S3_REGION,
                "addressing_style": "path",
                "signature_version": "s3v4",
                "default_acl": None,
                "querystring_auth": True,
                "querystring_expire": 300,
                "file_overwrite": False,
            },
        }
        if S3_BUCKET
        else {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    ),
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}

# --- Segurança em produção ---------------------------------------------------
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
if not DEBUG:
    # A aplicação roda atrás de um proxy reverso que termina o TLS.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = env.bool("COOKIES_SEGUROS", default=True)
    CSRF_COOKIE_SECURE = env.bool("COOKIES_SEGUROS", default=True)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    # Ative quando todo o tráfego for HTTPS (o proxy de borda pode redirecionar).
    SECURE_SSL_REDIRECT = env.bool("SSL_REDIRECIONAR", default=False)
    SECURE_HSTS_SECONDS = env.int("HSTS_SEGUNDOS", default=0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0

# --- Autenticação OIDC (Keycloak; RF-ACL-001) -------------------------------
OIDC_ISSUER = env.str("OIDC_ISSUER", default="http://localhost:8080/realms/itree")
OIDC_JWKS_URL = env.str("OIDC_JWKS_URL", default=f"{OIDC_ISSUER}/protocol/openid-connect/certs")
OIDC_AUDIENCE = env.str("OIDC_AUDIENCE", default="itree-api")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["itree.contas.autenticacao.OIDCAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "itree.core.paginacao.Paginacao",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Engine de Inteligência Arbórea — API",
    "DESCRIPTION": "API do painel web e do aplicativo de campo.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1(/admin)?",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "PapelEnum": "itree.contas.permissoes.Papel",
        "CamadaSelecaoEnum": "itree.mapa.selecao.CamadaSelecao",
        "PermissaoEnum": "itree.contas.permissoes.Permissao",
        "TipoTerritorioEnum": "itree.territorio.models.TipoTerritorio",
        "TipoAreaVerdeEnum": "itree.areas_verdes.models.TipoAreaVerde",
        "EstadoEspecieEnum": "itree.inventario.models.EstadoEspecie",
        "OrigemLocalizacaoEnum": "itree.inventario.models.OrigemLocalizacao",
        "OrigemValorEnum": "itree.inventario.models.OrigemValor",
        "OrigemRegistroEnum": "itree.inventario.models.OrigemRegistro",
        "SituacaoArvoreEnum": "itree.inventario.models.SituacaoArvore",
        "TipoMedidaEnum": "itree.inventario.models.TipoMedida",
        "MetodoMedidaEnum": "itree.inventario.models.MetodoMedida",
        "EstadoLoteEnum": "itree.inventario.models.EstadoLote",
        "SituacaoLoteDeteccaoEnum": "itree.deteccao.models.SituacaoLote",
        "SituacaoSinalRemocaoEnum": "itree.deteccao.models.SituacaoSinal",
        "SensorDeteccaoEnum": "itree.deteccao.models.Sensor",
        "CanalLoteDeteccaoEnum": "itree.deteccao.models.CanalLote",
        "TipoPontoPlantioEnum": "itree.deteccao.models.TipoPontoPlantio",
        "TipoConectorEnum": "itree.conectores.models.TipoConector",
        "DestinoConectorEnum": "itree.conectores.models.DestinoConector",
        "PeriodicidadeEnum": "itree.conectores.models.Periodicidade",
        "OrigemExecucaoEnum": "itree.conectores.models.OrigemExecucao",
        "EstadoOcorrenciaEnum": "itree.ocorrencias.models.EstadoOcorrencia",
        "PrioridadeEnum": "itree.ocorrencias.models.Prioridade",
        "OrigemOcorrenciaEnum": "itree.ocorrencias.models.OrigemOcorrencia",
        "EstadoEvidenciaEnum": "itree.evidencias.models.EstadoEvidencia",
        "EstadoInspecaoEnum": "itree.inspecoes.models.EstadoInspecao",
        "CondicaoAparenteEnum": "itree.inspecoes.models.CondicaoAparente",
        "SinalObservadoEnum": "itree.inspecoes.models.SinalObservado",
        "OrigemInspecaoEnum": "itree.inspecoes.models.OrigemInspecao",
        "TipoTarefaEnum": "itree.tarefas.models.TipoTarefa",
        "FonteAlertaEnum": "itree.alertas.models.FonteAlerta",
        "TipoAlertaEnum": "itree.alertas.models.TipoAlerta",
        "StatusAlertaEnum": "itree.alertas.models.StatusAlerta",
        "TipoNotificacaoEnum": "itree.notificacoes.models.TipoNotificacao",
        "TarefaIaEnum": "itree.qualidade.models.TarefaIA",
        "DecisaoIaEnum": "itree.qualidade.models.DecisaoIA",
        "EstadoTarefaEnum": "itree.tarefas.models.EstadoTarefa",
    },
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "x-itree-origem",
)

# --- Auditoria (RN-PROV-002, RNF-SEG-004) -----------------------------------
PGHISTORY_APPEND_ONLY = True
PGHISTORY_MIDDLEWARE_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# --- Celery -----------------------------------------------------------------
CELERY_BROKER_URL = env.str("REDIS_URL", default="redis://localhost:6379/0")
CELERY_TIMEZONE = TIME_ZONE

# --- Alertas ambientais (W-08, T-05) ------------------------------------------
# JSON {"inpe_focos": "<url>", "inpe_deter": "<url de WFS em GeoJSON>"}; vazio = só
# ingestão manual. Verificar licença e limites de cada fonte antes (DP-11).
# A URL aceita {data} (AAAAMMDD do dia anterior, fuso de Fortaleza) e {data_hoje}.
# Focos diários do INPE: https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_{data}.csv
ALERTAS_FONTES = env.json("ALERTAS_FONTES", default={})
ALERTAS_INTERVALO_HORAS = env.int("ALERTAS_INTERVALO_HORAS", default=6)
# Focos de calor a até este raio (km) de um parque ou unidade de conservação ficam
# marcados no alerta, mesmo fora do município; o escopo dos focos ganha o mesmo buffer.
ALERTAS_FOCOS_RAIO_AREA_VERDE_KM = env.float("ALERTAS_FOCOS_RAIO_AREA_VERDE_KM", default=1.0)
# Raio por tipo de área (AV-07): vazio usa o raio geral acima. A distância é medida até o
# contorno da área, não até o centro.
ALERTAS_FOCOS_RAIO_PARQUE_KM = env.float("ALERTAS_FOCOS_RAIO_PARQUE_KM", default=None)
ALERTAS_FOCOS_RAIO_UC_KM = env.float("ALERTAS_FOCOS_RAIO_UC_KM", default=None)

# --- PRODES Caatinga (F-02) ----------------------------------------------------
# Camada de referência histórica: ingere os polígonos anuais de supressão do TerraBrasilis
# que intersectam o município cadastrado ampliado por este buffer (km). Não gera alertas.
PRODES_CAATINGA_BUFFER_KM = env.float("PRODES_CAATINGA_BUFFER_KM", default=2.0)

# --- Referências das espécies (M-01) ------------------------------------------
# Wikidata, Wikipedia e Wikimedia Commons; a política de uso pede identificação.
REFERENCIAS_USER_AGENT = env.str(
    "REFERENCIAS_USER_AGENT",
    default="itree/0.1 (Engine de Inteligencia Arborea; https://github.com/RaulMedeiros/itree)",
)
REFERENCIAS_TIMEOUT = env.int("REFERENCIAS_TIMEOUT", default=15)
# Ao cadastrar uma espécie, enfileira a consulta (Celery).
REFERENCIAS_AUTOMATICAS = env.bool("REFERENCIAS_AUTOMATICAS", default=True)
# Reconsulta mensal das referências antigas (M-09).
REFERENCIAS_IDADE_MAXIMA_DIAS = env.int("REFERENCIAS_IDADE_MAXIMA_DIAS", default=30)
REFERENCIAS_INTERVALO_SEGUNDOS = env.float("REFERENCIAS_INTERVALO_SEGUNDOS", default=1.0)
# Espécie cuja consulta terminou em erro (limite de taxa, fonte fora do ar) é
# retomada diariamente depois deste intervalo.
REFERENCIAS_REPETIR_ERRO_HORAS = env.int("REFERENCIAS_REPETIR_ERRO_HORAS", default=12)

# Importação de inventário: até este número de linhas válidas, a confirmação roda na própria
# requisição (resposta 200); acima disso vai para uma tarefa Celery (resposta 202).
IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA = env.int(
    "IMPORTACAO_LIMITE_CONFIRMACAO_IMEDIATA", default=500
)
# Arquivos de importação: tamanho do envio, membros e tamanho descompactado de ZIP/KMZ/XLSX, e a
# distância abaixo da qual uma árvore nova é apontada como possível duplicata de uma existente.
IMPORTACAO_TAMANHO_MAXIMO_MB = env.int("IMPORTACAO_TAMANHO_MAXIMO_MB", default=50)
IMPORTACAO_MAX_MEMBROS_ZIP = env.int("IMPORTACAO_MAX_MEMBROS_ZIP", default=50)
IMPORTACAO_MAX_DESCOMPACTADO_MB = env.int("IMPORTACAO_MAX_DESCOMPACTADO_MB", default=200)
IMPORTACAO_RAIO_DUPLICATAS_M = env.float("IMPORTACAO_RAIO_DUPLICATAS_M", default=2.0)
# --- Notificações: retenção -----------------------------------------------------
# A tarefa diária apaga as lidas há mais de NOTIFICACOES_RETENCAO_LIDAS_DIAS e as não
# lidas criadas há mais de NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS.
NOTIFICACOES_RETENCAO_LIDAS_DIAS = env.int("NOTIFICACOES_RETENCAO_LIDAS_DIAS", default=90)
NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS = env.int("NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS", default=365)
# --- Notificações: e-mail (M-14) ------------------------------------------------
# Com DEBUG as mensagens saem no console. Fora dele o padrão é o SMTP (preencha EMAIL_HOST etc.),
# para um deploy sem EMAIL_BACKEND não "enviar" e-mails só para o log.
EMAIL_BACKEND = env.str(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
EMAIL_HOST = env.str("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env.str("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env.str("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env.str("DEFAULT_FROM_EMAIL", default="iTree <nao-responda@itree.local>")
# Endereço público do painel web, usado nos links dos e-mails; vazio = só o texto.
WEB_URL_PUBLICA = env.str("WEB_URL_PUBLICA", default="").rstrip("/")
# Áreas verdes (Fortaleza em Mapas): reimportação mensal e aviso de fonte desatualizada
# quando a última importação passa deste limite (RF-INT-005).
AREAS_VERDES_IDADE_MAXIMA_DIAS = env.int("AREAS_VERDES_IDADE_MAXIMA_DIAS", default=60)
# Conflito de árvores com a iluminação pública (DP aberta): raio PROVISÓRIO, em metros, até a URBFOR
# e a SEINF definirem a regra. A interface sempre o mostra como provisório.
ILUMINACAO_RAIO_CONFLITO_M = env.float("ILUMINACAO_RAIO_CONFLITO_M", default=3.0)
# Ilha de calor por bairro (UrbVerde, IAU-USP). Os Termos de Uso da UrbVerde não são licença
# aberta (uso público e acadêmico, sem fins comerciais, todos os direitos reservados): o valor por
# bairro só é gravado depois que a prefeitura confirmar o uso com a USP. A camada do mapa (WMS)
# não grava nada e não depende disso.
URBVERDE_GRAVAR_VALORES = env.bool("URBVERDE_GRAVAR_VALORES", default=False)
URBVERDE_TIMEOUT = env.int("URBVERDE_TIMEOUT", default=180)
# Regra 3-30-300 (Konijnendijk, 2021). Limiar de NDVI que conta como vegetação no "30"; cobertura do
# WCS da UrbVerde com o NDVI (hoje o servidor não serve Fortaleza: veja
# itree.indicadores.vegetacao); e o percentual de residências que um bairro precisa ter em "3" e
# "300" para "atender" (a regra vale
# para cada casa, por isso 100).
VEGETACAO_LIMIAR_NDVI = env.float("VEGETACAO_LIMIAR_NDVI", default=0.4)
VEGETACAO_COBERTURA_WCS = env.str("VEGETACAO_COBERTURA_WCS", default="urbverde__NDVI-10m-2021")
REGRA_3_30_300_META_RESIDENCIAS_PCT = env.float("REGRA_3_30_300_META_RESIDENCIAS_PCT", default=100)
# Conectores de fontes externas (RF-INT-006): o servidor só busca hosts desta lista, por HTTPS.
ITREE_CONECTORES_HOSTS_PERMITIDOS = env.list(
    "ITREE_CONECTORES_HOSTS_PERMITIDOS",
    default=["mapas.fortaleza.ce.gov.br", "dados.fortaleza.ce.gov.br"],
)
ITREE_CONECTORES_TIMEOUT = env.int("ITREE_CONECTORES_TIMEOUT", default=30)
ITREE_CONECTORES_MAX_BYTES = env.int("ITREE_CONECTORES_MAX_BYTES", default=50 * 1024 * 1024)
ITREE_CONECTORES_MAX_FEICOES = env.int("ITREE_CONECTORES_MAX_FEICOES", default=20_000)
ITREE_CONECTORES_MAX_PAGINAS = env.int("ITREE_CONECTORES_MAX_PAGINAS", default=50)
# --- Detecção automática de árvores (satélite e vídeo de rua) -------------------------------
# Lotes com até este número de detecções são tratados na própria requisição (201); acima, vão para
# uma tarefa Celery (202) e a origem acompanha pela situação do lote.
DETECCAO_LIMITE_SINCRONO = env.int("DETECCAO_LIMITE_SINCRONO", default=200)
# Limites do recebimento: detecções por lote, fotos por detecção, tamanho de cada foto e do pacote.
DETECCAO_MAX_DETECCOES = env.int("DETECCAO_MAX_DETECCOES", default=20_000)
DETECCAO_MAX_FOTOS_POR_DETECCAO = env.int("DETECCAO_MAX_FOTOS_POR_DETECCAO", default=5)
DETECCAO_MAX_FOTO_MB = env.int("DETECCAO_MAX_FOTO_MB", default=10)
DETECCAO_MAX_CORPO_MB = env.int("DETECCAO_MAX_CORPO_MB", default=100)
DETECCAO_PACOTE_MAX_MEMBROS = env.int("DETECCAO_PACOTE_MAX_MEMBROS", default=5000)
# Junção: a observação se junta à árvore ativa mais próxima a até max(mínimo, incerteza) metros,
# com teto para uma incerteza absurda não fundir a quadra inteira.
DETECCAO_RAIO_JUNCAO_MINIMO_M = env.float("DETECCAO_RAIO_JUNCAO_MINIMO_M", default=2.0)
DETECCAO_RAIO_JUNCAO_MAXIMO_M = env.float("DETECCAO_RAIO_JUNCAO_MAXIMO_M", default=15.0)
# Faixas do selo de confiança: baixa < MEDIA <= média < ALTA <= alta.
DETECCAO_CONFIANCA_MEDIA = env.float("DETECCAO_CONFIANCA_MEDIA", default=0.5)
DETECCAO_CONFIANCA_ALTA = env.float("DETECCAO_CONFIANCA_ALTA", default=0.8)
# Hosts de onde o servidor baixa fotos por URL (mesma proteção dos conectores: HTTPS, porta 443,
# IP público, redirecionamentos revalidados). Vazio = só fotos enviadas em multipart ou no pacote.
ITREE_DETECCAO_HOSTS_FOTOS = env.list("ITREE_DETECCAO_HOSTS_FOTOS", default=[])
CELERY_BEAT_SCHEDULE = {
    "limpar-notificacoes": {
        "task": "itree.notificacoes.tasks.limpar_notificacoes_antigas",
        "schedule": crontab(hour=2, minute=15),
    },
    # Instantâneos da visão geral (M-11): um registro por dia e território.
    "registrar-indicadores": {
        "task": "itree.indicadores.tasks.registrar_indicadores",
        "schedule": crontab(hour=1, minute=30),
    },
    "atualizar-referencias-especies": {
        "task": "itree.inventario.tasks.atualizar_referencias_antigas",
        "schedule": crontab(minute=30, hour=3, day_of_month=1),
    },
    "retomar-referencias-com-erro": {
        "task": "itree.inventario.tasks.retomar_referencias_com_erro",
        "schedule": crontab(minute=45, hour=5),
    },
    "reimportar-areas-verdes": {
        "task": "itree.areas_verdes.tasks.reimportar_areas_verdes",
        "schedule": crontab(minute=0, hour=4, day_of_month=2),
    },
    "reimportar-adocao-pracas": {
        "task": "itree.areas_verdes.tasks.reimportar_adocao_pracas",
        "schedule": crontab(minute=30, hour=4, day_of_month=2),
    },
    "reimportar-iluminacao-publica": {
        "task": "itree.iluminacao.tasks.reimportar_iluminacao_publica",
        "schedule": crontab(minute=0, hour=4, day_of_month=3),
    },
    # Regra 3-30-300 por bairro: recalculada todo mês (cálculo pesado, nunca na requisição).
    "calcular-3-30-300": {
        "task": "itree.indicadores.tasks.calcular_3_30_300",
        "schedule": crontab(minute=20, hour=6, day_of_month=7),
    },
    # Dados imobiliários por bairro (IPTU, áreas edificadas) e macrozoneamento: mensal.
    "reimportar-dados-imobiliarios": {
        "task": "itree.imoveis.tasks.reimportar_dados_imobiliarios",
        "schedule": crontab(minute=40, hour=4, day_of_month=4),
    },
    # Ilha de calor por bairro (UrbVerde): anual, e só grava com URBVERDE_GRAVAR_VALORES.
    "reimportar-ilha-calor": {
        "task": "itree.indicadores.tasks.reimportar_ilha_calor",
        "schedule": crontab(minute=0, hour=5, day_of_month=5, month_of_year=2),
    },
    # População, renda e IDH por bairro: confere mensalmente as listagens do IBGE (versão nova do
    # Censo, estimativa nova) e reimporta só o que mudou.
    "renovar-fontes-populacao": {
        "task": "itree.indicadores.tasks.renovar_fontes_populacao",
        "schedule": crontab(minute=0, hour=5, day_of_month=6),
    },
    # Conectores vencidos pela periodicidade (RF-INT-006): confere de hora em hora.
    "disparar-conectores": {
        "task": "itree.conectores.tasks.disparar_conectores_vencidos",
        "schedule": crontab(minute=10),
    },
    **(
        {
            "ingerir-alertas": {
                "task": "itree.alertas.tasks.ingerir_fontes_configuradas",
                "schedule": ALERTAS_INTERVALO_HORAS * 3600,
            }
        }
        if ALERTAS_FONTES
        else {}
    ),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env.str("LOG_LEVEL", default="INFO")},
}
