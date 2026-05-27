# 📚 서간표 (Seoganpyo)

> **AI 기반 학업 컨설팅 플랫폼** — 학생이 시간표 이미지 한 장만 올리면 졸업 요건 충족 여부, 맞춤 강의, 강의계획서 요약까지 한 번에 받는 풀스택 웹 서비스.

서강대학교 학생을 대상으로 운영 중인 학업 보조 플랫폼입니다. 시간표 OCR 자동 인식, 수강이력 기반 졸업 요건 자동 계산, 4종 LLM을 활용한 강의계획서·교수 연구분야 요약, 맞춤형 강의 추천 등을 제공합니다.

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| **시간표 OCR 자동 인식** | 시간표 이미지 업로드 → Mistral Pixtral 비전 LLM → 과목명·연도·학기 자동 추출 → DB 강의와 fuzzy 매칭 |
| **졸업 요건 자동 계산** | 수강이력 + 학과 로드맵 비교 → 이수 학점·필수 과목 충족 여부 시각화 |
| **강의계획서 AI 요약** | PDF 업로드 → Groq llama-3.3-70b → 강의 목표·평가 비중·주차별 학습 내용 구조화 |
| **교수 연구분야 AI 요약** | 학교 페이지 크롤링 → Ollama exaone3.5 → 한국어 학술 요약 |
| **맞춤 강의 추천** | 관심 직무·이수 강의 기반 강의 추천 |
| **강의 찜·장바구니** | 수강신청 전 관심 강의 모아두기 (JWT 본인 데이터 격리) |
| **커뮤니티** | 익명 게시판 (카테고리·댓글·좋아요) |
| **관리자 대시보드** | 데이터 크롤링·AI 요약 재생성 + Gemini 챗봇으로 자연어 운영 |

---

## 🏗️ 시스템 아키텍처

```
┌───────────────────────────────────────────────────────────────┐
│  [Next.js 16 Frontend :3000]                                  │
│        ↓ REST API                                             │
│  [FastAPI Backend :8080] ──→ /metrics ──→ Prometheus :9090    │
│        ├─ stdout         ──→ Promtail  ──→ Loki :3100         │
│        ↓                                       ↓              │
│  [PostgreSQL 15] [Redis 7] [OCR Service :8001]                │
│                                ↓                              │
│                       Mistral Pixtral API                     │
└───────────────────────────────────────────────────────────────┘
                                                ↓
                                    [Grafana :3001 KPI 5종]
                                    ↓ iframe embed
                                /admin/monitoring
```

**메인 서비스** — Frontend(Next.js) · Backend(FastAPI) · OCR Service(Mistral Pixtral) · PostgreSQL · Redis
**관측 스택** — Prometheus · Grafana · Loki · Promtail (옵트인, `make up-obs`)

자세한 아키텍처는 [docs/architecture.md](docs/architecture.md) 참고.

---

## 🔧 기술 스택

### Backend
`Python 3.11` · `FastAPI 0.135` · `Uvicorn (ASGI)` · `SQLAlchemy 2.0` · `Pydantic 2.12` · `PyJWT` · `passlib/bcrypt` · `prometheus-fastapi-instrumentator` · `rapidfuzz` · `httpx` · `pypdf` · `beautifulsoup4`

### Frontend
`Next.js 16.2 (App Router)` · `React 19` · `TypeScript 5.7` · `Tailwind CSS 4` · `shadcn/ui` · `TanStack Query` · `react-hook-form + Zod` · `Recharts` · `Framer Motion` · `pnpm`

### Database / Cache
`PostgreSQL 15` (운영) · `SQLite` (테스트 격리) · `Redis 7`

### AI / LLM / OCR
| 모델 | 호스팅 | 용도 |
|------|--------|------|
| Mistral Pixtral | API | 시간표 이미지 OCR |
| Groq llama-3.3-70b | API | 강의계획서 PDF 요약 |
| Ollama exaone3.5 | 로컬 | 교수 연구분야 요약 |
| Gemini 2.5-flash | API | 관리자 챗봇 (MCP tool use) |

### Infrastructure & DevOps
`Docker / Docker Compose` (멀티 파일 오버레이) · `Jenkins` (CI/CD) · `SonarQube` · `Trivy` · `Snyk Code` · `DefectDojo` · `ZAP`

