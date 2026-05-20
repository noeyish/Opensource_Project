import json
import logging
from collections import defaultdict
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.dependencies import get_current_student_id
from app.models.portfolio import PortfolioEntry, PortfolioEvaluation, PORTFOLIO_KINDS
from app.models.user import User
from app.schemas.portfolio import (
    PortfolioBulkSaveRequest,
    PortfolioEntryCreate,
    PortfolioEntryResponse,
    PortfolioEntryUpdate,
    PortfolioEvaluationResponse,
)
from app.services import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/portfolio", tags=["Portfolio"])


# ─── 조회 ────────────────────────────────────────────────────────
@router.get("", response_model=dict[str, list[PortfolioEntryResponse]])
def list_my_portfolio(
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    """현재 사용자의 모든 포트폴리오 항목을 kind별로 그룹화하여 반환."""
    rows = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.student_id == student_id)
        .order_by(PortfolioEntry.kind, PortfolioEntry.order_index, PortfolioEntry.id)
        .all()
    )
    grouped: dict[str, list[PortfolioEntry]] = {k: [] for k in PORTFOLIO_KINDS}
    for r in rows:
        if r.kind in grouped:
            grouped[r.kind].append(r)
    return grouped


# ─── 단건 추가/수정/삭제 ─────────────────────────────────────────
@router.post("", response_model=PortfolioEntryResponse, status_code=201)
def create_entry(
    req: PortfolioEntryCreate,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    if req.kind not in PORTFOLIO_KINDS:
        raise HTTPException(status_code=400, detail="유효하지 않은 kind입니다.")
    entry = PortfolioEntry(
        student_id=student_id,
        kind=req.kind,
        title=req.title,
        content=req.content,
        entry_date=req.entry_date,
        order_index=req.order_index or 0,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=PortfolioEntryResponse)
def update_entry(
    entry_id: int,
    req: PortfolioEntryUpdate,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.id == entry_id, PortfolioEntry.student_id == student_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")
    if req.title is not None:
        entry.title = req.title
    if req.content is not None:
        entry.content = req.content
    if req.entry_date is not None:
        entry.entry_date = req.entry_date
    if req.order_index is not None:
        entry.order_index = req.order_index
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.id == entry_id, PortfolioEntry.student_id == student_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


# ─── 일괄 저장 (프론트의 "저장" 버튼) ────────────────────────────
@router.put("/bulk", response_model=dict[str, list[PortfolioEntryResponse]])
def bulk_save_portfolio(
    req: PortfolioBulkSaveRequest,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    """포트폴리오 전체를 한 번에 저장.

    프론트에서 추가/삭제/수정한 결과를 일괄 PUT.
    기존 항목 중 요청에 포함되지 않은 id는 삭제됨.
    """
    payload_by_kind = {
        "campus_activity": req.campus_activity,
        "external_activity": req.external_activity,
        "certificate": req.certificate,
        "award": req.award,
        "project": req.project,
    }

    # 사용자의 기존 항목 전체 조회
    existing = (
        db.query(PortfolioEntry).filter(PortfolioEntry.student_id == student_id).all()
    )
    existing_by_id = {e.id: e for e in existing}
    keep_ids: set[int] = set()

    for kind, items in payload_by_kind.items():
        for idx, item in enumerate(items):
            if item.id is not None and item.id in existing_by_id:
                # 기존 항목 업데이트
                e = existing_by_id[item.id]
                if e.kind != kind:
                    # 다른 사용자의 데이터일 가능성은 위 필터로 차단됨
                    e.kind = kind
                e.title = item.title
                e.content = item.content
                e.entry_date = item.entry_date
                e.order_index = item.order_index if item.order_index is not None else idx
                keep_ids.add(e.id)
            else:
                # 신규 항목
                new_entry = PortfolioEntry(
                    student_id=student_id,
                    kind=kind,
                    title=item.title,
                    content=item.content,
                    entry_date=item.entry_date,
                    order_index=item.order_index if item.order_index is not None else idx,
                )
                db.add(new_entry)

    # 요청에 없는 기존 항목은 삭제
    for e in existing:
        if e.id not in keep_ids:
            db.delete(e)

    db.commit()

    # 갱신된 전체 목록 반환
    rows = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.student_id == student_id)
        .order_by(PortfolioEntry.kind, PortfolioEntry.order_index, PortfolioEntry.id)
        .all()
    )
    grouped: dict[str, list[PortfolioEntry]] = {k: [] for k in PORTFOLIO_KINDS}
    for r in rows:
        if r.kind in grouped:
            grouped[r.kind].append(r)
    return grouped


# ─── AI 평가 (비동기 패턴) ───────────────────────────────────────
@router.post("/evaluate", response_model=PortfolioEvaluationResponse, status_code=202)
def request_evaluation(
    background_tasks: BackgroundTasks,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    """평가 요청 접수 → pending 행 즉시 생성 후 반환. AI 호출은 백그라운드.

    프론트는 받은 id를 들고 GET /evaluate/{id}를 폴링해서 완료 확인.
    """
    user = db.query(User).filter(User.student_id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    interests = [s for s in (user.interests or "").split(",") if s.strip()]
    target_careers = [s for s in (user.target_careers or "").split(",") if s.strip()]

    if not interests and not target_careers:
        raise HTTPException(
            status_code=400,
            detail="프로필에서 관심분야 또는 목표 직무를 먼저 설정해주세요.",
        )

    rows = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.student_id == student_id)
        .order_by(PortfolioEntry.kind, PortfolioEntry.order_index, PortfolioEntry.id)
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=400, detail="포트폴리오에 항목이 없습니다. 먼저 내용을 작성해주세요."
        )

    # 이미 진행 중인 평가가 있으면 그대로 반환 (중복 호출 방지)
    in_progress = (
        db.query(PortfolioEvaluation)
        .filter(
            PortfolioEvaluation.student_id == student_id,
            PortfolioEvaluation.status.in_(("pending", "running")),
        )
        .order_by(PortfolioEvaluation.created_at.desc())
        .first()
    )
    if in_progress:
        return _evaluation_to_response(in_progress)

    # 포트폴리오 스냅샷을 백그라운드 태스크로 넘기기 위해 미리 직렬화
    sections: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        sections[r.kind].append(
            {
                "title": r.title,
                "content": r.content,
                "entry_date": r.entry_date.isoformat() if r.entry_date else None,
            }
        )

    # pending 행 생성
    evaluation = PortfolioEvaluation(student_id=student_id, status="pending")
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)

    # 백그라운드에서 Gemini 호출 (응답 직후 실행됨)
    background_tasks.add_task(
        _run_evaluation_job,
        evaluation_id=evaluation.id,
        interests=interests,
        target_careers=target_careers,
        sections=dict(sections),
    )

    return _evaluation_to_response(evaluation)


