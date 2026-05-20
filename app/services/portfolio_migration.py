"""포트폴리오 평가 테이블 자동 마이그레이션.

Base.metadata.create_all() 는 기존 테이블에 새 컬럼을 추가하지 않으므로 (CREATE 만)
별도로 ALTER TABLE 을 돌려준다. PostgreSQL/SQLite 둘 다 호환되는 ALTER 만 사용.

별점 스케일 변경(0~100 → 0~6) 도 같이 처리해서, 옛 평가 데이터가 화면에 깨져 보이지
않도록 한 번만 환산.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioEvaluation

logger = logging.getLogger(__name__)

_TABLE = "portfolio_evaluations"

# (컬럼명, DDL 타입) — PostgreSQL/SQLite 공통 표기.
_NEW_COLUMNS: list[tuple[str, str]] = [
    ("rubric", "JSON"),
    ("section_scores", "JSON"),
]


def add_missing_columns(engine: Engine) -> list[str]:
    """portfolio_evaluations 에 없는 컬럼만 ALTER TABLE 로 추가. 추가된 컬럼명 반환."""
    inspector = inspect(engine)
    if _TABLE not in inspector.get_table_names():
        return []
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    added: list[str] = []
    with engine.begin() as conn:
        for name, ddl_type in _NEW_COLUMNS:
            if name in existing:
                continue
            conn.execute(text(f"ALTER TABLE {_TABLE} ADD COLUMN {name} {ddl_type}"))
            added.append(name)
    return added


def migrate_score_scale(db: Session) -> int:
    """alignment_score 가 옛 0~100 스케일로 저장된 행(>6) 을 0~6 으로 환산. 변경된 행 수 반환."""
    rows = (
        db.query(PortfolioEvaluation)
        .filter(PortfolioEvaluation.alignment_score.isnot(None))
        .filter(PortfolioEvaluation.alignment_score > 6)
        .all()
    )
    for r in rows:
        # 0~100 → 0~6 정수. 반올림.
        r.alignment_score = max(0, min(6, round((r.alignment_score or 0) / 100.0 * 6)))
    if rows:
        db.commit()
    return len(rows)


def run(engine: Engine, db: Session) -> None:
    """startup 에서 한 번 호출. idempotent."""
    added = add_missing_columns(engine)
    if added:
        logger.info("portfolio_evaluations: 새 컬럼 추가 — %s", ", ".join(added))
    migrated = migrate_score_scale(db)
    if migrated:
        logger.info("portfolio_evaluations: alignment_score 스케일 환산 %d 행", migrated)
