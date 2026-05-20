COMPOSE         = docker-compose.yml
COMPOSE_DEV     = docker-compose.dev.yml
COMPOSE_OBS     = docker-compose.observability.yml
COMPOSE_OBS_APP = docker-compose.observability.app.yml

DC_DEV      = docker compose -f $(COMPOSE) -f $(COMPOSE_DEV)
DC_PROD     = docker compose -f $(COMPOSE) -f $(COMPOSE_OBS_APP)
DC_OBS      = docker compose -f $(COMPOSE) -f $(COMPOSE_DEV) -f $(COMPOSE_OBS)
DC_PROD_OBS = docker compose -f $(COMPOSE) -f $(COMPOSE_OBS)

# ── 로컬 개발 ─────────────────────────────────────────
dev:
	$(DC_DEV) up --build

down:
	$(DC_DEV) down

logs:
	$(DC_DEV) logs -f

ps:
	$(DC_DEV) ps

# Playwright e2e용 테스트 계정 시드 (멱등)
# 백엔드 컨테이너가 떠있어야 함 (make dev)
e2e-seed:
	$(DC_DEV) exec -T -e PYTHONPATH=/app backend python scripts/e2e_seed_user.py

# ── 프로덕션 배포 ──────────────────────────────────────
prod:
	bash scripts/pre-deploy.sh
	$(DC_PROD) up --build -d
	bash scripts/post-deploy.sh

prod-down:
	$(DC_PROD) down

prod-logs:
	$(DC_PROD) logs -f

# ── 관측 스택 (Loki + Promtail + Grafana) — 옵트인 ────
# 로컬 개발용 (make dev 위에 덧붙임)
up-obs:
	$(DC_OBS) up -d --build

down-obs:
	$(DC_OBS) down

logs-obs:
	$(DC_OBS) logs -f loki promtail grafana

# 팀 서버용 (make prod 위에 덧붙임 — 앱+관측 한 서버에 같이)
prod-up-obs:
	$(DC_PROD_OBS) up -d --build

prod-down-obs:
	$(DC_PROD_OBS) down

prod-logs-obs:
	$(DC_PROD_OBS) logs -f loki promtail grafana

# ── 모니터링 서버 분리 구조 ────────────────────────────
# 모니터링 서버 (163.239.77.66) — Loki + Prometheus + Grafana + InfluxDB
obs-server-up:
	docker compose -p mon -f docker-compose.observability.server.yml up -d --build

obs-server-down:
	docker compose -p mon -f docker-compose.observability.server.yml down

obs-server-logs:
	docker compose -p mon -f docker-compose.observability.server.yml logs -f

# ── 부하 테스트 (JMeter → InfluxDB → Grafana) ──────────
# 사용 예: make jmeter-run BASE_HOST=163.239.77.67 BASE_PORT=8000 THREADS=50 DURATION=120
# 결과는 Grafana 대시보드 "Apache JMeter — Load Test"에서 실시간 확인
JMETER_FILE   ?= seoganpyo-smoke.jmx
BASE_HOST     ?= host.docker.internal
BASE_PORT     ?= 8000
BASE_SCHEME   ?= http
THREADS       ?= 20
RAMPUP        ?= 10
DURATION      ?= 60
TEST_NAME     ?= seoganpyo-smoke

jmeter-run:
	docker compose -p mon -f docker-compose.observability.server.yml --profile jmeter run --rm jmeter \
		-n -t /tests/$(JMETER_FILE) \
		-l /results/$(TEST_NAME)-$(shell date +%Y%m%d-%H%M%S).jtl \
		-JBASE_HOST=$(BASE_HOST) -JBASE_PORT=$(BASE_PORT) -JBASE_SCHEME=$(BASE_SCHEME) \
		-JTHREADS=$(THREADS) -JRAMPUP=$(RAMPUP) -JDURATION=$(DURATION) \
		-JTEST_NAME=$(TEST_NAME) \
		-JINFLUX_URL=http://influxdb:8086/write?db=jmeter

jmeter-report:
	@ls -lt infra/loadtest/jmeter/results/*.jtl 2>/dev/null | head -5 || echo "결과 없음"
