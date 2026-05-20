"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  BookOpen,
  Save,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Award,
  Trophy,
  GraduationCap,
  Briefcase,
  FolderGit2,
  AlertCircle,
  X,
  Star,
  StarHalf,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  portfolioApi,
  isApiError,
  type ApiError,
  type PortfolioBulkItem,
  type PortfolioEvaluation,
  type PortfolioKind,
} from "@/lib/api"

type SectionConfig = {
  kind: PortfolioKind
  label: string
  icon: typeof Award
  type: "text" | "dated"
  placeholder: string
}

const SECTIONS: SectionConfig[] = [
  {
    kind: "campus_activity",
    label: "교내활동",
    icon: GraduationCap,
    type: "text",
    placeholder: "예: 컴퓨터공학과 학생회 임원 (2024.03 ~ 2024.12) — 신입생 멘토링, 학과 행사 기획",
  },
  {
    kind: "external_activity",
    label: "교외활동",
    icon: Briefcase,
    type: "text",
    placeholder: "예: ABC 기업 백엔드 개발 인턴십 (2024.07 ~ 2024.08) — Spring Boot 기반 사내 시스템 개발",
  },
  {
    kind: "certificate",
    label: "자격증",
    icon: Award,
    type: "dated",
    placeholder: "예: 정보처리기사",
  },
  {
    kind: "award",
    label: "수상내역",
    icon: Trophy,
    type: "dated",
    placeholder: "예: 교내 해커톤 대상",
  },
  {
    kind: "project",
    label: "프로젝트",
    icon: FolderGit2,
    type: "text",
    placeholder: "예: 서간표 - 시간표 추천 웹 서비스 (Next.js + FastAPI). OCR로 강의계획서 자동 분석 기능 담당.",
  },
]

// 4 차원 rubric 라벨 — 백엔드 ai_service.RUBRIC_KEYS 와 동기 유지.
const RUBRIC_DIMENSIONS: { key: string; label: string; hint: string }[] = [
  { key: "skill_fit",    label: "기술 적합도", hint: "목표 직무 핵심 기술과의 부합도" },
  { key: "depth",        label: "경험 깊이",   hint: "단순 참여 vs 주도/장기 vs 결과 산출" },
  { key: "concreteness", label: "구체성",      hint: "정량 지표·임팩트의 명시 여부" },
  { key: "breadth",      label: "다양성",      hint: "활동 유형 분포" },
]

