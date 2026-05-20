"""포트폴리오 AI 평가 서비스 (Google Gemini API).

LLM 호출부를 이 모듈로 격리해두면 추후 Claude/Ollama 등 다른 모델로 교체할 때
이 파일만 수정하면 됩니다.
"""
import json
import logging
import os
import re
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class AIServiceError(Exception):
    """AI 평가 호출 중 발생한 사용자에게 보여줄 만한 오류.

    Attributes:
        code: 내부 에러 코드 (프론트가 분기 처리할 수 있도록)
        title: 짧은 제목 (예: "AI 사용량 한도 초과")
        message: 상세 설명 (한국어)
        suggestion: 해결책 제안 (한국어)
        http_status: HTTPException으로 변환할 때 쓸 상태 코드
    """

    def __init__(
        self,
        code: str,
        title: str,
        message: str,
        suggestion: str = "",
        http_status: int = 502,
    ):
        super().__init__(f"[{code}] {title}: {message}")
        self.code = code
        self.title = title
        self.message = message
        self.suggestion = suggestion
        self.http_status = http_status

    def to_payload(self) -> dict:
        return {
            "code": self.code,
            "title": self.title,
            "message": self.message,
            "suggestion": self.suggestion,
        }

# .env에서 GEMINI_API_KEY를 읽음. 사용자가 직접 키를 발급받아 .env에 채워넣어야 함.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "MYKEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
# 503/UNAVAILABLE/모델 deprecated 시 자동 폴백할 모델.
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash-lite")
GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
MAX_503_RETRIES = 1  # 같은 모델로 재시도 횟수 (그 후 폴백 모델로 전환)
# Google Search grounding — 자격증·수상내역 등 실재 여부 검증을 위해 기본 ON.
# 응답 시간 2~5초 가산되며 responseMimeType 강제와 비호환이라 JSON 추출은 _extract_json 에 의존.
ENABLE_SEARCH_GROUNDING = os.getenv("ENABLE_SEARCH_GROUNDING", "true").lower() in ("true", "1", "yes")


KIND_LABELS_KO = {
    "campus_activity": "교내활동",
    "external_activity": "교외활동",
    "certificate": "자격증",
    "award": "수상내역",
    "project": "프로젝트",
}


