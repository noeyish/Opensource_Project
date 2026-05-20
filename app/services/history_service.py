from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.activity import History
from app.models.course import Course
from app.schemas.history import HistoryCreate, HistoryUpdate
from app.services.special_courses_service import equiv_codes


def get_student_histories(db: Session, student_id: int) -> List[History]:
    """
    특정 학생의 전체 이수 기록을 조회합니다.
    History의 (course_code, year, semester)와 일치하는 Course 정보를 함께 가져옵니다.
    중복된 과목(분반 등)이 있을 경우 하나만 가져오도록 처리합니다.
    """
    # 1. 먼저 학생의 모든 History를 가져옵니다.
    histories = db.query(History).filter(History.student_id == student_id).all()

    for h in histories:
        # 2. 각 History에 대해 해당하는 Course를 하나만 조회합니다.
        # (course_code, year, semester)가 일치하는 것 중 첫 번째를 가져옵니다.
        course = (
            db.query(Course)
            .filter(
                Course.course_code == h.course_code,
                Course.year == h.year,
                Course.semester == h.semester
            )
            .first()
        )
        h.course = course

    return histories


def add_student_history(
    db: Session, student_id: int, history_in: HistoryCreate
) -> History:
    """
    수동으로 이수 기록을 추가합니다.
    입력된 (course_code, year, semester)가 실제 courses 테이블에 존재하는지 확인합니다.
    """
    # 1. 해당 연도/학기에 실제 존재하는 과목 코드인지 확인
    course_query = db.query(Course).filter(Course.course_code == history_in.course_code)
    
    if history_in.year:
        course_query = course_query.filter(Course.year == history_in.year)
    if history_in.semester:
        course_query = course_query.filter(Course.semester == history_in.semester)
        
    course_exists = course_query.first()
    
    if not course_exists:
        from fastapi import HTTPException
        msg = f"해당 학기({history_in.year}-{history_in.semester})에 존재하지 않는 과목 코드입니다."
        raise HTTPException(status_code=404, detail=msg)

    # 2. 이미 등록된 과목인지 확인 (같은 학기에 같은 과목 중복 방지)
    existing = (
        db.query(History)
        .filter(
            History.student_id == student_id,
            History.course_code == history_in.course_code,
            History.year == history_in.year,
            History.semester == history_in.semester
        )
        .first()
    )
    if existing:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="해당 학기에 이미 이수 목록에 존재하는 과목입니다.")

    # 3. 추가 — is_retake 는 _recompute 가 산정 (입력값 무시)
    history = History(
        student_id=student_id,
        course_code=history_in.course_code,
        year=history_in.year,
        semester=history_in.semester,
        is_retake=False,
    )
    db.add(history)
    db.flush()  # id 확보 후 같은 (학생, code) 그룹 재계산
    _recompute_retake_for(db, student_id, history_in.course_code)
    db.commit()
    db.refresh(history)

    # 조인된 정보도 바로 보여주기 위해 할당
    history.course = course_exists
    return history


def update_student_history(
    db: Session, student_id: int, history_id: int, history_in: HistoryUpdate
) -> History:
    """
    이수 기록(과목 코드, 연도, 학기, 재수강 여부)을 수정합니다.
    """
    history = (
        db.query(History)
        .filter(History.id == history_id, History.student_id == student_id)
        .first()
    )
    if not history:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="해당 이수 기록을 찾을 수 없습니다.")

    old_code = history.course_code

    # 1. 과목 코드를 변경하려는 경우 — 실제 존재하는 과목인지 확인
    if history_in.course_code is not None:
        course_exists = (
            db.query(Course).filter(Course.course_code == history_in.course_code).first()
        )
        if not course_exists:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="존재하지 않는 과목 코드입니다.")

    # 2. 수정 후 최종 (코드, 연도, 학기) 결정
    final_code = history_in.course_code if history_in.course_code is not None else history.course_code
    final_year = history_in.year if history_in.year is not None else history.year
    final_semester = history_in.semester if history_in.semester is not None else history.semester

    # 3. 자기 자신을 제외하고 같은 (학생, 코드, 연도, 학기) 튜플이 존재하면 차단
    if (final_code, final_year, final_semester) != (history.course_code, history.year, history.semester):
        dup = (
            db.query(History)
            .filter(
                History.student_id == student_id,
                History.course_code == final_code,
                History.year == final_year,
                History.semester == final_semester,
                History.id != history.id,
            )
            .first()
        )
        if dup:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail="같은 학기에 이미 같은 과목이 등록되어 있습니다.",
            )

    # 4. 값 적용
    if history_in.course_code is not None:
        history.course_code = history_in.course_code
    if history_in.year is not None:
        history.year = history_in.year
    if history_in.semester is not None:
        history.semester = history_in.semester

    # 3. is_retake 는 _recompute 가 자동 산정 — 입력값 무시.

    db.flush()
    # 변경 후 그룹 재계산
    _recompute_retake_for(db, student_id, history.course_code)
    # course_code 가 바뀌었으면 이전 그룹도 재계산
    if old_code != history.course_code:
        _recompute_retake_for(db, student_id, old_code)
    db.commit()
    db.refresh(history)
    return history