### Test
`pytest + pytest-cov` (백엔드) · `Playwright` (E2E)

### Agent / MCP
`Model Context Protocol (MCP)` 5종 — postgres / seoganpyo / grafana / docker / github

---

## 🚀 빠른 시작

### 사전 요구사항
- Docker · Docker Compose
- (선택) 로컬 Ollama — 교수 연구분야 요약 사용 시 `ollama serve` + `ollama pull exaone3.5:7.8b`

### 실행

```bash
# 1. 환경변수 설정 (한 번만)
cp .env.example .env
# .env에 GEMINI_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY 등 입력

# 2. 로컬 개발 (--reload + HMR)
make dev

# 3. 관측 스택 추가 기동 (옵트인)
make up-obs

# 종료
make down
make down-obs
```

### 접속

| 서비스 | URL |
|--------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| Backend metrics | http://localhost:8080/metrics |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |

---

## 📂 프로젝트 구조

```
opensource_project/
├── app/                       # FastAPI 백엔드
│   ├── main.py                # 17개 라우터 등록 + Prometheus 계측
│   ├── api/                   # 17개 라우터 (auth/courses/cart/history/upload/syllabus 등)
│   ├── models/                # 10개 SQLAlchemy ORM
│   ├── schemas/               # 10개 Pydantic 스키마
│   └── services/              # 11개 비즈니스 로직
├── frontend/                  # Next.js 16 (App Router) + TypeScript
├── ocr-service/               # Mistral Pixtral OCR 마이크로서비스
├── infra/observability/       # Prometheus / Grafana / Loki / Promtail 설정
├── scripts/
│   ├── analyze_logs.py        # Jenkins 실패 시 AI 로그 분석
│   ├── mcp_seoganpyo.py       # MCP 서버
│   └── migrations/            # DB 마이그레이션
├── tests/                     # pytest (7개 파일)
├── docs/                      # 프로젝트 문서
├── docker-compose*.yml        # 6개 compose 파일 오버레이
├── Dockerfile + Dockerfile.dev
├── Jenkinsfile + Jenkinsfile.zap
├── Makefile
└── .mcp.json                  # 5종 MCP 서버 설정
```

---

## 📖 문서

| 문서 | 내용 |
|------|------|
| [architecture.md](docs/architecture.md) | 전체 시스템 아키텍처 |
| [db_design.md](docs/db_design.md) | DB 스키마 설계 결정 |
| [erd.dbml](docs/erd.dbml) | DBML 형식 ERD |
| [api_spec.md](docs/api_spec.md) | API 명세 |
| [requirements.md](docs/requirements.md) | 요구사항 |
| [functional_spec.md](docs/functional_spec.md) | 기능 명세 |
| [ui_design_spec.md](docs/ui_design_spec.md) | UI 디자인 명세 |
| [runbook.md](docs/runbook.md) | 운영 가이드 |
| [security-setup.md](docs/security-setup.md) | 보안 설정 |
| [tasks.md](docs/tasks.md) | 작업 분담 |

---

## 🚦 CI/CD

`Jenkinsfile` 기반 파이프라인:

- **dev 브랜치**: Ruff Lint → pnpm build → pytest + coverage → Trivy(SCA/Secret/IaC) → Snyk Code(SAST) → DefectDojo 업로드
- **main 브랜치**: pre-deploy 점검 → Docker 빌드/배포 → post-deploy 헬스체크
- 알림: Discord Embed (성공/실패 시 AI 로그 분석 포함)

별도 ZAP DAST 파이프라인은 `Jenkinsfile.zap` 참고.

---

## 🌿 협업 컨벤션

- **브랜치 전략**: `main`(배포) · `dev`(통합) · `feat/<기능>` → `dev`로 PR
- **커밋 컨벤션**: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`
- **API 규칙**: `/api/v1/<리소스>`
- **코드 스타일**: Python PEP8 + snake_case / TypeScript PascalCase·camelCase
- **PR 리뷰 기준**: CRITICAL / MAJOR / MINOR 분류 ([CLAUDE.md](CLAUDE.md))

---

## 📜 License

학생 프로젝트로 별도 라이선스 표기 없음. 코드 인용·재사용 시 출처 표기 부탁드립니다.

---

**Team**: Minji · Hyeongwoo · Yuhwan · Hayeon
