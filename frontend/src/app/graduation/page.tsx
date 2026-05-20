"use client"

import { useState, useEffect, useRef } from "react"
import { getCurrentSemester } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, BookOpen, Clock,
  Loader2, Plus, Pencil, Trash2, X, Search, RotateCcw, ArrowUpDown,
  CalendarPlus, MoreHorizontal, Check,
} from "lucide-react"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { historyApi, coursesApi, usersApi } from "@/lib/api"
import { isMajorCourse } from "@/lib/constants/course-data"
import type { HistoryItem, Course, User } from "@/types"

const OCR_PENDING_KEY = "ocrPending"
const OCR_TIMEOUT_MS = 5 * 60 * 1000

// 학번별 졸업 요건 (전공·총 이수 학점).
// 현재 모든 학번이 22학번 기준(전공 72 / 총 130)을 사용 — 다른 학번 요건이 확정되는 대로
// GRAD_REQUIREMENTS 에 학번 → { major, total } 한 줄씩 추가하면 그 학번만 덮어쓰기됨.
type GradRequirement = { major: number; total: number }
const DEFAULT_REQUIREMENT: GradRequirement = { major: 72, total: 130 }
const GRAD_REQUIREMENTS: Record<number, GradRequirement> = {
  // 22: { major: 72, total: 130 },  // 22학번 — 현재 DEFAULT 와 동일해서 명시 생략
}

// student_id (예: 20221234) → 학번 두 자리 (22) → 졸업요건.
function getRequirement(studentId: number | undefined): GradRequirement {
  if (!studentId) return DEFAULT_REQUIREMENT
  const yearTwoDigit = Math.floor(studentId / 10000) % 100
  return GRAD_REQUIREMENTS[yearTwoDigit] ?? DEFAULT_REQUIREMENT
}

type SemesterGroup = {
  year: number | null
  semester: number | null
  items: HistoryItem[]
}

type ModalState = {
  mode: "add" | "edit"
  historyId?: number
  year: number | null
  semester: number | null
  initIsRetake?: boolean
}

const SEASONAL_YEARS = Array.from({ length: 7 }, (_, i) => 2020 + i)

// '기타' 모달 — 특수 과목 (수시·군이러닝).
// 백엔드 app/services/special_courses_service.py 의 SPECIAL_COURSES 와 동기 유지.
type EtcCourse = {
  code: string
  name: string
  semesters: (3 | 4)[]  // 3=하계, 4=동계 — 백엔드 시드된 학기만 선택 가능
}
const ETC_COURSES: EtcCourse[] = [
  { code: "ABC0001", name: "기초인공지능프로그래밍(수시)", semesters: [4] },
  { code: "ABC0002", name: "군이러닝취득교과목I", semesters: [3, 4] },
  { code: "ABC0003", name: "군이러닝취득교과목II", semesters: [3, 4] },
  { code: "ABC0004", name: "군이러닝취득교과목III", semesters: [3, 4] },
]

// 동치 그룹 — 백엔드 COURSE_EQUIV_GROUPS 와 동기 유지.
// 학점 합산·중복 제거 시 같은 그룹의 코드들을 한 키로 묶는다.
const COURSE_EQUIV_GROUPS: string[][] = [
  ["ABC0001", "COR1010"],
]
const equivKeyOf = (code: string): string => {
  for (const group of COURSE_EQUIV_GROUPS) {
    if (group.includes(code)) return group[0]
  }
  return code
}

const semesterDisplay = (s: number | null): string => {
  if (s === 3) return "하계학기"
  if (s === 4) return "동계학기"
  if (s == null) return ""
  return `${s}학기`
}

const isSeasonal = (s: number | null) => s === 3 || s === 4

// 학사 일정 순서: 1학기(봄) → 하계(3) → 2학기(가을) → 동계(4)
const SEMESTER_RANK: Record<number, number> = { 1: 0, 3: 1, 2: 2, 4: 3 }
const semesterRank = (s: number | null) => (s == null ? 99 : SEMESTER_RANK[s] ?? s)
const chronoKey = (year: number | null, semester: number | null) =>
  (year ?? 0) * 4 + semesterRank(semester)