def delete_all_student_histories(db: Session, student_id: int) -> int:
    """
    특정 학생의 모든 이수 기록을 삭제하고 삭제된 행 개수를 반환합니다.
    """
    deleted = (
        db.query(History)
        .filter(History.student_id == student_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def delete_student_history(db: Session, student_id: int, history_id: int) -> bool:
    # ... (생략)
    """
    이수 기록을 삭제합니다.
    """
    history = (
        db.query(History)
        .filter(History.id == history_id, History.student_id == student_id)
        .first()
    )
    if not history:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="해당 이수 기록을 찾을 수 없습니다.")

    deleted_code = history.course_code
    db.delete(history)
    db.flush()
    # 남은 그룹 row 재계산 (한 row만 남으면 그게 자동 초수강)
    _recompute_retake_for(db, student_id, deleted_code)
    db.commit()
    return True


_SEM_ORDER = {1: 1, 3: 2, 2: 3, 4: 4}  # 봄 → 하계 → 가을 → 동계


def _chrono_key(year: Optional[int], semester: Optional[int]) -> Optional[int]:
    if year is None or semester is None:
        return None
    return year * 10 + _SEM_ORDER.get(semester, 9)


def _recompute_retake_for(db: Session, student_id: int, course_code: str) -> None:
    """같은 (학생, course_code) 그룹의 모든 row 를 시간순으로 재정렬해
    가장 이른 학기 한 개만 is_retake=False, 나머지는 True 로 set.

    동치 그룹(예: ABC0001 ↔ COR1010) 에 속한 코드는 한 묶음으로 묶어 함께 산정.

    NULL year/semester row 는 시간 비교 불가 → 그룹의 가장 뒤(재수강) 로 간주.
    호출자는 commit 책임을 진다 (이 함수는 flush 만).
    """
    codes = equiv_codes(course_code)
    rows = (
        db.query(History)
        .filter(
            History.student_id == student_id,
            History.course_code.in_(codes),
        )
        .all()
    )

    def sort_key(h: History):
        k = _chrono_key(h.year, h.semester)
        # None 은 항상 뒤로 (0/1 prefix 로 정렬 안정), id 로 tie-break
        return (1, h.id) if k is None else (0, k, h.id)

    rows.sort(key=sort_key)
    for i, h in enumerate(rows):
        new_val = i > 0
        if h.is_retake != new_val:
            h.is_retake = new_val


def save_histories(
    db: Session,
    student_id: int,
    matched_courses: List[Dict[str, Any]],
    year: Optional[int] = None,
    semester: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """OCR 매칭 결과를 histories 에 저장한다.

    같은 호출(=같은 학기) 안에서 같은 코드가 두 번 들어오면 첫 매칭만 저장.
    INSERT 후 _recompute_retake_for 가 같은 (학생, code) 그룹 전체를 시간순
    재정렬해 is_retake 를 일괄 산정한다.

    덮어쓰기: year/semester 가 모두 지정된 경우, 해당 학기의 기존 row 를 먼저 삭제한 뒤
    이번 매칭 결과로 채운다. 같은 학기에 시간표를 재업로드하면 누적되지 않고 갱신됨.
    """
    # 덮어쓰기 — 해당 (학생, 학기) 의 기존 row 를 모두 제거
    overwritten_codes: set[str] = set()
    if year is not None and semester is not None:
        existing_rows = (
            db.query(History)
            .filter(
                History.student_id == student_id,
                History.year == year,
                History.semester == semester,
            )
            .all()
        )
        overwritten_codes = {h.course_code for h in existing_rows}
        for h in existing_rows:
            db.delete(h)
        db.flush()

    saved_rows: List[Dict[str, Any]] = []
    seen_in_batch: set[str] = set()

    for item in matched_courses:
        course_code = item["course_code"]
        if course_code in seen_in_batch:
            continue
        seen_in_batch.add(course_code)

        history = History(
            student_id=student_id,
            course_code=course_code,
            year=year,
            semester=semester,
            is_retake=False,  # _recompute 가 곧 덮어씀
        )
        db.add(history)
        db.flush()

        saved_rows.append(
            {
                "history_id": history.id,
                "student_id": student_id,
                "course_code": course_code,
                "year": year,
                "semester": semester,
                "is_retake": False,
                "ocr_text": item.get("ocr_text"),
                "matched_course_name": item.get("matched_course_name"),
                "score": item.get("score"),
            }
        )

    # 이번 배치에 등장한 코드 + 덮어쓰기로 사라진 코드 각각에 대해 그룹 전체 재계산
    # (사라진 코드는 다른 학기 row 의 재수강 여부가 바뀔 수 있음)
    for code in seen_in_batch | overwritten_codes:
        _recompute_retake_for(db, student_id, code)
    db.flush()

    # 응답의 is_retake 를 재계산 결과로 동기화
    if saved_rows:
        latest = {
            h.id: h.is_retake
            for h in db.query(History.id, History.is_retake).filter(
                History.id.in_([r["history_id"] for r in saved_rows])
            )
        }
        for row in saved_rows:
            row["is_retake"] = latest.get(row["history_id"], False)

    db.commit()

    return saved_rows