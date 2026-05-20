"""
테스트 공통 픽스처

SQLite 파일 DB를 사용하여 실제 PostgreSQL에 영향 없이 독립 실행.
각 테스트 함수 실행 후 DB가 초기화되므로 테스트 간 데이터 오염 없음.
"""
import os

# 앱 임포트 전에 환경변수 설정 — app.database가 SQLite 엔진을 생성하도록
os.environ["TEST_DATABASE_URL"] = "sqlite:///./test_seoganpyo.db"
os.environ.setdefault("SECRET_KEY", "test-secret-key")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

# app.database의 engine을 공유해야 create_all과 세션이 같은 DB를 바라봄
from app.database import Base, get_db, engine
from app.main import app
from app.models import user, course, professor, activity, post  # noqa: F401 — 테이블 등록
from app.services.user_service import hash_password, create_access_token

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function", autouse=True)
def setup_db():
    """각 테스트마다 테이블 생성 → 실행 → 삭제.

    app.main 임포트 시 모듈 레벨 시드(seed_special_courses) 가 SQLite 에 들어가므로,
    매 테스트 시작 전에도 drop_all 로 잔여 데이터를 청소한다.
    """
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db():
    """테스트용 DB 세션"""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="function")
def client(db):
    """FastAPI TestClient — get_db 의존성을 테스트 DB로 교체"""
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── 테스트 데이터 픽스처 ──────────────────────────────────────

@pytest.fixture
def test_user(db):
    """기본 테스트 유저"""
    from app.models.user import User
    u = User(
        student_id=20201234,
        name="테스트유저",
        email="test@sogang.ac.kr",
        password=hash_password("password123"),
        current_semester=5,
        interests="AI,백엔드",
        major_credits=60,
        total_credits=80,
        is_approved=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def test_user2(db):
    """두 번째 테스트 유저 (권한 테스트용)"""
    from app.models.user import User
    u = User(
        student_id=20205678,
        name="다른유저",
        email="other@sogang.ac.kr",
        password=hash_password("password456"),
        current_semester=3,
        is_approved=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def auth_headers(test_user):
    """test_user의 JWT 인증 헤더"""
    token = create_access_token(test_user.student_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers2(test_user2):
    """test_user2의 JWT 인증 헤더"""
    token = create_access_token(test_user2.student_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_professor(db):
    """테스트 교수"""
    from app.models.professor import Professor
    p = Professor(
        professor_id=1,
        name="김교수",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture
def test_course(db, test_professor):
    """테스트 강의"""
    from app.models.course import Course
    c = Course(
        course_code="CSE4101",
        course_name="인공지능",
        credits=3,
        target_grade="3,4",
        is_english=False,
        class_days="월수",
        class_start_time="10:00",
        class_end_time="11:30",
        professor_id=test_professor.professor_id,
        year=2026,
        semester=1,
        course_category="전공필수",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def test_course2(db, test_professor):
    """두 번째 테스트 강의 (검색/필터 테스트용)"""
    from app.models.course import Course
    c = Course(
        course_code="CSE3201",
        course_name="운영체제",
        credits=3,
        target_grade="3",
        is_english=True,
        class_days="화목",
        class_start_time="13:00",
        class_end_time="14:30",
        professor_id=test_professor.professor_id,
        year=2026,
        semester=1,
        course_category="전공선택",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def test_post(db, test_user):
    """테스트 게시글"""
    from app.models.post import Post
    p = Post(
        category="general",
        title="테스트 게시글",
        content="테스트 내용입니다.",
        student_id=test_user.student_id,
        is_anonymous=False,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture
def test_post_anonymous(db, test_user):
    """익명 테스트 게시글"""
    from app.models.post import Post
    p = Post(
        category="general",
        title="익명 게시글",
        content="익명으로 작성한 글입니다.",
        student_id=test_user.student_id,
        is_anonymous=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture
def test_cart(db, test_user, test_course):
    """테스트 장바구니 항목"""
    from app.models.activity import Cart
    c = Cart(student_id=test_user.student_id, course_id=test_course.course_id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c
