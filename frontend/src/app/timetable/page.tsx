"use client"

import { useState, useRef, useEffect } from "react"
import { getCurrentSemester } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Upload, CheckCircle, BookOpen, X, Pencil, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/layout/theme-toggle"

const START_YEAR = 2020
const SEMESTERS = [1, 2] as const

type PendingSlot = {
  file: File
  previewUrl: string
  year: number
  semester: number
}

export default function TimetablePage() {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => START_YEAR + i)

  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [pendingSlots, setPendingSlots] = useState<Record<string, PendingSlot>>({})
  const [submitting, setSubmitting] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    if (!token) router.replace("/login")
  }, [router])

  // 언마운트 시 object URL 정리
  const pendingSlotsRef = useRef(pendingSlots)
  pendingSlotsRef.current = pendingSlots
  useEffect(() => {
    return () => {
      Object.values(pendingSlotsRef.current as Record<string, PendingSlot>).forEach(s =>
        URL.revokeObjectURL(s.previewUrl)
      )
    }
  }, [])

  const slotKey = (year: number, semester: number) => `${year}-${semester}`

  const handleFileSelect = (year: number, semester: number, file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!["jpg", "jpeg", "png"].includes(ext ?? "")) return

    const key = slotKey(year, semester)
    const existing = pendingSlots[key]
    if (existing) URL.revokeObjectURL(existing.previewUrl)

    const previewUrl = URL.createObjectURL(file)
    setPendingSlots((prev: Record<string, PendingSlot>) => ({
      ...prev,
      [key]: { file, previewUrl, year, semester },
    }))
  }

  const removeSlot = (year: number, semester: number) => {
    const key = slotKey(year, semester)
    const existing = pendingSlots[key]
    if (existing) URL.revokeObjectURL(existing.previewUrl)
    setPendingSlots((prev: Record<string, PendingSlot>) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    const ref = inputRefs.current[key]
    if (ref) ref.value = ""
  }

  const pendingCount = Object.keys(pendingSlots).length

  const handleSubmit = async () => {
    if (pendingCount === 0 || submitting) return
    setSubmitting(true)

    const entries = Object.values(pendingSlots) as PendingSlot[]
    const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"
    const token = localStorage.getItem("access_token")
    let anySuccess = false

    for (const slot of entries) {
      try {
        const formData = new FormData()
        formData.append("file", slot.file)
        formData.append("year", String(slot.year))
        formData.append("semester", String(slot.semester))

        const res = await fetch(`${BASE_URL}/upload/course-image`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        })
        if (res.status === 202 || res.ok) anySuccess = true
      } catch (e) {
        console.error("Upload error:", e)
      }
    }

    if (anySuccess) {
      localStorage.setItem("ocrPending", JSON.stringify({ ts: Date.now() }))
    }

    setSubmitting(false)
    router.push("/graduation")
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
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

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="flex flex-col gap-6">
          <div className="border-l-2 pl-4" style={{ borderColor: "#B0232A" }}>
            <h1 className="text-lg font-semibold text-foreground">시간표 업로드</h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              이수한 학기의 <strong>시간표</strong>를 모두 선택한 후 최종 제출하세요.
            </p>
          </div>

          {/* Year scroll bar */}
          <div className="flex overflow-x-auto gap-2 pb-1" style={{ scrollbarWidth: "thin" }}>
            {years.map(year => {
              const hasSlot = SEMESTERS.some(s => !!pendingSlots[slotKey(year, s)])
              return (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className={`relative flex-shrink-0 px-8 py-2.5 rounded text-sm font-semibold transition-colors ${
                    selectedYear === year
                      ? "text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                  style={selectedYear === year ? { backgroundColor: "#B0232A" } : {}}
                >
                  {year}
                  {hasSlot && (
                    <span
                      className="absolute top-1 right-1 h-2 w-2 rounded-full bg-green-500"
                      title="이미지 선택됨"
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Semester upload slots */}
          <div className="grid grid-cols-2 gap-6">
            {SEMESTERS.map(semester => {
              const key = slotKey(selectedYear, semester)
              const slot = pendingSlots[key]

              return (
                <div key={key} className="flex flex-col gap-2">
                  <div className="flex justify-center">
                    <span
                      className="px-6 py-1.5 rounded text-sm font-medium text-white"
                      style={{ backgroundColor: "#B0232A" }}
                    >
                      {semester}학기
                    </span>
                  </div>

                  <div
                    className={`relative overflow-hidden rounded-lg border-2 transition-colors ${
                      slot
                        ? "border-green-400"
                        : submitting
                        ? "border-border bg-muted/30 opacity-60 cursor-not-allowed"
                        : "border-border bg-muted/40 hover:border-[#B0232A] hover:bg-muted/60 cursor-pointer"
                    }`}
                    style={{ minHeight: "240px" }}
                    onClick={() => !slot && !submitting && inputRefs.current[key]?.click()}
                  >
                    {slot ? (
                      <>
                        {/* 이미지 미리보기 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={slot.previewUrl}
                          alt={`${selectedYear}년 ${semester}학기 시간표`}
                          className="w-full h-full object-contain bg-muted/20"
                          style={{ display: "block", maxHeight: "360px" }}
                        />
                        {/* 오버레이 버튼 */}
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center gap-3 group">
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-white/90 hover:bg-white text-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow"
                            onClick={e => { e.stopPropagation(); inputRefs.current[key]?.click() }}
                          >
                            <Pencil className="h-3 w-3" />
                            수정
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-white/90 hover:bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-full shadow"
                            onClick={e => { e.stopPropagation(); removeSlot(selectedYear, semester) }}
                          >
                            <X className="h-3 w-3" />
                            삭제
                          </button>
                        </div>
                        {/* 완료 배지 */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                          <CheckCircle className="h-3 w-3" />
                          선택됨
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-4">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">이미지 선택</span>
                        <span className="text-xs text-muted-foreground/60">JPG, PNG</span>
                      </div>
                    )}

                    <input
                      ref={el => { inputRefs.current[key] = el }}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      disabled={submitting}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(selectedYear, semester, file)
                        e.target.value = ""
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* 전체 선택 현황 요약 */}
          {pendingCount > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-medium text-foreground mb-2">
                선택된 시간표 <span className="font-bold">{pendingCount}개</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.values(pendingSlots)
                  .sort((a, b) => a.year !== b.year ? a.year - b.year : a.semester - b.semester)
                  .map(slot => (
                    <span
                      key={slotKey(slot.year, slot.semester)}
                      className="inline-flex items-center gap-1 text-xs bg-muted px-2.5 py-1 rounded-full text-muted-foreground"
                    >
                      {slot.year}년 {slot.semester}학기
                      <button
                        onClick={() => removeSlot(slot.year, slot.semester)}
                        className="ml-0.5 hover:text-foreground transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* 최종 제출 버튼 */}
          <Button
            onClick={handleSubmit}
            disabled={pendingCount === 0 || submitting}
            className="w-full h-12 text-sm font-semibold"
            style={{ backgroundColor: pendingCount > 0 && !submitting ? "#B0232A" : undefined }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                업로드 중... ({pendingCount}개)
              </span>
            ) : (
              <span className="flex items-center justify-center">
                {pendingCount > 0
                  ? `${pendingCount}개 시간표 최종 제출`
                  : "시간표를 선택해주세요"}
              </span>
            )}
          </Button>

          {/* Instructions */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">업로드 안내</h3>
            <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
              <li>
                <span>에브리타임에서 해당 학기 <strong>시간표</strong> 전체 화면을 캡처해주세요.</span>
              </li>
              <li>
                <span>과목명과 시간표 전체가 잘리지 않고 명확히 보여야 정확한 인식이 가능합니다.</span>
              </li>
              <li>
                <span>이수한 모든 학기를 해당 년도/학기에 업로드 후 <strong>최종 제출</strong>을 누르면 시간표 인식이 시작됩니다.</span>
              </li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4">
          <p className="text-xs text-muted-foreground/60 text-center">
            서간표 - {getCurrentSemester().label}
          </p>
        </div>
      </footer>
    </div>
  )
}
