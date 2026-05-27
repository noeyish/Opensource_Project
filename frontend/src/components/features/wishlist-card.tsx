"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, X, FileText, UserCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { type Course, isMajorCourse } from "@/lib/constants/course-data"
import { type SlotChar, displaySlotName } from "@/lib/api"

const SLOTS: SlotChar[] = ["A", "B", "C", "D"]

interface WishlistCardProps {
  course: Course
  onRemove: (id: string) => void
  /** 4 슬롯 각각의 별명 (없으면 기본 A/B/C/D). dashboard 가 timetables 에서 추출해 내려줌. */
  slotNames?: Record<SlotChar, string | null>
  /** courseId 기준 들어가있는 슬롯 집합. 이미 담긴 슬롯은 dropdown 에서 disable. */
  inSlots?: SlotChar[]
  /** 슬롯 추가 핸들러. 미지정 시 슬롯 picker 자체를 안 그림(로그인 전 등). */
  onAddToSlot?: (id: string, slot: SlotChar) => void | Promise<void>
}

export function WishlistCard({
  course,
  onRemove,
  slotNames,
  inSlots,
  onAddToSlot,
}: WishlistCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="group flex flex-col gap-3 rounded-md border border-border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
            {course.code}
          </span>
          <h3 className="text-sm font-semibold text-foreground leading-snug text-balance">
            {course.name}
          </h3>
        </div>
        <button
          onClick={() => onRemove(course.id)}
          className="mt-0.5 flex-shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`${course.name} 삭제`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <UserCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{course.professor}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{course.schedule}</span>
        </div>
      </div>

      {/* 시간표 추가 — 4 슬롯 중 선택. 좁은 카드 폭 때문에 absolute dropdown 으로 펼침. */}
      {onAddToSlot && (
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            className="h-7 w-full gap-1.5 text-xs font-medium"
            style={{ color: "#B0232A", borderColor: "#B0232A" } as React.CSSProperties}
          >
            <Plus className="h-3 w-3" />
            시간표에 추가
          </Button>

          {open && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-20 flex flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {SLOTS.map((s) => {
                const isIn = inSlots?.includes(s) ?? false
                const label = displaySlotName(s, slotNames?.[s])
                return (
                  <button
                    key={s}
                    onClick={async () => {
                      if (isIn) return
                      await onAddToSlot(course.id, s)
                      setOpen(false)
                    }}
                    disabled={isIn}
                    className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      isIn
                        ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
                        : "hover:bg-muted"
                    }`}
                    style={isIn ? {} : { color: "#B0232A" }}
                    title={isIn ? "이미 담김" : `${label} 슬롯에 추가`}
                  >
                    <span className="truncate">{label}</span>
                    {isIn ? (
                      <span className="text-[9px] flex-shrink-0">담김</span>
                    ) : (
                      <Plus className="h-3 w-3 opacity-60 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
              <button
                onClick={() => setOpen(false)}
                className="mt-0.5 flex items-center justify-center gap-1 rounded border-t border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
              >
                <X className="h-3 w-3" />
                닫기
              </button>
            </div>
          )}
        </div>
      )}

      {/* 교양 과목은 강의계획서/교수 프로필 데이터가 없어 액션 버튼을 노출하지 않는다. */}
      {isMajorCourse(course.code) && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Button
            asChild
            size="sm"
            className="h-7 flex-1 gap-1.5 text-xs font-medium"
            style={{ backgroundColor: "#B0232A", color: "#fff" }}
          >
            <Link href={`/course/${course.id}?tab=syllabus`}>
              <FileText className="h-3 w-3" />
              강의계획서
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1.5 text-xs font-medium border-border hover:bg-accent"
            style={{ color: "#B0232A", borderColor: "#B0232A" } as React.CSSProperties}
          >
            <Link href={`/course/${course.id}?tab=professor`}>
              <UserCircle className="h-3 w-3" />
              교수 프로필
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
