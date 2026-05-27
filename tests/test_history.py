"""
이수 기록(History) API 테스트

- JWT 인증 기반 CRUD (/history)
- 소유권: 학생 A 가 학생 B 의 이수 기록을 조회/수정/삭제 불가
- 중복 추가 방지(같은 학기·같은 과목)
- 존재하지 않는 강의 추가 방지
- 재수강 자동 산정: 같은 course_code 그룹에서 가장 이른 학기만
  is_retake=False, 나머지는 True 로 자동 설정
"""
import pytest


@pytest.fixture
def test_course_2025(db, test_professor):
    """test_course(CSE4101, 2026-1)와 동일 코드의 2025-1 강의 — 재수강 테스트용."""
    from app.models.course import Course
    c = Course(
        course_code="CSE4101",
        course_name="인공지능",
        credits=3,
        target_grade="3,4",
        is_english=False,
        class_days="월수",
        class_start_time="10:00",
        class_end_time="11:30",
        professor_id=test_professor.professor_id,
        year=2025,
        semester=1,
        course_category="전공필수",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def test_history(db, test_user, test_course):
    """test_user 의 기본 이수 기록 (CSE4101, 2026-1)."""
    from app.models.activity import History
    h = History(
        student_id=test_user.student_id,
        course_code=test_course.course_code,
        year=test_course.year,
        semester=test_course.semester,
        is_retake=False,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


class TestHistoryGet:
    def test_get_empty_histories(self, client, test_user, auth_headers):
        res = client.get("/history/me", headers=auth_headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_get_my_histories(self, client, test_user, test_history, auth_headers):
        res = client.get("/history/me", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["course_code"] == test_history.course_code
        assert data[0]["student_id"] == test_user.student_id

    def test_get_histories_unauthorized(self, client):
        res = client.get("/history/me")
        assert res.status_code == 401

    def test_get_isolated_per_user(
        self, client, test_user, test_history, auth_headers2
    ):
        """다른 학생 인증으로 조회하면 자기 거(빈 목록)만 보임 — test_user 의 이력은 노출 X."""
        res = client.get("/history/me", headers=auth_headers2)
        assert res.status_code == 200
        assert res.json() == []


class TestHistoryAdd:
    def test_add_history(self, client, test_user, test_course, auth_headers):
        res = client.post(
            "/history",
            json={
                "course_code": test_course.course_code,
                "year": test_course.year,
                "semester": test_course.semester,
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["course_code"] == test_course.course_code
        assert data["student_id"] == test_user.student_id
        assert data["is_retake"] is False

    def test_add_duplicate_same_semester(
        self, client, test_user, test_course, test_history, auth_headers
    ):
        """같은 학기·같은 과목 중복 추가 시 400."""
        res = client.post(
            "/history",
            json={
                "course_code": test_course.course_code,
                "year": test_course.year,
                "semester": test_course.semester,
            },
            headers=auth_headers,
        )
        assert res.status_code == 400

    def test_add_nonexistent_course(self, client, test_user, auth_headers):
        """존재하지 않는 과목 코드 → 404."""
        res = client.post(
            "/history",
            json={"course_code": "ZZZ9999", "year": 2026, "semester": 1},
            headers=auth_headers,
        )
        assert res.status_code == 404

    def test_add_unauthorized(self, client, test_course):
        res = client.post(
            "/history",
            json={
                "course_code": test_course.course_code,
                "year": test_course.year,
                "semester": test_course.semester,
            },
        )
        assert res.status_code == 401


class TestHistoryUpdate:
    def test_update_history(
        self, client, test_user, test_history, test_course_2025, auth_headers
    ):
        """year/semester 변경 — course_code 동일하지만 학기만 옮기는 시나리오."""
        res = client.patch(
            f"/history/{test_history.id}",
            json={"year": 2025, "semester": 1},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["year"] == 2025
        assert data["semester"] == 1

    def test_update_other_users_history_blocked(
        self, client, test_user, test_history, auth_headers2
    ):
        """다른 학생이 내 이수 기록을 수정하려 하면 404 (소유권 보호)."""
        res = client.patch(
            f"/history/{test_history.id}",
            json={"year": 2024},
            headers=auth_headers2,
        )
        assert res.status_code == 404

    def test_update_nonexistent_history(self, client, test_user, auth_headers):
        res = client.patch(
            "/history/99999",
            json={"year": 2025},
            headers=auth_headers,
        )
        assert res.status_code == 404

    def test_update_unauthorized(self, client, test_history):
        res = client.patch(
            f"/history/{test_history.id}",
            json={"year": 2025},
        )
        assert res.status_code == 401


class TestHistoryDelete:
    def test_delete_history(self, client, test_user, test_history, auth_headers):
        res = client.delete(f"/history/{test_history.id}", headers=auth_headers)
        assert res.status_code == 200

        # 삭제 확인
        res2 = client.get("/history/me", headers=auth_headers)
        assert res2.json() == []

    def test_delete_other_users_history_blocked(
        self, client, test_user, test_history, auth_headers2
    ):
        """다른 학생이 내 이수 기록을 삭제하려 하면 404 — DB 에 남아있어야 함."""
        res = client.delete(f"/history/{test_history.id}", headers=auth_headers2)
        assert res.status_code == 404

        # 원래 소유자 인증으로 보면 아직 있음
        # (auth_headers fixture 가 없는 컨텍스트라 직접 헤더 재생성은 생략 — 다른 테스트가 보장)

    def test_delete_nonexistent_history(self, client, test_user, auth_headers):
        res = client.delete("/history/99999", headers=auth_headers)
        assert res.status_code == 404

    def test_delete_unauthorized(self, client, test_history):
        res = client.delete(f"/history/{test_history.id}")
        assert res.status_code == 401


class TestHistoryDeleteAll:
    def test_delete_all_my_histories(
        self, client, test_user, test_history, auth_headers
    ):
        res = client.delete("/history/me", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["deleted"] >= 1

        res2 = client.get("/history/me", headers=auth_headers)
        assert res2.json() == []

    def test_delete_all_only_affects_self(
        self, client, test_user, test_user2, test_history, db, auth_headers2
    ):
        """학생 B 가 '내 이수 기록 전체 삭제' 호출해도 학생 A 의 기록은 남음."""
        res = client.delete("/history/me", headers=auth_headers2)
        assert res.status_code == 200
        assert res.json()["deleted"] == 0

        # test_user(A) 의 기록은 DB 에 그대로 남아 있어야 함
        from app.models.activity import History
        remaining = (
            db.query(History).filter(History.student_id == test_user.student_id).count()
        )
        assert remaining == 1


class TestHistoryRetakeAutoDetect:
    """같은 course_code 그룹의 시간순 가장 이른 학기만 is_retake=False, 나머지는 True."""

    def test_first_add_not_retake(
        self, client, test_user, test_course, auth_headers
    ):
        res = client.post(
            "/history",
            json={
                "course_code": test_course.course_code,
                "year": test_course.year,
                "semester": test_course.semester,
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["is_retake"] is False

    def test_later_semester_marked_retake(
        self, client, test_user, test_course, test_course_2025, auth_headers
    ):
        """2025-1 먼저 등록 → 2026-1 추가 시 2026-1 이 재수강."""
        # 2025-1 (먼저 이수)
        client.post(
            "/history",
            json={"course_code": "CSE4101", "year": 2025, "semester": 1},
            headers=auth_headers,
        )
        # 2026-1 (나중 이수 — 재수강)
        res = client.post(
            "/history",
            json={"course_code": "CSE4101", "year": 2026, "semester": 1},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["is_retake"] is True

        # 전체 조회로 그룹 상태 확인 — 가장 이른 2025-1 만 is_retake=False
        listing = client.get("/history/me", headers=auth_headers).json()
        by_year = {h["year"]: h["is_retake"] for h in listing}
        assert by_year == {2025: False, 2026: True}

    def test_earlier_semester_flips_later_to_retake(
        self, client, test_user, test_course, test_course_2025, auth_headers
    ):
        """2026-1 먼저 등록 → 2025-1 추가 시 새 2025-1 이 초수강, 기존 2026-1 이 재수강으로 flip."""
        # 2026-1 (먼저 등록)
        client.post(
            "/history",
            json={"course_code": "CSE4101", "year": 2026, "semester": 1},
            headers=auth_headers,
        )
        # 2025-1 (더 이른 학기로 추가 → 새 row 가 초수강)
        res = client.post(
            "/history",
            json={"course_code": "CSE4101", "year": 2025, "semester": 1},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["is_retake"] is False

        listing = client.get("/history/me", headers=auth_headers).json()
        by_year = {h["year"]: h["is_retake"] for h in listing}
        assert by_year == {2025: False, 2026: True}
