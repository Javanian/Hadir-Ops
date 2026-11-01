# Base images are pinned by digest as well as tag; Dependabot proposes new digests.
FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM python:3.14-slim@sha256:cd89c30eda26ee911a4611b18680086e0ea42e6f5f8cbe653d07fa7958c9cec8 AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
# Only the lockfile decides what is installed; every wheel is checked against its
# SHA-256. All dependencies ship wheels, so no compiler is needed.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --extra face --no-install-project

FROM python:3.14-slim@sha256:cd89c30eda26ee911a4611b18680086e0ea42e6f5f8cbe653d07fa7958c9cec8
# libgomp1: OpenMP runtime used by onnxruntime; libglib2.0-0: used by OpenCV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app \
    && mkdir /models && chown app /models
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACE_MODEL_DIR=/models
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY --chown=app app ./app
COPY --chown=app seed.py seed_recent.py ./
COPY --chown=app scripts ./scripts
USER app
# The face model pack is downloaded here on first start; mount a volume to keep it.
VOLUME /models
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=3)"]
# X-Forwarded-For is trusted only from FORWARDED_ALLOW_IPS (set it to the proxy's
# address, or * when only the proxy can reach this port), so rate limits see clients.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
