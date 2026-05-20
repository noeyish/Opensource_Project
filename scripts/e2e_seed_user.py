"""
e2e Playwright 테스트용 사용자/강의/수강이력 시드.

backend 컨테이너 안에서 실행 — 멱등 (이미 있으면 skip).
사용: docker compose exec backend python scripts/e2e_seed_user.py
또는: make e2e-seed
"""
from app.database import SessionLocal
from app.models import user, course, professor, activity, post, portfolio  # noqa: F401 — relationship mapper 해결
from app.models.user import User
from app.models.course import Course
from app.models.activity import History
from app.services.user_service import hash_password


TEST_USER = {
    "student_id": 20201234,
    "name": "테스트유저",
    "email": "test@sogang.ac.kr",
    "password_plain": "password123",
    "current_semester": 5,
    "interests": "AI,백엔드",
    "major_credits": 60,
    "total_credits": 80,
    "is_approved": True,
}

# 테스트 전용 강의 — 실제 강의와 충돌 안 나게 9000번대 코드 + 2099년.
# graduation 페이지의 isMajorCourse 는 "CSE" prefix 로 전공/교양 판별.
TEST_COURSES = [
    {"course_code": "CSE9001", "course_name": "[e2e] 전공 1", "credits": 3, "year": 2099, "semester": 1, "course_category": "전공"},
    {"course_code": "CSE9002", "course_name": "[e2e] 전공 2", "credits": 3, "year": 2099, "semester": 1, "course_category": "전공"},
    {"course_code": "GEN9001", "course_name": "[e2e] 교양 1", "credits": 3, "year": 2099, "semester": 1, "course_category": "교양"},
    {"course_code": "GEN9002", "course_name": "[e2e] 교양 2", "credits": 3, "year": 2099, "semester": 1, "course_category": "교양"},
]
# 위 4개 강의를 모두 이수한 상태로 시드 → 총 12학점 (전공 6 + 교양 6), 4과목


def upsert_user(db) -> User:
    existing = db.query(User).filter(User.email == TEST_USER["email"]).first()
    if existing:
        print(f"[skip] user {TEST_USER['email']} (student_id={existing.student_id})")
        return existing
    u = User(
        student_id=TEST_USER["student_id"],
        name=TEST_USER["name"],
        email=TEST_USER["email"],
        password=hash_password(TEST_USER["password_plain"]),
        current_semester=TEST_USER["current_semester"],
        interests=TEST_USER["interests"],
        major_credits=TEST_USER["major_credits"],
        total_credits=TEST_USER["total_credits"],
        is_approved=TEST_USER["is_approved"],
    )
    db.add(u)
    db.commit()
    print(f"[ok] user {TEST_USER['email']} (student_id={u.student_id})")
    return u


def upsert_courses(db) -> None:
    for spec in TEST_COURSES:
        existing = (
            db.query(Course)
            .filter(
                Course.course_code == spec["course_code"],
                Course.year == spec["year"],
                Course.semester == spec["semester"],
            )
            .first()
        )
        if existing:
            print(f"[skip] course {spec['course_code']}")
            continue
        db.add(Course(**spec))
    db.commit()


def upsert_histories(db, student_id: int) -> None:
    for spec in TEST_COURSES:
        existing = (
            db.query(History)
            .filter(
                History.student_id == student_id,
                History.course_code == spec["course_code"],
                History.year == spec["year"],
                History.semester == spec["semester"],
            )
            .first()
        )
        if existing:
            print(f"[skip] history {spec['course_code']}")
            continue
        db.add(History(
            student_id=student_id,
            course_code=spec["course_code"],
            year=spec["year"],
            semester=spec["semester"],
            is_retake=False,
        ))
    db.commit()


def main() -> None:
    db = SessionLocal()
    try:
        u = upsert_user(db)
        upsert_courses(db)
        upsert_histories(db, u.student_id)
        print("[done] e2e 시드 완료 — 총 12학점 (전공 6 + 교양 6)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
