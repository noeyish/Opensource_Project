from datetime import date, datetime
from typing import Optional, Literal
from pydantic import BaseModel


PortfolioKind = Literal["campus_activity", "external_activity", "certificate", "award", "project"]


class PortfolioEntryCreate(BaseModel):
    kind: PortfolioKind
    title: Optional[str] = None
    content: Optional[str] = None
    entry_date: Optional[date] = None
    order_index: Optional[int] = 0


class PortfolioEntryUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    entry_date: Optional[date] = None
    order_index: Optional[int] = None


class PortfolioEntryResponse(BaseModel):
    id: int
    kind: PortfolioKind
    title: Optional[str] = None
    content: Optional[str] = None
    entry_date: Optional[date] = None
    order_index: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PortfolioBulkSaveItem(BaseModel):
    id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    entry_date: Optional[date] = None
    order_index: Optional[int] = 0


class PortfolioBulkSaveRequest(BaseModel):
    campus_activity: list[PortfolioBulkSaveItem] = []
    external_activity: list[PortfolioBulkSaveItem] = []
    certificate: list[PortfolioBulkSaveItem] = []
    award: list[PortfolioBulkSaveItem] = []
    project: list[PortfolioBulkSaveItem] = []


EvaluationStatus = Literal["pending", "running", "completed", "failed"]


class PortfolioEvaluationResponse(BaseModel):
    id: int
    status: EvaluationStatus
    error_message: Optional[str] = None
    # 0~6 정수. UI 는 /2 해서 0~3 별점(0.5 단위) 으로 표시.
    alignment_score: Optional[int] = None
    # 4 차원 별점 — {"skill_fit": 0~6, "depth": 0~6, "concreteness": 0~6, "breadth": 0~6}
    rubric: dict[str, int] = {}
    # 5 섹션 별점 — {"campus_activity": 0~6, ...}
    section_scores: dict[str, int] = {}
    summary: Optional[str] = None
    strengths: list[str] = []
    weaknesses: list[str] = []
    suggestions: list[str] = []
    by_section: dict[str, str] = {}
    model_name: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
