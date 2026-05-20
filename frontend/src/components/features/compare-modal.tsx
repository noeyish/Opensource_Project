"use client"

import { useState, useMemo } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TimetableGrid } from "@/components/features/timetable-grid"
import { type SlotChar, type Timetable, SLOT_LABELS, displaySlotName } from "@/lib/api"
import type { Course as ApiCourse } from "@/types"
import type { Course } from "@/lib/constants/course-data"

const SLOTS: SlotChar[] = ["A", "B", "C", "D"]

interface CompareModalProps {
    open: boolean
    onClose: () => void
    timetables: Timetable[]
    mapApiCourse: (c: ApiCourse) => Course
}

/**
 * 4 슬롯 중 2~4개를 선택해 동시에 시간표 그리드로 띄우는 전체 화면 모달.
 *
 * 레이아웃:
 *   - 1개 선택: 단일 (큰 그리드)
 *   - 2개: 좌/우 분할
 *   - 3~4개: 2x2 격자
 */
export function CompareModal({ open, onClose, timetables, mapApiCourse }: CompareModalProps) {
    const [selected, setSelected] = useState<Set<SlotChar>>(new Set(["A", "B"]))

    const slotCounts = useMemo(() => {
        const m: Record<SlotChar, number> = { A: 0, B: 0, C: 0, D: 0 }
        for (const t of timetables) m[t.slot] = t.courses.length
        return m
    }, [timetables])

    const slotNameMap = useMemo(() => {
        const m: Record<SlotChar, string | null> = { A: null, B: null, C: null, D: null }
        for (const t of timetables) m[t.slot] = t.name
        return m
    }, [timetables])

    const selectedTimetables = useMemo(
        () => timetables.filter((t) => selected.has(t.slot)),
        [timetables, selected],
    )

    const toggleSlot = (s: SlotChar) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(s)) next.delete(s)
            else next.add(s)
            return next
        })
    }

    const gridCols =
        selectedTimetables.length <= 1
            ? "grid-cols-1"
            : selectedTimetables.length === 2
              ? "lg:grid-cols-2 grid-cols-1"
              : "lg:grid-cols-2 grid-cols-1"

    if (!open) return null

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-7xl max-h-[92vh] overflow-hidden rounded-lg border border-border bg-background shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 헤더 */}
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">시간표 비교</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            비교할 슬롯을 선택하세요 (최대 4개)
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onClose}
                        className="h-8 w-8 p-0"
                        aria-label="닫기"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* 슬롯 선택 토글 */}
                <div className="border-b border-border px-5 py-3 flex gap-2 flex-wrap items-center">
                    {SLOTS.map((s) => {
                        const isSelected = selected.has(s)
                        const empty = slotCounts[s] === 0
                        return (
                            <button
                                key={s}
                                onClick={() => toggleSlot(s)}
                                disabled={empty}
                                className={`px-4 h-9 text-sm font-medium rounded-md border transition-colors flex items-center gap-1.5 ${
                                    isSelected
                                        ? "text-white"
                                        : "text-muted-foreground hover:bg-muted"
                                } ${empty ? "opacity-40 cursor-not-allowed" : ""}`}
                                style={
                                    isSelected
                                        ? { backgroundColor: "#B0232A", borderColor: "#B0232A" }
                                        : { borderColor: "var(--border)" }
                                }
                                title={empty ? "비어있는 슬롯" : ""}
                            >
                                <span className="font-semibold">{displaySlotName(s, slotNameMap[s])}</span>
                                <span className="text-xs opacity-75">({slotCounts[s]})</span>
                            </button>
                        )
                    })}
                    <div className="ml-auto text-xs text-muted-foreground">
                        {selectedTimetables.length} 개 선택됨
                    </div>
                </div>

                {/* 비교 격자 */}
                <div className="flex-1 overflow-auto p-5">
                    {selectedTimetables.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
                            <p className="text-sm text-muted-foreground">
                                위에서 비교할 슬롯을 선택하세요.
                            </p>
                        </div>
                    ) : (
                        <div className={`grid gap-4 ${gridCols}`}>
                            {selectedTimetables.map((t) => {
                                const courses: Course[] = t.courses
                                    .filter((c) => c.course)
                                    .map((c) => mapApiCourse(c.course!))
                                const totalCredits = t.courses.reduce(
                                    (sum, c) => sum + (c.course?.credits ?? 0),
                                    0,
                                )
                                return (
                                    <div key={t.id} className="flex flex-col gap-2 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <div className="flex items-baseline gap-2 min-w-0">
                                                <span
                                                    className="text-base font-bold flex-shrink-0"
                                                    style={{ color: "#B0232A" }}
                                                >
                                                    {displaySlotName(t.slot, t.name)}
                                                </span>
                                                {/* 별명을 쓴 경우 작은 글씨로 원래 슬롯 ID 표기 — 비교 시 어떤 칸이 어떤 슬롯인지 식별 용이 */}
                                                {t.name && t.name.trim() !== SLOT_LABELS[t.slot] && (
                                                    <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                                                        ({SLOT_LABELS[t.slot]})
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground flex-shrink-0">
                                                {courses.length}과목 · {totalCredits}학점
                                            </span>
                                        </div>
                                        <TimetableGrid courses={courses} />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
