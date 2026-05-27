"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Calendar, Check, Columns3, Loader2, Pencil, Pin, PinOff, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TimetableGrid } from "@/components/features/timetable-grid"
import { CompareModal } from "@/components/features/compare-modal"
import {
    timetablesApi,
    type SlotChar,
    type Timetable,
    SLOT_LABELS,
    displaySlotName,
} from "@/lib/api"
import type { Course as ApiCourse } from "@/types"
import type { Course } from "@/lib/constants/course-data"

const SLOTS: SlotChar[] = ["A", "B", "C", "D"]
const PINNED_SLOT_KEY = "timetable_pinned_slot"

interface TimetableSlotPanelProps {
    /** 부모(dashboard)가 fetch 한 4 슬롯 데이터 (없으면 빈 배열) */
    timetables: Timetable[]
    /** fetch 진행 중 여부 (로딩 표시용) */
    isLoading?: boolean
    /** API Course → 화면용 Course 변환 (TimetableGrid 가 받는 형태로) */
    mapApiCourse: (c: ApiCourse) => Course
}

/**
 * 4 슬롯 시간표 패널 — 핀(고정), 슬롯 이름 수정, 시간표 비교 모달 트리거.
 *
 * 고정 슬롯은 localStorage 에 저장되어 페이지 재진입 시 자동 활성화.
 * 슬롯 본문은 시간표 그리드 한 개만 (강의 리스트·추가 UI 는 BrowseCourses/Wishlist 쪽).
 */
