"""특수 과목(수시·군이러닝 등) 시드 + 동치 그룹 정의.

학교 정규 강의 테이블에는 없지만 학생 이수 이력에는 들어갈 수 있는 과목.
서버 startup 에서 idempotent 하게 courses 테이블에 채워두면, 일반 이수기록
추가 흐름(course 존재 검증 통과 → history insert)을 그대로 재사용할 수 있다.

COURSE_EQUIV_GROUPS: 학교 분류상 코드는 다르지만 사실상 같은 과목 → 재수강·
학점 산정 시 같은 그룹으로 묶어야 하는 코드 집합.
"""
from __future__ import annotations

from typing import Iterable

from sqlalchemy.orm import Session

from app.models.course import Course

# 프론트의 SEASONAL_YEARS 와 동일 범위 유지.
SEED_YEARS: tuple[int, ...] = tuple(range(2020, 2027))  # 2020~2026

# (code, name, semesters) — semesters 는 3=하계, 4=동계.
SPECIAL_COURSES: list[tuple[str, str, tuple[int, ...]]] = [
    ("ABC0001", "기초인공지능프로그래밍(수시)", (4,)),
    ("ABC0002", "군이러닝취득교과목I", (3, 4)),
    ("ABC0003", "군이러닝취득교과목II", (3, 4)),
    ("ABC0004", "군이러닝취득교과목III", (3, 4)),
]

# 동치 그룹 — 한 그룹의 어느 코드든 _recompute_retake_for 에서 묶어 처리.
COURSE_EQUIV_GROUPS: list[frozenset[str]] = [
    frozenset({"ABC0001", "COR1010"}),
]

_CODE_TO_GROUP: dict[str, frozenset[str]] = {
    code: group for group in COURSE_EQUIV_GROUPS for code in group
}


def equiv_codes(course_code: str) -> frozenset[str]:
    """같은 그룹의 모든 코드. 동치 그룹에 속하지 않으면 자기 자신만."""
    return _CODE_TO_GROUP.get(course_code, frozenset({course_code}))


def seed_special_courses(db: Session, years: Iterable[int] = SEED_YEARS) -> int:
    """SPECIAL_COURSES 의 모든 (code, year, semester) 조합을 보장. 기존 row 의 이름이
    SPECIAL_COURSES 정의와 다르면 갱신. 새로 INSERT 한 개수 반환 (rename 은 별도)."""
    inserted = 0
    renamed = 0
    for code, name, semesters in SPECIAL_COURSES:
        for year in years:
            for sem in semesters:
                existing = (
                    db.query(Course)
                    .filter(
                        Course.course_code == code,
                        Course.year == year,
                        Course.semester == sem,
                    )
                    .first()
                )
                if existing is not None:
                    if existing.course_name != name:
                        existing.course_name = name
                        renamed += 1
                    continue
                db.add(
                    Course(
                        course_code=code,
                        course_name=name,
                        credits=3,
                        target_grade=None,
                        is_english=False,
                        class_days=None,
                        class_start_time=None,
                        class_end_time=None,
                        professor_id=None,
                        year=year,
                        semester=sem,
                        course_category="교양",
                    )
                )
                inserted += 1
    if inserted or renamed:
        db.commit()
    return inserted