SYSTEM_PROMPT = """당신은 IT/컴퓨터공학 전공 대학생의 포트폴리오를 분석하는 진로 컨설턴트입니다.
사용자의 관심분야와 목표 직무를 기준으로 포트폴리오를 평가하고, 다음 JSON 스키마로만 응답하세요.
JSON 외의 다른 텍스트나 마크다운 코드블록은 절대 포함하지 마세요.

모든 점수는 0~6 정수입니다. UI 에서 /2 해서 0~3 별점(0.5 단위) 으로 보여집니다.

{
  "rubric": {
    "skill_fit":     0~6 정수,   // 기술 적합도 — 보유 기술/경험이 목표 직무 요구사항과 얼마나 부합
    "depth":         0~6 정수,   // 경험 깊이 — 단순 참여 vs 주도/장기간 vs 결과 산출
    "concreteness":  0~6 정수,   // 구체성 — 정량 지표·결과·임팩트가 명시되어 있는지
    "breadth":       0~6 정수    // 다양성 — 활동 유형 분포 (단일 분야 vs 균형)
  },
  "alignment_score": 0~6 정수 (위 4 개 차원 평균을 반올림),
  "section_scores": {
    "campus_activity":   0~6 정수,
    "external_activity": 0~6 정수,
    "certificate":       0~6 정수,
    "award":             0~6 정수,
    "project":           0~6 정수
  },
  "summary": "전반적 평가 한 단락 (3-4문장, 한국어)",
  "strengths":  ["강점 1", ...] (3~5개, 구체적으로),
  "weaknesses": ["부족한 점 1", ...] (2~4개, 구체적으로),
  "suggestions":["다음 단계 제안 1", ...] (3~5개, 실행 가능한 액션),
  "by_section": {
    "campus_activity":   "교내활동 섹션 코멘트 (1-2문장)",
    "external_activity": "교외활동 섹션 코멘트",
    "certificate":       "자격증 섹션 코멘트",
    "award":             "수상내역 섹션 코멘트",
    "project":           "프로젝트 섹션 코멘트"
  }
}

별점 산정 기준 (앵커):

[skill_fit — 기술 적합도]
- 0 (★0)    : 목표 직무와 관련된 활동·기술이 전혀 없음
- 1~2 (★1)  : 입문 수준만 보임 (수업 따라가는 정도)
- 3~4 (★1.5~2): 직무 핵심 기술 중 일부에서 실전 경험
- 5~6 (★2.5~3): 직무 핵심 기술 대부분에 실전 경험 + 추가 심화

[depth — 경험 깊이]
- 0 (★0)    : 활동 없음
- 1~2 (★1)  : 단발성 참여, 짧은 기간
- 3~4 (★2)  : 학기/분기 단위 지속, 본인 역할 명확
- 5~6 (★3)  : 장기간 주도, 책임자/리더 역할, 결과물 산출

[concreteness — 구체성]
- 0 (★0)    : 활동명만 있고 내용 없음
- 1~2 (★1)  : 무엇을 했는지만 (수치·결과 없음)
- 3~4 (★2)  : 일부 정량 지표 (예: "사용자 100명")
- 5~6 (★3)  : 명확한 정량 지표 + 임팩트 (전/후 비교, 비즈니스 영향)

[breadth — 다양성]
- 0 (★0)    : 모든 섹션 비어있음
- 1~2 (★1)  : 1~2 개 섹션에만 집중
- 3~4 (★2)  : 3~4 개 섹션 균형
- 5~6 (★3)  : 5 개 섹션 모두에 의미있는 기록

[section_scores — 섹션별 별점]
- 0 (★0)    : 기록 없음
- 1~2 (★1)  : 있긴 한데 직무 무관 또는 빈약
- 3~4 (★2)  : 직무 관련 + 구체적이나 임팩트 약함
- 5~6 (★3)  : 직무 관련 + 구체적 임팩트 또는 권위 있는 결과

평가 원칙:
- alignment_score 는 rubric 4 차원의 평균을 반올림한 값과 일치해야 함
- strengths/weaknesses 는 위 차원·섹션 중 어디서 점수가 높/낮은지에 직접 근거를 두어 작성
- 막연한 칭찬 금지. 구체적 근거(어떤 자격증/프로젝트가 어떤 직무에 왜 도움이 되는지) 포함
- 비어있는 섹션은 "기록이 없음 — 어떤 경험을 추가하면 좋을지" 형태로 권유
- 빈약한 포트폴리오라면 그 사실을 솔직히 알리되, 격려와 다음 단계 제안 포함
- 모든 텍스트는 한국어로 작성하고, 별표(**)나 마크다운 같은 장식 문법은 사용하지 마세요

실재 검증 (중요):
- 도구로 제공되는 Google Search 를 적극 활용해 자격증·수상내역·외부활동·기관명이 실제로 존재하는지 검증하세요.
- 검색해도 확인되지 않거나, 명칭이 명백히 사실과 다른 항목은 "확인되지 않음" 으로 간주하고 다음을 실행하세요:
  1) `weaknesses` 에 해당 항목명을 명시하며 "공식 출처에서 확인되지 않음 — 명칭을 다시 확인해 주세요" 라고 적기
  2) 해당 섹션의 `section_scores` 점수를 낮추기 (확인 안 된 항목은 점수 산정에서 제외)
  3) 모르는 자격증·수상을 아는 척하지 말 것. 그럴듯한 이름이라도 검색으로 확인되지 않으면 신뢰하지 마세요.
- 반대로 검색으로 실재가 확인된 항목은 `strengths` 또는 `by_section` 코멘트에서 "공식 자격증/대회임을 확인" 이라고 간단히 명시해도 좋습니다."""


def _build_user_prompt(
    interests: list[str],
    target_careers: list[str],
    sections: dict[str, list[dict]],
) -> str:
    parts: list[str] = []
    parts.append("## 사용자 프로필")
    parts.append(f"- 관심분야: {', '.join(interests) if interests else '(미설정)'}")
    parts.append(f"- 목표 직무: {', '.join(target_careers) if target_careers else '(미설정)'}")
    parts.append("")
    parts.append("## 포트폴리오")
    for kind, label in KIND_LABELS_KO.items():
        items = sections.get(kind, [])
        parts.append(f"\n### {label} ({len(items)}건)")
        if not items:
            parts.append("- (기록 없음)")
            continue
        for i, it in enumerate(items, 1):
            line = f"{i}. "
            if it.get("title"):
                line += f"[{it['title']}] "
            if it.get("entry_date"):
                line += f"({it['entry_date']}) "
            if it.get("content"):
                line += it["content"]
            parts.append(line.strip())
    parts.append("")
    parts.append("위 정보를 바탕으로 평가 JSON을 생성하세요.")
    return "\n".join(parts)


