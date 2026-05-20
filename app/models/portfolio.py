from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, DateTime, Index, JSON
from app.database import Base


PORTFOLIO_KINDS = ("campus_activity", "external_activity", "certificate", "award", "project")


class PortfolioEntry(Base):
    __tablename__ = "portfolio_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.student_id"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    title = Column(String(255), nullable=True)
    content = Column(Text, nullable=True)
    entry_date = Column(Date, nullable=True)
    order_index = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_portfolio_student_kind", "student_id", "kind"),
    )


EVALUATION_STATUSES = ("pending", "running", "completed", "failed")


class PortfolioEvaluation(Base):
    __tablename__ = "portfolio_evaluations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.student_id"), nullable=False, index=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    error_message = Column(Text, nullable=True)
    # 0~6 정수 — UI 에서 /2 해서 0~3 별점(0.5 단위) 으로 표시.
    # 4 차원(rubric) 별점의 평균을 *2 해서 저장. 이전 스케일(0~100) 행은 _migrate_score_scale 가 환산.
    alignment_score = Column(Integer, nullable=True)
    summary = Column(Text, nullable=True)
    strengths = Column(Text, nullable=True)
    weaknesses = Column(Text, nullable=True)
    suggestions = Column(Text, nullable=True)
    by_section = Column(Text, nullable=True)
    # 4 차원 별점 — {"skill_fit": 0~6, "depth": 0~6, "concreteness": 0~6, "breadth": 0~6}
    rubric = Column(JSON, nullable=True)
    # 5 섹션 별점 — {"campus_activity": 0~6, ...}
    section_scores = Column(JSON, nullable=True)
    raw_response = Column(Text, nullable=True)
    model_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