// score: 0~6 정수를 받아 0~3 별점(0.5 단위) 으로 표시.
function StarRating({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const stars = (score ?? 0) / 2  // 0~3.0 (0.5 단위)
  const dims = size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3 w-3" : "h-4 w-4"
  const items = [0, 1, 2].map((i) => {
    const remaining = stars - i
    if (remaining >= 1) return "full" as const
    if (remaining >= 0.5) return "half" as const
    return "empty" as const
  })
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${stars.toFixed(1)}/3 별점`}>
      {items.map((kind, i) => {
        if (kind === "full") {
          return <Star key={i} className={dims} fill="#F5A623" stroke="#F5A623" />
        }
        if (kind === "half") {
          return (
            <span key={i} className="relative inline-block">
              <Star className={dims} stroke="#F5A623" fill="none" />
              <StarHalf
                className={`${dims} absolute inset-0`}
                fill="#F5A623"
                stroke="#F5A623"
              />
            </span>
          )
        }
        return <Star key={i} className={dims} stroke="#D4D4D8" fill="none" />
      })}
    </span>
  )
}

type LocalEntry = {
  localId: string
  serverId: number | null
  title: string
  content: string
  entryDate: string
}

function newLocalEntry(): LocalEntry {
  return {
    localId: Math.random().toString(36).slice(2),
    serverId: null,
    title: "",
    content: "",
    entryDate: "",
  }
}

export default function PortfolioPage() {
  const router = useRouter()

  const [sections, setSections] = useState<Record<PortfolioKind, LocalEntry[]>>({
    campus_activity: [newLocalEntry()],
    external_activity: [newLocalEntry()],
    certificate: [newLocalEntry()],
    award: [newLocalEntry()],
    project: [newLocalEntry()],
  })

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  const [evaluation, setEvaluation] = useState<PortfolioEvaluation | null>(null)
  const [evalError, setEvalError] = useState<{
    title: string
    message: string
    suggestion?: string
    code?: string
  } | null>(null)

  const evalRef = useRef<HTMLDivElement>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPolling = evaluation?.status === "pending" || evaluation?.status === "running"

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const startPolling = (id: number) => {
    stopPolling()
    pollTimerRef.current = setInterval(async () => {
      try {
        const latest = await portfolioApi.getEvaluation(id)
        setEvaluation(latest)
        if (latest.status === "completed" || latest.status === "failed") {
          stopPolling()
          if (latest.status === "failed" && latest.error_message) {
            try {
              const parsed = JSON.parse(latest.error_message) as {
                code?: string
                title?: string
                message?: string
                suggestion?: string
              }
              setEvalError({
                title: parsed.title || "평가에 실패했어요",
                message: parsed.message || "알 수 없는 오류",
                suggestion: parsed.suggestion,
                code: parsed.code,
              })
            } catch {
              setEvalError({ title: "평가에 실패했어요", message: latest.error_message })
            }
          }
          if (latest.status === "completed") {
            setTimeout(
              () => evalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
              100,
            )
          }
        }
      } catch {
        // 일시적 네트워크 에러 — 폴링 계속
      }
    }, 2500)
  }

  // 언마운트 시 폴링 정리
  useEffect(() => {
    return () => stopPolling()
  }, [])

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    if (!token) {
      router.replace("/login")
      return
    }

    Promise.all([portfolioApi.getMine(), portfolioApi.getLatestEvaluation()])
      .then(([data, latestEval]) => {
        const next: Record<PortfolioKind, LocalEntry[]> = {
          campus_activity: [],
          external_activity: [],
          certificate: [],
          award: [],
          project: [],
        }
        for (const cfg of SECTIONS) {
          const items = data[cfg.kind] ?? []
          if (items.length === 0) {
            next[cfg.kind] = [newLocalEntry()]
          } else {
            next[cfg.kind] = items.map((it) => ({
              localId: Math.random().toString(36).slice(2),
              serverId: it.id,
              title: it.title ?? "",
              content: it.content ?? "",
              entryDate: it.entry_date ?? "",
            }))
          }
        }
        setSections(next)
        if (latestEval) {
          setEvaluation(latestEval)
          // 페이지를 떠났다 돌아왔을 때 진행 중인 평가가 있으면 폴링 재개
          if (latestEval.status === "pending" || latestEval.status === "running") {
            startPolling(latestEval.id)
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const updateEntry = (kind: PortfolioKind, localId: string, patch: Partial<LocalEntry>) => {
    setSections((prev) => ({
      ...prev,
      [kind]: prev[kind].map((e) => (e.localId === localId ? { ...e, ...patch } : e)),
    }))
  }

  const addEntry = (kind: PortfolioKind) => {
    setSections((prev) => ({ ...prev, [kind]: [...prev[kind], newLocalEntry()] }))
  }

  const removeEntry = (kind: PortfolioKind, localId: string) => {
    setSections((prev) => {
      const filtered = prev[kind].filter((e) => e.localId !== localId)
      // 마지막 1개는 빈칸 유지
      return { ...prev, [kind]: filtered.length === 0 ? [newLocalEntry()] : filtered }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: Record<PortfolioKind, PortfolioBulkItem[]> = {
        campus_activity: [],
        external_activity: [],
        certificate: [],
        award: [],
        project: [],
      }
      for (const cfg of SECTIONS) {
        const items: PortfolioBulkItem[] = []
        sections[cfg.kind].forEach((e, idx) => {
          const isEmpty = !e.title.trim() && !e.content.trim() && !e.entryDate.trim()
          if (isEmpty && e.serverId == null) return
          items.push({
            id: e.serverId,
            title: e.title.trim() || null,
            content: e.content.trim() || null,
            entry_date: e.entryDate.trim() || null,
            order_index: idx,
          })
        })
        payload[cfg.kind] = items
      }
      const updated = await portfolioApi.bulkSave(payload)
      // 서버 응답으로 serverId 동기화
      const next: Record<PortfolioKind, LocalEntry[]> = {
        campus_activity: [],
        external_activity: [],
        certificate: [],
        award: [],
        project: [],
      }
      for (const cfg of SECTIONS) {
        const items = updated[cfg.kind] ?? []
        if (items.length === 0) {
          next[cfg.kind] = [newLocalEntry()]
        } else {
          next[cfg.kind] = items.map((it) => ({
            localId: Math.random().toString(36).slice(2),
            serverId: it.id,
            title: it.title ?? "",
            content: it.content ?? "",
            entryDate: it.entry_date ?? "",
          }))
        }
      }
      setSections(next)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      alert(err instanceof Error ? err.message : "저장에 실패했습니다.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleEvaluate = async () => {
    setEvalError(null)
    try {
      // 평가 전에 자동 저장
      await handleSave()
      const pending = await portfolioApi.evaluate()
      setEvaluation(pending)
      // 백그라운드 처리 시작 → 2.5초마다 상태 폴링
      startPolling(pending.id)
    } catch (err) {
      if (isApiError(err)) {
        const e = err as ApiError
        setEvalError({
          title: e.title || "평가 요청에 실패했어요",
          message: e.message,
          suggestion: e.suggestion,
          code: e.code,
        })
      } else {
        setEvalError({
          title: "평가 요청에 실패했어요",
          message: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
        })
      }
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      </div>
    )
  }

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
            <Button
              onClick={handleSave}
              disabled={isSaving}
              size="sm"
              className="ml-auto h-8 gap-1.5"
              style={{ backgroundColor: "#B0232A" }}
            >
              {savedFlash ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  저장됨
                </>
              ) : isSaving ? (
                "저장 중..."
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  저장
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        <div className="flex flex-col gap-8">
          <div className="border-l-2 pl-4" style={{ borderColor: "#B0232A" }}>
            <h1 className="text-lg font-semibold text-foreground">내 포트폴리오</h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              교내·교외활동, 자격증, 수상내역, 프로젝트를 기록하고 AI에게 진로 평가를 받으세요.
            </p>
          </div>

          {/* AI 평가 박스 */}
          <section
            className="rounded-lg border p-5"
            style={{
              borderColor: "rgba(176, 35, 42, 0.3)",
              backgroundColor: "rgba(176, 35, 42, 0.04)",
            }}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5" style={{ color: "#B0232A" }} />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">AI 진로 평가</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    프로필의 관심분야·목표 직무를 기준으로 포트폴리오를 평가합니다.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleEvaluate}
                disabled={isPolling}
                size="sm"
                className="h-9 gap-1.5"
                style={{ backgroundColor: "#B0232A" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isPolling
                  ? evaluation?.status === "running"
                    ? "AI가 분석 중..."
                    : "평가 대기 중..."
                  : "평가받기"}
              </Button>
            </div>
          </section>

          {/* 에러 박스 */}
          {evalError && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">
                      {evalError.title}
                    </h3>
                    <button
                      onClick={() => setEvalError(null)}
                      className="text-red-500 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                      aria-label="에러 닫기"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 leading-relaxed">
                    {evalError.message}
                  </p>
                  {evalError.suggestion && (
                    <div className="mt-3 rounded-md bg-red-100/60 dark:bg-red-900/20 px-3 py-2">
                      <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
                        💡 해결 방법
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                        {evalError.suggestion}
                      </p>
                    </div>
                  )}
                  {evalError.code && (
                    <p className="mt-2 text-[10px] text-red-500/70 font-mono">
                      code: {evalError.code}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 평가 진행 상태 (pending/running) */}
          {evaluation && isPolling && (
            <div
              className="rounded-lg border p-5 flex items-center gap-4"
              style={{
                borderColor: "rgba(176, 35, 42, 0.3)",
                backgroundColor: "rgba(176, 35, 42, 0.04)",
              }}
            >
              <div
                className="h-9 w-9 flex-shrink-0 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "#B0232A", borderTopColor: "transparent" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {evaluation.status === "pending"
                    ? "팀 서버에 평가 요청을 접수했어요"
                    : "AI가 포트폴리오를 분석하고 있어요"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  10~30초 정도 소요됩니다. 페이지를 떠났다가 돌아와도 결과를 확인할 수 있어요.
                </p>
              </div>
            </div>
          )}

          {/* 평가 결과 (completed만) */}
          {evaluation && evaluation.status === "completed" && (
            <section
              ref={evalRef}
              className="rounded-lg border border-border bg-card p-6 space-y-5"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">평가 결과</h2>
                <span className="text-xs text-muted-foreground">
                  {new Date(evaluation.created_at).toLocaleString("ko-KR")}
                </span>
              </div>

              {evaluation.alignment_score != null && (
                <div className="flex flex-col gap-4">
                  {/* 종합 별점 + 요약 */}
                  <div className="flex items-center gap-4">
                    <div
                      className="flex flex-col items-center justify-center rounded-lg w-24 h-24 flex-shrink-0"
                      style={{ backgroundColor: "rgba(176, 35, 42, 0.08)" }}
                    >
                      <span className="text-xl font-bold" style={{ color: "#B0232A" }}>
                        {(evaluation.alignment_score / 2).toFixed(1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground mb-1">/ 3.0</span>
                      <StarRating score={evaluation.alignment_score} size="sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        목표 직무 정합성 (종합)
                      </div>
                      {evaluation.summary && (
                        <p className="text-sm text-foreground leading-relaxed">
                          {evaluation.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 4 차원 rubric breakdown */}
                  {Object.keys(evaluation.rubric).length > 0 && (
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">
                        채점 항목별 점수
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {RUBRIC_DIMENSIONS.map((dim) => {
                          const raw = evaluation.rubric[dim.key] ?? 0
                          return (
                            <div
                              key={dim.key}
                              className="flex items-center justify-between gap-3 px-2 py-1.5 rounded bg-background/60"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-foreground">
                                  {dim.label}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {dim.hint}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <StarRating score={raw} size="sm" />
                                <span className="text-xs font-mono text-muted-foreground tabular-nums">
                                  {(raw / 2).toFixed(1)}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {evaluation.strengths.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-foreground mb-3">강점</h3>
                  <ul className="space-y-2">
                    {evaluation.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-foreground leading-relaxed pl-4 relative">
                        <span className="absolute left-0">·</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation.weaknesses.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-foreground mb-3">부족한 점</h3>
                  <ul className="space-y-2">
                    {evaluation.weaknesses.map((s, i) => (
                      <li key={i} className="text-sm text-foreground leading-relaxed pl-4 relative">
                        <span className="absolute left-0">·</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation.suggestions.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-foreground mb-3">다음 단계 제안</h3>
                  <ul className="space-y-2">
                    {evaluation.suggestions.map((s, i) => (
                      <li key={i} className="text-sm text-foreground leading-relaxed pl-4 relative">
                        <span className="absolute left-0">·</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(Object.keys(evaluation.by_section).length > 0 ||
                Object.keys(evaluation.section_scores).length > 0) && (
                <div>
                  <h3 className="text-base font-bold text-foreground mb-3">섹션별 평가</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SECTIONS.map((cfg) => {
                      const comment = evaluation.by_section[cfg.kind]
                      const sectionScore = evaluation.section_scores[cfg.kind]
                      if (!comment && sectionScore == null) return null
                      return (
                        <div
                          key={cfg.kind}
                          className="rounded-md border border-border bg-muted/30 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <cfg.icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm font-semibold text-foreground truncate">
                                {cfg.label}
                              </span>
                            </div>
                            {sectionScore != null && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <StarRating score={sectionScore} size="sm" />
                                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                  {(sectionScore / 2).toFixed(1)}
                                </span>
                              </div>
                            )}
                          </div>
                          {comment && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {comment}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 5개 섹션 */}
          {SECTIONS.map((cfg) => (
            <section
              key={cfg.kind}
              className="rounded-lg border border-border bg-card p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <cfg.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{cfg.label}</h2>
                    <p className="text-xs text-muted-foreground">
                      {sections[cfg.kind].length}개 항목
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => addEntry(cfg.kind)}
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  style={{ color: "#B0232A", borderColor: "#B0232A" }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  추가
                </Button>
              </div>

              <div className="space-y-3">
                {sections[cfg.kind].map((entry, idx) => (
                  <div
                    key={entry.localId}
                    className="rounded-md border border-border bg-background/50 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 space-y-2">
                        {cfg.type === "dated" ? (
                          <>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <Input
                                value={entry.title}
                                onChange={(e) =>
                                  updateEntry(cfg.kind, entry.localId, { title: e.target.value })
                                }
                                placeholder={`이름 (${cfg.placeholder})`}
                                className="text-sm"
                              />
                              <Input
                                type="date"
                                value={entry.entryDate}
                                onChange={(e) =>
                                  updateEntry(cfg.kind, entry.localId, {
                                    entryDate: e.target.value,
                                  })
                                }
                                className="text-sm sm:w-44"
                              />
                            </div>
                          </>
                        ) : (
                          <textarea
                            value={entry.content}
                            onChange={(e) =>
                              updateEntry(cfg.kind, entry.localId, { content: e.target.value })
                            }
                            placeholder={cfg.placeholder}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                          />
                        )}
                      </div>
                      <button
                        onClick={() => removeEntry(cfg.kind, entry.localId)}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-500 transition-colors"
                        title="삭제"
                        aria-label={`${cfg.label} ${idx + 1}번째 항목 삭제`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* 하단 저장 버튼 */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="h-10 gap-2 px-6"
              style={{ backgroundColor: "#B0232A" }}
            >
              {savedFlash ? (
                <>
                  <Check className="h-4 w-4" />
                  저장됨
                </>
              ) : isSaving ? (
                "저장 중..."
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  포트폴리오 저장
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