@router.get("/evaluate/latest", response_model=Optional[PortfolioEvaluationResponse])
def get_latest_evaluation(
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    """가장 최근 평가 조회 (페이지 진입 시 진행 중인 평가가 있는지 확인)."""
    evaluation = (
        db.query(PortfolioEvaluation)
        .filter(PortfolioEvaluation.student_id == student_id)
        .order_by(PortfolioEvaluation.created_at.desc())
        .first()
    )
    if not evaluation:
        return None
    return _evaluation_to_response(evaluation)


@router.get("/evaluate/{evaluation_id}", response_model=PortfolioEvaluationResponse)
def get_evaluation(
    evaluation_id: int,
    student_id: int = Depends(get_current_student_id),
    db: Session = Depends(get_db),
):
    """특정 평가 결과 조회 (폴링용)."""
    evaluation = (
        db.query(PortfolioEvaluation)
        .filter(
            PortfolioEvaluation.id == evaluation_id,
            PortfolioEvaluation.student_id == student_id,
        )
        .first()
    )
    if not evaluation:
        raise HTTPException(status_code=404, detail="평가 결과를 찾을 수 없습니다.")
    return _evaluation_to_response(evaluation)


def _run_evaluation_job(
    evaluation_id: int,
    interests: list[str],
    target_careers: list[str],
    sections: dict[str, list[dict]],
):
    """BackgroundTask용 — 자체 DB 세션으로 Gemini 호출 후 행 업데이트."""
    db = SessionLocal()
    try:
        evaluation = (
            db.query(PortfolioEvaluation)
            .filter(PortfolioEvaluation.id == evaluation_id)
            .first()
        )
        if not evaluation:
            logger.error("평가 ID %s를 찾을 수 없음 (job)", evaluation_id)
            return

        evaluation.status = "running"
        db.commit()

        try:
            result = ai_service.evaluate_portfolio(interests, target_careers, sections)
        except ai_service.AIServiceError as e:
            evaluation.status = "failed"
            evaluation.error_message = json.dumps(e.to_payload(), ensure_ascii=False)
            evaluation.completed_at = datetime.utcnow()
            db.commit()
            logger.warning("평가 %s 실패 (AI 오류): %s", evaluation_id, e)
            return
        except httpx.HTTPError as e:
            evaluation.status = "failed"
            evaluation.error_message = json.dumps(
                {
                    "code": "unexpected_network",
                    "title": "AI 평가 서버와 통신 중 오류가 발생했어요",
                    "message": str(e),
                    "suggestion": "잠시 후 다시 시도해주세요.",
                },
                ensure_ascii=False,
            )
            evaluation.completed_at = datetime.utcnow()
            db.commit()
            logger.exception("평가 %s 실패 (네트워크)", evaluation_id)
            return
        except Exception as e:  # 안전망: 기타 예외도 failed로 기록
            evaluation.status = "failed"
            evaluation.error_message = json.dumps(
                {
                    "code": "unexpected",
                    "title": "예상치 못한 오류가 발생했어요",
                    "message": str(e),
                    "suggestion": "잠시 후 다시 시도해주세요.",
                },
                ensure_ascii=False,
            )
            evaluation.completed_at = datetime.utcnow()
            db.commit()
            logger.exception("평가 %s 실패 (예외)", evaluation_id)
            return

        evaluation.status = "completed"
        evaluation.alignment_score = result.get("alignment_score")
        evaluation.rubric = result.get("rubric") or {}
        evaluation.section_scores = result.get("section_scores") or {}
        evaluation.summary = result.get("summary")
        evaluation.strengths = json.dumps(result.get("strengths", []), ensure_ascii=False)
        evaluation.weaknesses = json.dumps(result.get("weaknesses", []), ensure_ascii=False)
        evaluation.suggestions = json.dumps(result.get("suggestions", []), ensure_ascii=False)
        evaluation.by_section = json.dumps(result.get("by_section", {}), ensure_ascii=False)
        evaluation.raw_response = result.get("raw_response")
        evaluation.model_name = result.get("model_name")
        evaluation.completed_at = datetime.utcnow()
        db.commit()
        logger.info("평가 %s 완료", evaluation_id)
    finally:
        db.close()


def _evaluation_to_response(e: PortfolioEvaluation) -> PortfolioEvaluationResponse:
    error_payload = None
    if e.error_message:
        try:
            error_payload = json.loads(e.error_message)
        except (json.JSONDecodeError, TypeError):
            error_payload = {"title": "오류 발생", "message": e.error_message}
    return PortfolioEvaluationResponse(
        id=e.id,
        status=e.status,
        error_message=json.dumps(error_payload, ensure_ascii=False) if error_payload else None,
        alignment_score=e.alignment_score,
        rubric=_safe_score_dict(e.rubric),
        section_scores=_safe_score_dict(e.section_scores),
        summary=e.summary,
        strengths=_safe_json_list(e.strengths),
        weaknesses=_safe_json_list(e.weaknesses),
        suggestions=_safe_json_list(e.suggestions),
        by_section=_safe_json_dict(e.by_section),
        model_name=e.model_name,
        created_at=e.created_at,
        completed_at=e.completed_at,
    )


def _safe_score_dict(v) -> dict[str, int]:
    """JSON 컬럼에서 읽은 값을 {str: int} 로 정규화. NULL/형식이상은 빈 dict."""
    if not isinstance(v, dict):
        return {}
    out: dict[str, int] = {}
    for k, val in v.items():
        try:
            out[str(k)] = int(val)
        except (TypeError, ValueError):
            continue
    return out


def _safe_json_list(s: Optional[str]) -> list[str]:
    if not s:
        return []
    try:
        v = json.loads(s)
        return [str(x) for x in v] if isinstance(v, list) else []
    except json.JSONDecodeError:
        return []


def _safe_json_dict(s: Optional[str]) -> dict[str, str]:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return {str(k): str(val) for k, val in v.items()} if isinstance(v, dict) else {}
    except json.JSONDecodeError:
        return {}
