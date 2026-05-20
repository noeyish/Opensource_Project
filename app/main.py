import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.api import auth, upload, courses, cart, history, users, admin, admin_chat, admin_security, admin_security_chat, syllabus, posts, contact, professors, portfolio, timetables
from app.database import engine, Base, SessionLocal
from app.models import user, course, professor, activity, post, report, notice, portfolio as portfolio_models, contact as contact_model, admin_message  # noqa: F401 — Base 테이블 등록용
from app.services import portfolio_migration
from app.services.special_courses_service import seed_special_courses

# Root logger 설정 — Promtail/Loki에서 INFO 이상 로그 수집 가능하도록
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# 서버 실행 시 DB 테이블 생성
Base.metadata.create_all(bind=engine)

# 특수 과목(수시·군이러닝) 시드 — idempotent, 부팅마다 신규 행만 추가.
_seed_db = SessionLocal()
try:
    _seeded = seed_special_courses(_seed_db)
    if _seeded:
        logging.getLogger(__name__).info("special courses seeded: %d rows", _seeded)
finally:
    _seed_db.close()

# 포트폴리오 평가 테이블 마이그레이션 — 새 컬럼(rubric, section_scores) 자동 추가 +
# 옛 0~100 스케일 alignment_score 를 0~6 별점 스케일로 환산.
_pf_db = SessionLocal()
try:
    portfolio_migration.run(engine, _pf_db)
finally:
    _pf_db.close()

app = FastAPI(title="서간표 통합 서버")

Instrumentator().instrument(app).expose(app)

os.makedirs("static/uploads/posts", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(auth.router)
app.include_router(upload.router)
app.include_router(courses.router)
app.include_router(cart.router)
app.include_router(timetables.router)
app.include_router(history.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(admin_chat.router)
app.include_router(admin_security.router)
app.include_router(admin_security_chat.router)
app.include_router(syllabus.router)
app.include_router(posts.router)
app.include_router(contact.router)
app.include_router(professors.router)
app.include_router(portfolio.router)

@app.get("/")
async def root():
    return JSONResponse(
        content={"message": "서간표 통합 서버가 준비되었습니다"},
        headers={"Content-Type": "application/json; charset=utf-8"}
    )
