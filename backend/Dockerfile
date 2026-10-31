FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# Bibliotecas geoespaciais exigidas pelo GeoDjango.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin libgdal-dev libgeos-dev libproj-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN DJANGO_SECRET_KEY=build python manage.py collectstatic --noinput

RUN useradd --system --uid 1000 itree && chown -R itree /app
USER itree

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
