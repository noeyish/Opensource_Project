"""Discord webhook 알림 발송 유틸.

운영 알림(Jenkins 빌드)과 분리된 전용 채널 webhook 을 사용해
admin 이 신규 회원가입 신청을 놓치지 않게 한다.

환경변수:
    DISCORD_SIGNUP_WEBHOOK  Discord 서버에서 발급한 webhook URL.
                            미설정 시 알림 함수는 조용히 no-op (회원가입 자체엔 영향 X).

설계:
  - httpx 동기 호출 — FastAPI BackgroundTasks 에서 별도 스레드로 돌아 응답 지연 없음.
  - 실패 시 로그만 남기고 예외 안 던짐 — webhook 깜박여도 회원가입 흐름 유지.
  - 메시지에 비밀번호/토큰 등 민감 정보는 절대 포함 X.
"""
import logging
import os
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

# 서간표 브랜드 컬러 #B0232A → Discord embed color 는 10진수.
_SEOGANPYO_COLOR = 0xB0232A

_SIGNUP_WEBHOOK_ENV = "DISCORD_SIGNUP_WEBHOOK"
_ADMIN_USERS_URL_ENV = "ADMIN_USERS_URL"


def send_signup_notification(name: str, student_id: int, email: str) -> None:
    """신규 회원가입 신청 알림을 Discord 채널로 발송.

    호출자: app.api.auth.register 의 BackgroundTasks.
    실패 시 로그만 남기고 swallow — 호출자에게 예외 안 전달.
    """
    webhook = os.getenv(_SIGNUP_WEBHOOK_ENV, "").strip()
    if not webhook:
        logger.info("%s 미설정 — Discord 알림 스킵 (name=%s)", _SIGNUP_WEBHOOK_ENV, name)
        return

    # admin 페이지 링크 — env 설정된 경우만 클릭 가능 링크로 박음.
    # default 를 코드에 박지 않는 이유: 운영 환경별 URL(스킴/IP/포트) 이 코드 밖에서 관리되어야
    # 하고, 또 http 평문 URL 이 소스에 있으면 SonarCloud 가 시큐리티 hotspot 으로 분류.
    admin_url = os.getenv(_ADMIN_USERS_URL_ENV, "").strip()
    description = (
        f"[관리자 페이지에서 승인]({admin_url})이 필요합니다."
        if admin_url
        else "관리자 페이지에서 승인이 필요합니다."
    )
    payload = {
        "username": "서간표",
        "embeds": [
            {
                "title": "✨ 신규 회원가입 신청",
                "description": description,
                "color": _SEOGANPYO_COLOR,
                "fields": [
                    {"name": "이름", "value": name, "inline": True},
                    {"name": "학번", "value": str(student_id), "inline": True},
                    {"name": "이메일", "value": email, "inline": False},
                ],
                "footer": {"text": "서간표 회원가입 알림"},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }

    try:
        with httpx.Client(timeout=5.0) as client:
            res = client.post(webhook, json=payload)
        if res.status_code >= 300:
            logger.warning(
                "Discord 회원가입 알림 실패: HTTP %s (name=%s, body=%s)",
                res.status_code, name, res.text[:200],
            )
        else:
            logger.info("Discord 회원가입 알림 전송 완료 (name=%s)", name)
    except httpx.RequestError as e:
        logger.warning("Discord 회원가입 알림 네트워크 실패 (name=%s): %s", name, e)