export function TimetableSlotPanel({ timetables, isLoading, mapApiCourse }: TimetableSlotPanelProps) {
    const queryClient = useQueryClient()
    const [activeSlot, setActiveSlot] = useState<SlotChar>("A")
    const [pinnedSlot, setPinnedSlot] = useState<SlotChar | null>(null)
    const [compareOpen, setCompareOpen] = useState(false)

    // 이름 수정 모드 — null 이면 비활성, SlotChar 면 해당 슬롯 입력 표시.
    const [editingSlot, setEditingSlot] = useState<SlotChar | null>(null)
    const [editValue, setEditValue] = useState("")
    const editInputRef = useRef<HTMLInputElement>(null)

    // 시간표 블록 클릭 → ✕ 클릭 시 해당 슬롯에서 강의 제거
    const removeFromActiveSlot = async (courseId: string) => {
        try {
            await timetablesApi.removeCourse(activeSlot, Number(courseId))
            queryClient.invalidateQueries({ queryKey: ["timetables"] })
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`removeFromActiveSlot(${activeSlot}, ${courseId}) 실패:`, e)
            alert(`${displaySlotName(activeSlot, activeTimetableName)} 슬롯에서 제거 실패\n${msg}`)
        }
    }

    // 페이지 진입 시 localStorage 에서 고정 슬롯 복원
    useEffect(() => {
        if (typeof window === "undefined") return
        const stored = window.localStorage.getItem(PINNED_SLOT_KEY)
        if (stored && SLOTS.includes(stored as SlotChar)) {
            setPinnedSlot(stored as SlotChar)
            setActiveSlot(stored as SlotChar)
        }
    }, [])

    // 편집 모드 진입 시 input 포커스 & 전체 선택
    useEffect(() => {
        if (editingSlot && editInputRef.current) {
            editInputRef.current.focus()
            editInputRef.current.select()
        }
    }, [editingSlot])

    const togglePin = () => {
        if (pinnedSlot === activeSlot) {
            setPinnedSlot(null)
            window.localStorage.removeItem(PINNED_SLOT_KEY)
        } else {
            setPinnedSlot(activeSlot)
            window.localStorage.setItem(PINNED_SLOT_KEY, activeSlot)
        }
    }

    const activeTimetable = useMemo<Timetable | null>(
        () => timetables.find((t) => t.slot === activeSlot) ?? null,
        [timetables, activeSlot],
    )
    const activeTimetableName = activeTimetable?.name ?? null

    const slotCourses = useMemo<Course[]>(() => {
        if (!activeTimetable) return []
        return activeTimetable.courses
            .filter((c) => c.course)
            .map((c) => mapApiCourse(c.course!))
    }, [activeTimetable, mapApiCourse])

    const slotCountMap = useMemo(() => {
        const m: Record<SlotChar, number> = { A: 0, B: 0, C: 0, D: 0 }
        for (const t of timetables) m[t.slot] = t.courses.length
        return m
    }, [timetables])

    const slotNameMap = useMemo(() => {
        const m: Record<SlotChar, string | null> = { A: null, B: null, C: null, D: null }
        for (const t of timetables) m[t.slot] = t.name
        return m
    }, [timetables])

    const isPinned = pinnedSlot === activeSlot

    const startEdit = (slot: SlotChar) => {
        setEditingSlot(slot)
        setEditValue(slotNameMap[slot] ?? "")
    }
    const cancelEdit = () => {
        setEditingSlot(null)
        setEditValue("")
    }
    const saveEdit = async () => {
        if (!editingSlot) return
        const next = editValue.trim()
        // 비우면 기본 라벨(A/B/C/D) 로 돌아가게 — 빈 문자열을 그대로 PATCH 한다.
        try {
            await timetablesApi.rename(editingSlot, next)
            queryClient.invalidateQueries({ queryKey: ["timetables"] })
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`rename(${editingSlot}) 실패:`, e)
            alert(`이름 변경 실패\n${msg}`)
            return
        }
        cancelEdit()
    }
    const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault()
            saveEdit()
        } else if (e.key === "Escape") {
            e.preventDefault()
            cancelEdit()
        }
    }

    return (
        <section className="rounded-lg border border-border bg-card p-5">
            {/* 헤더 */}
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <Calendar className="h-4 w-4 flex-shrink-0" style={{ color: "#B0232A" }} />
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-foreground">내 시간표</h2>
                        <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                            슬롯을 고정하면 다음 방문 시 자동 선택됩니다
                        </p>
                    </div>
                </div>
                <Button
                    size="sm"
                    onClick={() => setCompareOpen(true)}
                    className="h-8 gap-1.5 text-xs flex-shrink-0"
                    style={{ backgroundColor: "#B0232A" }}
                >
                    <Columns3 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">시간표 비교</span>
                    <span className="sm:hidden">비교</span>
                </Button>
            </div>

            {/* 슬롯 탭 + 고정/이름수정 버튼 */}
            <div className="mb-4 flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                    {SLOTS.map((s) => {
                        const pinned = pinnedSlot === s
                        const active = activeSlot === s
                        const label = displaySlotName(s, slotNameMap[s])
                        return (
                            <button
                                key={s}
                                onClick={() => setActiveSlot(s)}
                                className={`px-3 h-8 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                                    active
                                        ? "text-white"
                                        : "text-muted-foreground hover:bg-muted"
                                }`}
                                style={active ? { backgroundColor: "#B0232A" } : {}}
                                title={pinned ? `${label} 슬롯은 고정됨` : label}
                            >
                                <span className="font-semibold">{label}</span>
                                {pinned && <Pin className="h-3 w-3" />}
                                <span className="text-[10px] opacity-75">
                                    ({slotCountMap[s]})
                                </span>
                            </button>
                        )
                    })}
                </div>
                {/* 이름 수정 — 활성 슬롯이 편집 중이 아닐 때만 노출 */}
                {editingSlot !== activeSlot && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(activeSlot)}
                        className="h-8 gap-1.5 text-xs"
                        title={`${displaySlotName(activeSlot, slotNameMap[activeSlot])} 이름 변경`}
                    >
                        <Pencil className="h-3 w-3" />
                        <span className="hidden sm:inline">이름 수정</span>
                        <span className="sm:hidden">이름</span>
                    </Button>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    onClick={togglePin}
                    className="h-8 gap-1.5 text-xs"
                    title={isPinned ? "고정 해제" : "이 슬롯 고정 (다음 방문 시 자동 선택)"}
                >
                    {isPinned ? (
                        <>
                            <PinOff className="h-3 w-3" />
                            <span className="hidden sm:inline">고정 해제</span>
                            <span className="sm:hidden">해제</span>
                        </>
                    ) : (
                        <>
                            <Pin className="h-3 w-3" />
                            <span className="hidden sm:inline">이 슬롯 고정</span>
                            <span className="sm:hidden">고정</span>
                        </>
                    )}
                </Button>
            </div>

            {/* 이름 수정 인풋 — 활성 슬롯만 편집 (탭 줄 바로 아래로 펼침) */}
            {editingSlot === activeSlot && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                        {SLOT_LABELS[activeSlot]} 슬롯 이름
                    </span>
                    <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={onEditKey}
                        maxLength={20}
                        placeholder={`기본값: ${SLOT_LABELS[activeSlot]}`}
                        className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-[#B0232A]/30 focus:border-[#B0232A]"
                    />
                    <Button
                        size="sm"
                        onClick={saveEdit}
                        className="h-7 px-2 text-xs gap-1"
                        style={{ backgroundColor: "#B0232A" }}
                    >
                        <Check className="h-3 w-3" />
                        저장
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelEdit}
                        className="h-7 px-2 text-xs gap-1"
                    >
                        <X className="h-3 w-3" />
                        취소
                    </Button>
                </div>
            )}

            {/* 활성 슬롯 시간표 그리드 — 블록 클릭 시 ✕ 제거 버튼 노출 */}
            {isLoading ? (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground mt-2">슬롯 불러오는 중...</p>
                </div>
            ) : (
                <TimetableGrid courses={slotCourses} onRemoveCourse={removeFromActiveSlot} />
            )}

            <p className="mt-3 text-[11px] text-muted-foreground/70">
                ※ 시간표의 강의를 누르면 제거 버튼이 나옵니다. 이름 수정은 기본값(A/B/C/D) 으로 비울 수 있습니다.
            </p>

            <CompareModal
                open={compareOpen}
                onClose={() => setCompareOpen(false)}
                timetables={timetables}
                mapApiCourse={mapApiCourse}
            />
        </section>
    )
}