def _extract_json(text: str) -> dict:
    """모델이 ```json ... ``` 마크다운으로 감싸 보낼 경우도 대응."""
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


def evaluate_portfolio(
    interests: list[str],
    target_careers: list[str],
    sections: dict[str, list[dict]],
) -> dict:
    """Gemini로 포트폴리오를 평가하고 dict 반환.

    실패 시 AIServiceError 또는 httpx.HTTPError 발생.
    """
    if not GEMINI_API_KEY or GEMINI_API_KEY == "MYKEY":
        raise AIServiceError(
            code="missing_api_key",
            title="AI 평가가 아직 설정되지 않았어요",
            message="서버에 GEMINI_API_KEY가 설정되지 않았습니다.",
            suggestion="관리자에게 .env 파일에 GEMINI_API_KEY를 추가해달라고 요청해주세요.",
            http_status=503,
        )

    user_prompt = _build_user_prompt(interests, target_careers, sections)

    def _build_payload(use_grounding: bool) -> dict:
        # Search grounding 과 responseMimeType=application/json 은 동시 사용 불가.
        cfg: dict = {"temperature": 0.4}
        if not use_grounding:
            cfg["responseMimeType"] = "application/json"
        p: dict = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": cfg,
        }
        if use_grounding:
            # Gemini v1beta REST 는 camelCase. 자격증·수상 실재 여부 검증용.
            p["tools"] = [{"googleSearch": {}}]
        return p

    def _extract_parts_text(d: dict) -> str:
        # Grounding 활성 시 응답이 multi-part — parts 전체 순회.
        try:
            parts = d["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError, TypeError):
            return ""
        if not isinstance(parts, list):
            return ""
        return "".join(p.get("text", "") for p in parts if isinstance(p, dict))

    use_grounding = ENABLE_SEARCH_GROUNDING
    resp, used_model = _call_gemini_with_fallback(_build_payload(use_grounding))
    data = resp.json()
    text = _extract_parts_text(data)

    # Grounding 켰는데 빈 응답이 오는 알려진 케이스 — grounding 끄고 한 번 더.
    if not text and use_grounding:
        logger.warning("Grounding 응답이 비어 grounding 없이 재시도")
        use_grounding = False
        resp, used_model = _call_gemini_with_fallback(_build_payload(False))
        data = resp.json()
        text = _extract_parts_text(data)

    if not text:
        logger.error("Gemini 응답에 text 가 없음: %s", data)
        # finishReason이 SAFETY 등으로 응답이 비어있을 수 있음
        finish_reason = (
            data.get("candidates", [{}])[0].get("finishReason") if data.get("candidates") else None
        )
        if finish_reason == "SAFETY":
            raise AIServiceError(
                code="safety_block",
                title="AI가 응답을 거부했어요",
                message="포트폴리오 내용 중 일부가 안전 필터에 걸려 평가를 생성하지 못했습니다.",
                suggestion="민감하거나 부적절한 표현이 있는지 확인하고 다시 시도해주세요.",
                http_status=422,
            )
        raise AIServiceError(
            code="empty_response",
            title="AI가 빈 응답을 보냈어요",
            message=f"finishReason={finish_reason}",
            suggestion="잠시 후 다시 시도해주세요.",
            http_status=502,
        )

    try:
        result = _extract_json(text)
    except json.JSONDecodeError as e:
        logger.error("Gemini JSON 파싱 실패. 원문: %s", text[:500])
        raise AIServiceError(
            code="invalid_json",
            title="AI 응답을 해석할 수 없어요",
            message=f"AI가 유효한 JSON을 반환하지 않았습니다: {e}",
            suggestion="잠시 후 다시 시도해주세요. 계속 발생하면 다른 모델(GEMINI_MODEL=gemini-2.5-flash)로 바꿔보세요.",
            http_status=502,
        )

    rubric = _coerce_score_dict(result.get("rubric"), RUBRIC_KEYS)
    section_scores = _coerce_score_dict(result.get("section_scores"), SECTION_KEYS)
    alignment_score = _coerce_score(result.get("alignment_score"))
    # 모델이 alignment_score 를 빼먹거나 rubric 평균과 크게 어긋나면 rubric 평균으로 보정.
    if rubric:
        derived = round(sum(rubric.values()) / len(rubric))
        if alignment_score is None or abs(alignment_score - derived) > 1:
            alignment_score = derived

    return {
        "alignment_score": alignment_score,
        "rubric": rubric,
        "section_scores": section_scores,
        "summary": result.get("summary"),
        "strengths": _coerce_str_list(result.get("strengths")),
        "weaknesses": _coerce_str_list(result.get("weaknesses")),
        "suggestions": _coerce_str_list(result.get("suggestions")),
        "by_section": _coerce_str_dict(result.get("by_section")),
        "raw_response": text,
        "model_name": used_model,
    }


def _is_unavailable(status_code: int, body_text: str) -> bool:
    """503/UNAVAILABLE/모델 deprecated 여부. 폴백 트리거 판정용."""
    if status_code in (503, 429):
        return True
    body_lower = body_text.lower()
    if "unavailable" in body_lower or "high demand" in body_lower:
        return True
    # 신규 사용자에게 deprecated된 모델 (404 + "no longer available")도 폴백 트리거
    if status_code == 404 and "no longer available" in body_lower:
        return True
    return False


def _post_gemini(model: str, payload: dict) -> httpx.Response:
    url = GEMINI_URL_TEMPLATE.format(model=model)
    with httpx.Client(timeout=60.0) as client:
        return client.post(
            url,
            params={"key": GEMINI_API_KEY},
            json=payload,
            headers={"Content-Type": "application/json"},
        )


def _call_gemini_with_fallback(payload: dict) -> tuple[httpx.Response, str]:
    """메인 모델로 호출 → 503/UNAVAILABLE/모델 deprecated 시 폴백 모델로 자동 전환.

    Returns:
        (200 응답, 실제 사용된 모델명)
    """
    candidate_models = [GEMINI_MODEL]
    if FALLBACK_MODEL and FALLBACK_MODEL != GEMINI_MODEL:
        candidate_models.append(FALLBACK_MODEL)

    last_resp: Optional[httpx.Response] = None
    for model in candidate_models:
        for attempt in range(MAX_503_RETRIES + 1):
            try:
                resp = _post_gemini(model, payload)
            except httpx.TimeoutException:
                raise AIServiceError(
                    code="timeout",
                    title="AI 응답 시간이 초과됐어요",
                    message="평가 서버가 60초 안에 응답하지 않았습니다.",
                    suggestion="잠시 후 다시 시도해주세요. 계속 발생하면 포트폴리오 내용을 줄여보세요.",
                    http_status=504,
                )
            except httpx.HTTPError as e:
                raise AIServiceError(
                    code="network",
                    title="AI 평가 서버에 연결할 수 없어요",
                    message=f"네트워크 오류: {e}",
                    suggestion="잠시 후 다시 시도해주세요.",
                    http_status=502,
                )

            if resp.status_code == 200:
                return resp, model

            last_resp = resp
            if not _is_unavailable(resp.status_code, resp.text):
                # 503/UNAVAILABLE/모델 deprecated 외 오류는 즉시 분류해서 raise
                raise _classify_gemini_error(resp)

            logger.warning(
                "Gemini %s 일시 오류 (%d, 시도 %d/%d): %s",
                model, resp.status_code, attempt + 1, MAX_503_RETRIES + 1,
                resp.text[:200],
            )
            time.sleep(1.0 + attempt)

    # 모든 모델·재시도 실패 — 마지막 응답으로 분류
    if last_resp is not None:
        raise _classify_gemini_error(last_resp)
    raise AIServiceError(
        code="upstream_unavailable",
        title="AI 서버가 일시적으로 불안정해요",
        message="모든 모델 시도 실패",
        suggestion="잠시 후 다시 시도해주세요.",
        http_status=502,
    )


def _classify_gemini_error(resp: httpx.Response) -> AIServiceError:
    """Gemini API HTTP 응답을 사용자 친화적 에러로 변환."""
    status = resp.status_code
    body_text = resp.text
    body: dict = {}
    try:
        body = resp.json()
    except (json.JSONDecodeError, ValueError):
        pass
    api_message = body.get("error", {}).get("message", body_text[:300]) if body else body_text[:300]

    logger.error("Gemini API 오류 %d: %s", status, api_message)

    if status == 400:
        # 잘못된 요청 — 보통 모델명 오타 또는 입력 형식 문제
        return AIServiceError(
            code="bad_request",
            title="AI 요청 형식이 잘못됐어요",
            message=f"Gemini가 요청을 거절했습니다: {api_message}",
            suggestion=(
                ".env의 GEMINI_MODEL이 유효한 모델명인지 확인해주세요 "
                "(예: gemini-2.5-flash, gemini-2.5-flash, gemini-2.5-flash-lite)."
            ),
            http_status=400,
        )

    if status in (401, 403):
        # 키 문제
        return AIServiceError(
            code="invalid_key",
            title="AI 키가 유효하지 않아요",
            message=f"Gemini가 인증을 거절했습니다: {api_message}",
            suggestion=(
                "Google AI Studio(aistudio.google.com)에서 키가 살아있는지 확인하고, "
                ".env의 GEMINI_API_KEY 값을 다시 확인해주세요. "
                "키 변경 후에는 백엔드 재시작 필요."
            ),
            http_status=401,
        )

    if status == 404:
        return AIServiceError(
            code="model_not_found",
            title="해당 AI 모델을 찾을 수 없어요",
            message=f"Gemini가 모델을 찾지 못했습니다: {api_message}",
            suggestion=(
                ".env의 GEMINI_MODEL을 확인해주세요. "
                "추천: gemini-2.5-flash 또는 gemini-2.5-flash-lite."
            ),
            http_status=404,
        )

    if status == 429:
        # rate limit / quota — Google이 메시지에 RPM/RPD 정보를 줌
        api_lower = api_message.lower()
        is_daily = "per day" in api_lower or "daily" in api_lower or "rpd" in api_lower
        is_minute = "per minute" in api_lower or "rpm" in api_lower
        if is_daily:
            sub = "일일 한도 도달"
            sugg = (
                "오늘은 더 이상 요청할 수 없어요. 한국 시간 오후 4~5시(태평양 자정) 이후 리셋됩니다. "
                "지금 바로 쓰고 싶다면 .env에서 GEMINI_MODEL=gemini-2.5-flash-lite 또는 gemini-2.5-flash로 바꿔보세요."
            )
        elif is_minute:
            sub = "분당 한도 도달"
            sugg = "1~2분 기다린 후 다시 시도해주세요."
        else:
            sub = "사용량 한도 도달"
            sugg = (
                "1~2분 기다려보고, 그래도 안 되면 일일 한도일 가능성이 높아요. "
                ".env의 GEMINI_MODEL을 gemini-2.5-flash-lite 또는 gemini-2.5-flash로 바꿔보세요. "
                "또는 Google AI Studio(aistudio.google.com)에서 결제 수단을 등록하면 한도가 풀립니다(과금 없이도)."
            )
        return AIServiceError(
            code="rate_limited",
            title=f"AI 사용량 한도에 걸렸어요 ({sub})",
            message=f"Google: {api_message}",
            suggestion=sugg,
            http_status=429,
        )

    if status in (500, 502, 503, 504):
        return AIServiceError(
            code="upstream_unavailable",
            title="AI 서버가 일시적으로 불안정해요",
            message=f"Gemini 서버 오류({status}): {api_message}",
            suggestion="잠시 후 다시 시도해주세요. Google 측 일시적 장애일 수 있습니다.",
            http_status=502,
        )

    return AIServiceError(
        code=f"http_{status}",
        title=f"AI 평가 중 알 수 없는 오류가 발생했어요 ({status})",
        message=api_message,
        suggestion="잠시 후 다시 시도해주세요.",
        http_status=502,
    )


def _coerce_int(v) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# 별점 스케일 — 0~6 정수로 클램프.
SCORE_MIN = 0
SCORE_MAX = 6
RUBRIC_KEYS = ("skill_fit", "depth", "concreteness", "breadth")
SECTION_KEYS = ("campus_activity", "external_activity", "certificate", "award", "project")


def _coerce_score(v) -> Optional[int]:
    """0~6 정수로 클램프. 0.5 같은 소수가 와도 반올림. 음수/None/문자열은 None."""
    if v is None:
        return None
    try:
        n = round(float(v))
    except (TypeError, ValueError):
        return None
    return max(SCORE_MIN, min(SCORE_MAX, n))


def _coerce_score_dict(v, allowed_keys: tuple[str, ...]) -> dict[str, int]:
    """allowed_keys 만 추려 0~6 정수로 정규화. 누락 키는 0 으로 채움."""
    if not isinstance(v, dict):
        return {k: 0 for k in allowed_keys}
    out: dict[str, int] = {}
    for k in allowed_keys:
        s = _coerce_score(v.get(k))
        out[k] = s if s is not None else 0
    return out


def _coerce_str_list(v) -> list[str]:
    if not isinstance(v, list):
        return []
    return [str(x) for x in v if x]


def _coerce_str_dict(v) -> dict[str, str]:
    if not isinstance(v, dict):
        return {}
    return {str(k): str(val) for k, val in v.items() if val}
