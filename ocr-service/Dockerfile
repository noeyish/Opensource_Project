# 베이스 이미지는 Debian 코드네임 핀 필수 — `python:3.11-slim` unpin 은 Docker Hub 가
# 임의 시점에 다음 stable 로 떠내려보냄 (예: 2026-05 bookworm → trixie). prod backend 와 동일 정책.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Seoul

WORKDIR /app

# pip / wheel / setuptools 보안 업그레이드 — base 이미지 기본 버전이 CVE 9건 보유.
# CVE-2025-8869, CVE-2026-1703, CVE-2026-3219, CVE-2026-6357 (pip),
# CVE-2026-24049 (wheel — path traversal → privesc).
# 버전 핀 박음 (hadolint DL3013).
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip==26.1.1 wheel==0.47.0 setuptools==82.0.1 \
    && pip install --no-cache-dir --timeout 300 --retries 5 -r requirements.txt

# Non-root 사용자 (Trivy DS-002) — ocr-service 는 docker.sock 의존 없으니 안전하게 non-root.
ARG APP_UID=10001
RUN groupadd --system --gid ${APP_UID} appuser \
    && useradd --system --uid ${APP_UID} --gid ${APP_UID} --no-create-home --shell /usr/sbin/nologin appuser

COPY --chown=appuser:appuser main.py .

USER appuser

# HEALTHCHECK — Trivy DS-026. /health 엔드포인트 (docker-compose 와 동일 경로).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status < 500 else 1)" || exit 1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
