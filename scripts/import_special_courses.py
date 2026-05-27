"""특수 과목(수시·군이러닝) 시드 수동 실행 스크립트.

서버 startup 에서 자동 실행되지만, 수동 점검·재시드용으로도 호출 가능.

사용법:
    PYTHONPATH=. python scripts/import_special_courses.py
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.database import SessionLocal  # noqa: E402
from app.services.special_courses_service import seed_special_courses  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        n = seed_special_courses(db)
        print(f"[완료] inserted={n}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