export default function GraduationPage() {
  const router = useRouter()
  const [histories, setHistories] = useState<HistoryItem[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [ocrPending, setOcrPending] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialCountRef = useRef<number>(0)

  // ── 모달 상태 ──────────────────────────────────────────
  const [modal, setModal] = useState<ModalState | null>(null)
  const [seasonalPicker, setSeasonalPicker] = useState<{
    year: number
    semester: 3 | 4
  } | null>(null)
  const [etcPicker, setEtcPicker] = useState<{
    year: number
    semester: 3 | 4
    selected: string[]  // 체크된 ETC_COURSES.code
  } | null>(null)
  const [etcSaving, setEtcSaving] = useState(false)
  const [etcError, setEtcError] = useState<string | null>(null)
  const [modalCourses, setModalCourses] = useState<Course[]>([])
  const [modalSearch, setModalSearch] = useState("")
  const [modalSelected, setModalSelected] = useState<Course | null>(null)
  const [modalIsRetake, setModalIsRetake] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)

  // ── 삭제 확인 상태 ─────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // ── 전체 초기화 확인 상태 ──────────────────────────────
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  // ── 정렬 방향 (기본: 내림차순) ─────────────────────────
  const [sortDesc, setSortDesc] = useState(true)

  // ── 초기 로드 + OCR 폴링 ───────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("access_token")
    if (!token) {
      router.replace("/login")
      setIsLoading(false)
      return
    }

    const raw = localStorage.getItem(OCR_PENDING_KEY)

    // 학번 기반 졸업요건 룩업용으로 유저 정보도 함께 로드.
    usersApi.me().then(setUser).catch(() => {})

    historyApi
      .getMyHistories()
      .then((data) => {
        setHistories(data)
        setIsLoading(false)

        if (!raw) return
        const { ts } = JSON.parse(raw) as { ts: number }
        if (Date.now() - ts >= OCR_TIMEOUT_MS) {
          localStorage.removeItem(OCR_PENDING_KEY)
          return
        }

        setOcrPending(true)
        initialCountRef.current = data.length

        pollingRef.current = setInterval(() => {
          historyApi
            .getMyHistories()
            .then((fresh) => {
              const elapsed = Date.now() - ts
              if (fresh.length !== initialCountRef.current || elapsed >= OCR_TIMEOUT_MS) {
                setHistories(fresh)
                setOcrPending(false)
                localStorage.removeItem(OCR_PENDING_KEY)
                if (pollingRef.current) clearInterval(pollingRef.current)
              }
            })
            .catch(() => {})
        }, 10_000)
      })
      .catch(() => setIsLoading(false))

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // ── 모달 열릴 때 과목 목록 로드 ───────────────────────
  useEffect(() => {
    if (!modal) return
    setModalSearch("")
    setModalSelected(null)
    setModalIsRetake(modal.initIsRetake ?? false)
    setModalLoading(true)

    const params: { year?: number; semester?: number } = {}
    if (modal.year != null) params.year = modal.year
    if (modal.semester != null) params.semester = modal.semester

    coursesApi
      .list(params)
      .then(setModalCourses)
      .catch(() => setModalCourses([]))
      .finally(() => setModalLoading(false))
  }, [modal])

  // ── 모달 저장 ──────────────────────────────────────────
  const handleModalSave = async () => {
    if (!modal || !modalSelected || modalSaving) return
    setModalSaving(true)
    try {
      if (modal.mode === "edit" && modal.historyId != null) {
        await historyApi.remove(modal.historyId)
      }

      const targetYear = modal.year ?? new Date().getFullYear()
      const targetSemester = modal.semester ?? 1
      const seasonalAdd = modal.mode === "add" && isSeasonal(modal.semester)

      let isRetake = modalIsRetake
      let toFlip: HistoryItem[] = []

      if (seasonalAdd) {
        // 같은 과목코드의 기존 이수 이력
        const sameCourse = histories.filter(
          (h) => h.course_code === modalSelected.course_code
        )
        const newKey = chronoKey(targetYear, targetSemester)
        const earlierExists = sameCourse.some(
          (h) => chronoKey(h.year, h.semester) < newKey
        )

        if (earlierExists) {
          // 새 계절학기 이전에 이미 이수 → 재수강
          isRetake = true
        } else {
          // 새 계절학기가 가장 이른 이수 → 초수강, 기존 항목 중 false인 것을 true로 변경
          isRetake = false
          toFlip = sameCourse.filter(
            (h) => !h.is_retake && chronoKey(h.year, h.semester) > newKey
          )
        }
      }

      await historyApi.add({
        course_code: modalSelected.course_code,
        year: targetYear,
        semester: targetSemester,
        is_retake: isRetake,
      })

      for (const h of toFlip) {
        await historyApi.update(h.id, { is_retake: true })
      }

      const fresh = await historyApi.getMyHistories()
      setHistories(fresh)
      setModal(null)
    } catch (e) {
      console.error(e)
    } finally {
      setModalSaving(false)
    }
  }

  // ── 기타 모달 일괄 저장 ────────────────────────────────
  const handleEtcSave = async () => {
    if (!etcPicker || etcSaving || etcPicker.selected.length === 0) return
    setEtcSaving(true)
    setEtcError(null)
    try {
      // 같은 학기·같은 코드는 백엔드가 중복 차단 — 한 건이라도 실패하면 모달 상단에 메시지.
      const failed: string[] = []
      for (const code of etcPicker.selected) {
        try {
          await historyApi.add({
            course_code: code,
            year: etcPicker.year,
            semester: etcPicker.semester,
          })
        } catch (e) {
          const name = ETC_COURSES.find((c) => c.code === code)?.name ?? code
          failed.push(name)
          console.error(`기타 과목 추가 실패: ${code}`, e)
        }
      }
      const fresh = await historyApi.getMyHistories()
      setHistories(fresh)
      if (failed.length > 0) {
        setEtcError(`이미 같은 학기에 등록되어 있습니다: ${failed.join(", ")}`)
      } else {
        setEtcPicker(null)
      }
    } finally {
      setEtcSaving(false)
    }
  }

  // ── 전체 초기화 ───────────────────────────────────────
  const handleResetAll = async () => {
    if (resetting) return
    setResetting(true)
    try {
      await historyApi.removeAll()
      setHistories([])
      setConfirmReset(false)
    } catch (e) {
      console.error(e)
    } finally {
      setResetting(false)
    }
  }

  // ── 삭제 ──────────────────────────────────────────────
  const handleDelete = async (historyId: number) => {
    try {
      await historyApi.remove(historyId)
      setHistories((prev: HistoryItem[]) => prev.filter((h: HistoryItem) => h.id !== historyId))
    } catch (e) {
      console.error(e)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  // ── 그룹핑 ────────────────────────────────────────────
  const creditOf = (h: HistoryItem) => h.course?.credits ?? 3

  // 재수강은 학점 합산에 추가하지 않는다. 같은 course_code (또는 동치 그룹) 안에서 시간순
  // 가장 최근 row 한 개만 학점·과목 수에 반영.
  const latestByCode = new Map<string, HistoryItem>()
  for (const h of histories) {
    const key = equivKeyOf(h.course_code)
    const prev = latestByCode.get(key)
    if (
      !prev ||
      chronoKey(h.year, h.semester) > chronoKey(prev.year, prev.semester)
    ) {
      latestByCode.set(key, h)
    }
  }
  const dedupedHistories = Array.from(latestByCode.values())

  const majorCredits = dedupedHistories
    .filter((h) => isMajorCourse(h.course_code))
    .reduce((sum, h) => sum + creditOf(h), 0)
  const totalCredits = dedupedHistories.reduce((sum, h) => sum + creditOf(h), 0)

  const groupMap = histories.reduce((acc: Record<string, SemesterGroup>, h: HistoryItem) => {
    const key = `${h.year ?? "null"}-${h.semester ?? "null"}`
    if (!acc[key]) acc[key] = { year: h.year, semester: h.semester, items: [] }
    acc[key].items.push(h)
    return acc
  }, {} as Record<string, SemesterGroup>)

  const semesterGroups: SemesterGroup[] = (Object.values(groupMap) as SemesterGroup[]).sort(
    (a: SemesterGroup, b: SemesterGroup) => {
      if (a.year === null) return 1
      if (b.year === null) return -1
      const ka = chronoKey(a.year, a.semester)
      const kb = chronoKey(b.year, b.semester)
      return sortDesc ? kb - ka : ka - kb
    }
  )

  // ── 모달 과목 필터 ─────────────────────────────────────
  const filtered = modalSearch.trim()
    ? modalCourses.filter(
        (c: Course) =>
          c.course_name.includes(modalSearch) ||
          c.course_code.toLowerCase().includes(modalSearch.toLowerCase())
      )
    : modalCourses

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="flex h-14 items-center relative">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>이전</span>
            </button>
            <Link
              href="/dashboard"
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2"
            >
              <BookOpen className="h-5 w-5 flex-shrink-0" style={{ color: "#B0232A" }} />
              <span className="text-xl font-semibold text-foreground tracking-tight font-logo">서간표</span>
            </Link>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        <div className="flex flex-col gap-8">
          <div className="border-l-2 pl-4" style={{ borderColor: "#B0232A" }}>
            <h1 className="text-lg font-semibold text-foreground">
              나의 이수 현황
            </h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              지금까지 이수한 전공·교양 과목과 학점을 확인하세요.
            </p>
          </div>

          {/* OCR 진행 중 배너 */}
          {ocrPending && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                이수 과목 인식 중입니다. 잠시 후 자동으로 반영됩니다.
              </p>
            </div>
          )}

          {/* Summary Cards — 학번 기반 졸업요건 대비 진행도 */}
          {(() => {
            const req = getRequirement(user?.student_id)
            const majorPct = Math.min(100, Math.round((majorCredits / req.major) * 100))
            const totalPct = Math.min(100, Math.round((totalCredits / req.total) * 100))
            return (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      이수 전공 학점
                    </span>
                    <span className="text-xs text-muted-foreground">{majorPct}%</span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-3">
                    <p className="text-3xl font-bold text-foreground">{majorCredits}</p>
                    <p className="text-base text-muted-foreground">
                      <span className="mx-0.5">/</span>
                      {req.major}
                      <span className="ml-1 text-sm">학점</span>
                    </p>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${majorPct}%`, backgroundColor: "#B0232A" }}
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      총 이수 학점
                    </span>
                    <span className="text-xs text-muted-foreground">{totalPct}%</span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-3">
                    <p className="text-3xl font-bold text-foreground">{totalCredits}</p>
                    <p className="text-base text-muted-foreground">
                      <span className="mx-0.5">/</span>
                      {req.total}
                      <span className="ml-1 text-sm">학점</span>
                    </p>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${totalPct}%`, backgroundColor: "#B0232A" }}
                    />
                  </div>
                </div>
              </div>
            )
          })()}

          {/* History List */}
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-base font-semibold text-foreground">상세 이수 내역</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setSeasonalPicker({
                      year: new Date().getFullYear(),
                      semester: 3,
                    })
                  }
                  className="flex items-center gap-1 text-xs text-white border border-transparent rounded px-2.5 py-1 transition-colors hover:opacity-90"
                  style={{ backgroundColor: "#B0232A" }}
                >
                  <CalendarPlus className="h-3 w-3" />
                  계절학기 추가
                </button>
                <button
                  onClick={() =>
                    setEtcPicker({
                      year: new Date().getFullYear(),
                      semester: 4,
                      selected: [],
                    })
                  }
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2.5 py-1 hover:bg-muted transition-colors"
                >
                  <MoreHorizontal className="h-3 w-3" />
                  기타
                </button>
                <button
                  onClick={() => setSortDesc((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2.5 py-1 hover:bg-muted transition-colors"
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {sortDesc ? "최신순" : "오래된순"}
                </button>
                <button
                  onClick={() => setConfirmReset(true)}
                  disabled={histories.length === 0}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-50 border border-border rounded px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
                >
                  <RotateCcw className="h-3 w-3" />
                  초기화
                </button>
              </div>
            </div>
            {isLoading ? (
              <div className="rounded-lg border border-border bg-card py-20 text-center text-sm text-muted-foreground">
                로딩 중...
              </div>
            ) : histories.length === 0 ? (
              <div className="rounded-lg border border-border bg-card py-20 text-center text-sm text-muted-foreground">
                이수 내역이 없습니다. 시간표를 업로드해보세요!
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {(() => {
                  const regularGroups = semesterGroups.filter((g) => !isSeasonal(g.semester))
                  return semesterGroups.map((group) => {
                    const seasonal = isSeasonal(group.semester)
                    let headerLabel: string
                    let subLabel: string | null = null
                    if (seasonal) {
                      headerLabel = "계절학기"
                      subLabel = group.year
                        ? `(${group.year}년 ${semesterDisplay(group.semester)})`
                        : `(${semesterDisplay(group.semester)})`
                    } else {
                      const regIdx = regularGroups.indexOf(group)
                      const pos = sortDesc ? regularGroups.length - regIdx : regIdx + 1
                      headerLabel = `${pos}학기`
                      subLabel =
                        group.year && group.semester
                          ? `(${group.year}년 ${semesterDisplay(group.semester)})`
                          : null
                    }
                    return (
                  <div
                    key={`${group.year}-${group.semester}`}
                    className="overflow-hidden rounded-lg border border-border bg-card"
                  >
                    {/* 학기 헤더 */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          {headerLabel}
                        </span>
                        {subLabel && (
                          <span className="text-xs text-muted-foreground">{subLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {group.items.reduce((s, h) => s + (h.course?.credits ?? 3), 0)}학점 ·{" "}
                          {group.items.length}과목
                        </span>
                        <button
                          onClick={() =>
                            setModal({
                              mode: "add",
                              year: group.year,
                              semester: group.semester,
                            })
                          }
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-0.5 hover:bg-muted"
                        >
                          <Plus className="h-3 w-3" />
                          추가
                        </button>
                      </div>
                    </div>

                    {/* 과목 목록 */}
                    <div className="divide-y divide-border">
                      {group.items.map((h: HistoryItem) => (
                        <div
                          key={h.id}
                          className="px-4 py-2.5 hover:bg-muted/20 transition-colors"
                        >
                          {/* 1줄 레이아웃: 과목정보 | 버튼 */}
                          <div className="flex items-center gap-2 min-w-0">
                            {/* 과목명 */}
                            <span className="text-sm font-medium text-foreground truncate min-w-0 flex-shrink">
                              {h.course?.course_name || "알 수 없는 과목"}
                            </span>
                            {/* 과목코드 */}
                            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                              {h.course_code}
                            </span>
                            {/* 학점 */}
                            <span className="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {h.course?.credits ?? 3}학점
                            </span>
                            {/* 카테고리 */}
                            {h.course?.course_category && (
                              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex-shrink-0 hidden sm:inline">
                                {h.course.course_category}
                              </span>
                            )}
                            {/* 재수강 */}
                            {h.is_retake && (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 flex-shrink-0">
                                재수강
                              </span>
                            )}

                            {/* 수정/삭제 버튼 (오른쪽 끝) */}
                            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
                              {confirmDeleteId === h.id ? (
                                <>
                                  <button
                                    onClick={() => handleDelete(h.id)}
                                    className="flex items-center gap-1 text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded transition-colors"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    삭제확인
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border transition-colors"
                                  >
                                    취소
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() =>
                                      setModal({
                                        mode: "edit",
                                        historyId: h.id,
                                        year: h.year,
                                        semester: h.semester,
                                        initIsRetake: h.is_retake,
                                      })
                                    }
                                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted px-2 py-1 rounded transition-colors border border-border"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    수정
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(h.id)}
                                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors border border-border"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    삭제
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                    )
                  })
                })()}
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4">
          <p className="text-xs text-muted-foreground/60 text-center">
            서간표 - {getCurrentSemester().label}
          </p>
        </div>
      </footer>

      {/* ── 과목 선택 모달 ───────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => e.target === e.currentTarget && !modalSaving && setModal(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[85vh]">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {modal.mode === "add" ? "과목 추가" : "과목 수정"}
                </h3>
                {modal.year && modal.semester && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {modal.year}년 {semesterDisplay(modal.semester)}
                  </p>
                )}
              </div>
              <button
                onClick={() => !modalSaving && setModal(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 검색 */}
            <div className="px-5 py-3 border-b border-border flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="과목명 또는 과목코드 검색"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-[#B0232A]"
                  autoFocus
                />
              </div>
            </div>

            {/* 과목 목록 */}
            <div className="flex-1 overflow-y-auto">
              {modalLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>과목 목록 로딩 중...</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {modalSearch ? "검색 결과가 없습니다." : "해당 학기 과목이 없습니다."}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((course) => {
                    const isSelected = modalSelected?.course_id === course.course_id
                    return (
                      <button
                        key={course.course_id}
                        onClick={() => setModalSelected(isSelected ? null : course)}
                        className={`w-full text-left px-5 py-3 transition-colors hover:bg-muted/40 ${
                          isSelected ? "bg-red-50 border-l-2 border-l-[#B0232A]" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-medium truncate ${
                                isSelected ? "text-[#B0232A]" : "text-foreground"
                              }`}
                            >
                              {course.course_name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-mono text-muted-foreground">
                                {course.course_code}
                              </span>
                              {course.professor?.name && (
                                <span className="text-xs text-muted-foreground">
                                  {course.professor.name}
                                </span>
                              )}
                              {course.course_category && (
                                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                  {course.course_category}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {course.credits ?? 3}학점
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 재수강 토글 + 저장 */}
            <div className="px-5 py-4 border-t border-border flex-shrink-0 flex flex-col gap-3">
              {!(modal.mode === "add" && isSeasonal(modal.semester)) && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={modalIsRetake}
                    onClick={() => setModalIsRetake((v) => !v)}
                    className={`relative h-5 w-9 rounded-full transition-colors flex-shrink-0 ${
                      modalIsRetake ? "bg-amber-400" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        modalIsRetake ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    재수강
                  </span>
                </label>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => !modalSaving && setModal(null)}
                  className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                  disabled={modalSaving}
                >
                  취소
                </button>
                <button
                  onClick={handleModalSave}
                  disabled={!modalSelected || modalSaving}
                  className="flex-1 h-9 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "#B0232A" }}
                >
                  {modalSaving ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      저장 중
                    </span>
                  ) : (
                    modal.mode === "add" ? "추가" : "수정 완료"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 전체 초기화 확인 모달 ────────────────────────── */}
      {confirmReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => e.target === e.currentTarget && !resetting && setConfirmReset(false)}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-xl">
            <div className="px-5 py-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-red-500" />
                <h3 className="text-base font-semibold text-foreground">
                  이수 기록 초기화
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                정말 초기화 하겠습니까?
                <br />
                모든 이수 기록이 삭제되어 0학점이 됩니다. 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-border flex gap-2">
              <button
                onClick={() => !resetting && setConfirmReset(false)}
                disabled={resetting}
                className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleResetAll}
                disabled={resetting}
                className="flex-1 h-9 rounded-md text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resetting ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    초기화 중
                  </span>
                ) : (
                  "초기화"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 계절학기 선택 모달 ───────────────────────────── */}
      {seasonalPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => e.target === e.currentTarget && setSeasonalPicker(null)}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <CalendarPlus className="h-4 w-4" style={{ color: "#B0232A" }} />
                계절학기 선택
              </h3>
              <button
                onClick={() => setSeasonalPicker(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  년도
                </label>
                <select
                  value={seasonalPicker.year}
                  onChange={(e) =>
                    setSeasonalPicker({
                      ...seasonalPicker,
                      year: Number(e.target.value),
                    })
                  }
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-[#B0232A]"
                >
                  {SEASONAL_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  학기
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([3, 4] as const).map((s) => {
                    const active = seasonalPicker.semester === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setSeasonalPicker({ ...seasonalPicker, semester: s })
                        }
                        className={`h-9 rounded-md text-sm border transition-colors ${
                          active
                            ? "text-white border-transparent"
                            : "text-muted-foreground border-border hover:bg-muted"
                        }`}
                        style={active ? { backgroundColor: "#B0232A" } : undefined}
                      >
                        {semesterDisplay(s)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-border flex gap-2">
              <button
                onClick={() => setSeasonalPicker(null)}
                className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  const { year, semester } = seasonalPicker
                  setSeasonalPicker(null)
                  setModal({ mode: "add", year, semester })
                }}
                className="flex-1 h-9 rounded-md text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: "#B0232A" }}
              >
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 기타 과목 선택 모달 ──────────────────────────── */}
      {etcPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => e.target === e.currentTarget && !etcSaving && setEtcPicker(null)}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <MoreHorizontal className="h-4 w-4" style={{ color: "#B0232A" }} />
                기타 과목 선택
              </h3>
              <button
                onClick={() => !etcSaving && setEtcPicker(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              {etcError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">
                  {etcError}
                </p>
              )}

              {/* 과목 체크리스트 */}
              <div className="flex flex-col gap-1.5">
                {ETC_COURSES.map((c) => {
                  const available = c.semesters.includes(etcPicker.semester)
                  const checked = etcPicker.selected.includes(c.code)
                  return (
                    <button
                      key={c.code}
                      type="button"
                      disabled={!available}
                      onClick={() => {
                        setEtcError(null)
                        setEtcPicker({
                          ...etcPicker,
                          selected: checked
                            ? etcPicker.selected.filter((x) => x !== c.code)
                            : [...etcPicker.selected, c.code],
                        })
                      }}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors ${
                        !available
                          ? "border-border bg-muted/30 opacity-40 cursor-not-allowed"
                          : checked
                          ? "border-[#B0232A] bg-red-50"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-transparent text-white"
                            : "border-border bg-background"
                        }`}
                        style={checked ? { backgroundColor: "#B0232A" } : undefined}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {c.name}
                        </p>
                        <p className="text-[11px] font-mono text-muted-foreground">
                          {c.code} · 3학점 · 교양
                        </p>
                      </div>
                      {!available && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          하계 미개설
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 년도 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  년도
                </label>
                <select
                  value={etcPicker.year}
                  onChange={(e) =>
                    setEtcPicker({
                      ...etcPicker,
                      year: Number(e.target.value),
                    })
                  }
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-[#B0232A]"
                >
                  {SEASONAL_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
              </div>

              {/* 학기 토글 — 학기 바꾸면 그 학기에 없는 과목은 자동 해제 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  학기
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([3, 4] as const).map((s) => {
                    const active = etcPicker.semester === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setEtcPicker({
                            ...etcPicker,
                            semester: s,
                            selected: etcPicker.selected.filter((code) => {
                              const def = ETC_COURSES.find((c) => c.code === code)
                              return def?.semesters.includes(s) ?? false
                            }),
                          })
                        }
                        className={`h-9 rounded-md text-sm border transition-colors ${
                          active
                            ? "text-white border-transparent"
                            : "text-muted-foreground border-border hover:bg-muted"
                        }`}
                        style={active ? { backgroundColor: "#B0232A" } : undefined}
                      >
                        {semesterDisplay(s)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-border flex gap-2">
              <button
                onClick={() => !etcSaving && setEtcPicker(null)}
                disabled={etcSaving}
                className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleEtcSave}
                disabled={etcSaving || etcPicker.selected.length === 0}
                className="flex-1 h-9 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#B0232A" }}
              >
                {etcSaving ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    추가 중
                  </span>
                ) : (
                  `${etcPicker.selected.length}개 추가`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
