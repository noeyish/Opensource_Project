import os
from datetime import datetime, timedelta
import jwt
from passlib.context import CryptContext
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.models.user import User

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24시간

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(student_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(student_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return int(payload["sub"])


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, student_id: int) -> User | None:
    return db.query(User).filter(User.student_id == student_id).first()


def get_user_by_approval_token(db: Session, token: str) -> User | None:
    return db.query(User).filter(User.approval_token == token).first()


def update_password(db: Session, email: str, new_password: str) -> None:
    user = get_user_by_email(db, email)
    user.password = hash_password(new_password)
    db.commit()


def delete_user(db: Session, student_id: int) -> None:
    """사용자 + 의존 데이터 일괄 삭제.

    users.student_id 를 FK 로 가리키는 모든 테이블을 순서대로 정리한 후 users 삭제.
    누락 시 FK RESTRICT 로 user 삭제 자체가 차단되니, 새 테이블 추가 시 이 함수도 함께 갱신할 것.

    정리 정책:
      - posts / comments       : student_id NULL 처리 (글/댓글은 남기되 작성자 표시 제거)
      - 그 외 활동 (시간표/장바구니/이수기록/좋아요/메시지/포트폴리오) : 모두 DELETE
      - contacts / reports     : 모델에 ondelete='SET NULL' 박혀있어 자동 처리 (여기서 안 다룸)
    """
    sid = {"sid": student_id}

    # ── 1. posts / comments : NULL 처리 (글 보존, 작성자 익명화) ────────────────
    # 옛 DB 스키마가 NOT NULL 이었을 수 있어 매번 ALTER 로 호환 보장.
    # 이미 NULL 허용이면 no-op.
    db.execute(text("ALTER TABLE posts ALTER COLUMN student_id DROP NOT NULL"))
    db.execute(text("ALTER TABLE comments ALTER COLUMN student_id DROP NOT NULL"))
    db.execute(text("UPDATE posts SET student_id = NULL WHERE student_id = :sid"), sid)
    db.execute(text("UPDATE comments SET student_id = NULL WHERE student_id = :sid"), sid)

    # ── 2. 게시판 반응 ─────────────────────────────────────────────────────────
    db.execute(text("DELETE FROM post_likes WHERE student_id = :sid"), sid)
    db.execute(text("DELETE FROM comment_likes WHERE student_id = :sid"), sid)

    # ── 3. 학생 활동 데이터 ────────────────────────────────────────────────────
    db.execute(text("DELETE FROM histories WHERE student_id = :sid"), sid)
    db.execute(text("DELETE FROM carts WHERE student_id = :sid"), sid)
    # 시간표 (PR #139) — timetable_courses 가 timetables FK 라 자식부터 정리.
    db.execute(text(
        "DELETE FROM timetable_courses "
        "WHERE timetable_id IN (SELECT id FROM timetables WHERE student_id = :sid)"
    ), sid)
    db.execute(text("DELETE FROM timetables WHERE student_id = :sid"), sid)

    # ── 4. 포트폴리오 (PR #110 류) ─────────────────────────────────────────────
    db.execute(text("DELETE FROM portfolio_evaluations WHERE student_id = :sid"), sid)
    db.execute(text("DELETE FROM portfolio_entries WHERE student_id = :sid"), sid)

    # ── 5. admin 메시지 (수신/발신 둘 다) ──────────────────────────────────────
    # recipient_id NOT NULL + sender_id NULLABLE 인데 둘 다 user FK → 양쪽 다 정리.
    db.execute(text(
        "DELETE FROM admin_messages WHERE recipient_id = :sid OR sender_id = :sid"
    ), sid)

    # ── 6. 마지막으로 사용자 행 ────────────────────────────────────────────────
    db.execute(text("DELETE FROM users WHERE student_id = :sid"), sid)
    db.commit()


def create_user(db: Session, student_id: int, name: str, email: str, password: str, **kwargs) -> User:
    user = User(
        student_id=student_id,
        name=name,
        email=email,
        password=hash_password(password),
        **kwargs
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
