# 1단계: docker CLI 바이너리 추출 전용.
# 운영 어시스턴트(admin_assistant.get_container_status) 가 컨테이너 안에서 `docker ps/stats` 를
# 호출하므로 backend 이미지에 docker CLI 바이너리가 들어가야 함.
#
# 과거엔 apt-get + curl 로 download.docker.com 에서 직접 받았는데
#   - deb.debian.org 한국 라우팅이 분 단위로 retry → apt-get update 단계에서 빌드 멈춤
#   - download.docker.com 도 arch 별 URL 이 달라 분기 로직 필요
# Docker 공식 멀티아키 cli 이미지에서 바이너리만 COPY 하면 두 외부 의존 모두 제거됨.
# Docker Hub 는 한국에서 안정적이고 layer 캐싱도 잘 됨.
FROM docker:27.5.1-cli AS docker-cli

# 2단계: 실제 backend 런타임.
# 베이스 이미지는 Debian 코드네임 핀 필수 — `python:3.11-slim` 단독 태그는 Docker Hub 가
# 임의 시점에 다음 stable 로 떠내려보냄 (예: 2026-05 경 bookworm(12) → trixie(13)).
# 같은 Dockerfile 이 시점에 따라 다른 결과를 내는 재현성 사고를 막기 위해 코드네임 고정.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TZ=Asia/Seoul

WORKDIR /app

# 호스트 docker.sock 을 /var/run/docker.sock 에 마운트해야 실제로 동작 (docker-compose.dev.yml).
# docker:27.5.1-cli 가 멀티아키 이미지라 빌드 플랫폼(amd64/arm64)에 맞는 바이너리가 자동 선택됨.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# 종속성 설치.
# pip / wheel / setuptools 를 먼저 업그레이드 — python:3.11-slim-bookworm 의 기본 버전이
#   pip 24.0  (CVE-2025-8869, CVE-2026-1703, CVE-2026-3219, CVE-2026-6357 — 4건)
#   wheel 0.45.1 (CVE-2026-24049 — path traversal → privilege escalation)
#   setuptools 79.0.1 (path traversal via wheel vendoring)
# 모두 패키지 설치 단계에서 영향을 주므로 requirements 설치 전에 갱신.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip wheel setuptools \
    && pip install --no-cache-dir --timeout 300 --retries 5 -r requirements.txt

# 애플리케이션 코드 및 데이터 복사
COPY ./app ./app
COPY ./static ./static
COPY ./data ./data

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
