# Base images are pinned by digest as well as tag; Dependabot proposes new digests.
FROM ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 AS uv

FROM python:3.14-slim@sha256:cd89c30eda26ee911a4611b18680086e0ea42e6f5f8cbe653d07fa7958c9cec8 AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
# Only the lockfile decides what is installed; every wheel is checked against its
# SHA-256. All dependencies ship wheels, so no compiler is needed.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
# The face model files (OpenCV YuNet + SFace), fetched at build time and checked
# against the SHA-256 pinned in face_models.py, so the container needs no
# download at startup. The module uses the standard library only.
COPY app/__init__.py app/__init__.py
COPY app/services/__init__.py app/services/face_models.py app/services/
RUN python -m app.services.face_models /opt/face-models

FROM python:3.14-slim@sha256:cd89c30eda26ee911a4611b18680086e0ea42e6f5f8cbe653d07fa7958c9cec8
# libglib2.0-0: used by OpenCV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACE_MODEL_DIR=/opt/face-models
COPY --from=build /opt/venv /opt/venv
# Owned by root: the app can read the models but not change them.
COPY --from=build /opt/face-models /opt/face-models
WORKDIR /app
COPY --chown=app app ./app
COPY --chown=app seed.py ./
COPY --chown=app scripts ./scripts
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=3)"]
# X-Forwarded-For is trusted only from FORWARDED_ALLOW_IPS (set it to the proxy's
# address, or * when only the proxy can reach this port), so rate limits see clients.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
