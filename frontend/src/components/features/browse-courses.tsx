"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { Search, Plus, Heart, X, ExternalLink, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, BookOpen } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { type Course, isMajorCourse } from "@/lib/constants/course-data"
import { type SlotChar, displaySlotName } from "@/lib/api"

const SLOTS: SlotChar[] = ["A", "B", "C", "D"]

interface BrowseCoursesProps {
  majorCourses: Course[]
  liberalCourses: Course[]
  /** cart(관심 과목)에 담긴 강의 id 집합 — 하트 색상에 사용 */
  wishlistIds: Set<string>
  /** 각 강의가 들어있는 슬롯 목록 — 슬롯 버튼 disable/하이라이트 용 */
  slotMemberships?: Record<string, SlotChar[]>
  /** 슬롯별 사용자 별명 — dropdown 라벨에 표시 (없으면 기본 A/B/C/D) */
  slotNames?: Record<SlotChar, string | null>
  /** 하트 클릭 — cart 토글 */
  onToggleWishlist: (id: string) => void
  /** 슬롯 선택 클릭 — 시간표에 추가 */
  onAddToSlot: (id: string, slot: SlotChar) => void
  /** 교양 데이터가 아직 안 받아졌으면 부모가 fetch 하도록 알림 */
  onLiberalRequested?: () => void
  /** 현재 로딩 중인 division — UX 표시용 */
  loadingDivision?: "major" | "liberal" | null
}

type Division = "major" | "liberal"

export function BrowseCourses({
  majorCourses,
  liberalCourses,
  wishlistIds,
  slotMemberships,
  slotNames,
  onToggleWishlist,
  onAddToSlot,
  onLiberalRequested,
  loadingDivision,
}: BrowseCoursesProps) {
  const [query, setQuery] = useState("")
  const [confirmedQuery, setConfirmedQuery] = useState("")
  const [division, setDivision] = useState<Division>("major")
  const [page, setPage] = useState(1)
  const [expandedSlotRow, setExpandedSlotRow] = useState<string | null>(null)
  const PAGE_SIZE = 10
  const tableRef = useRef<HTMLDivElement>(null)

  const sourceCourses = division === "major" ? majorCourses : liberalCourses
  const isLoadingThis = loadingDivision === division && sourceCourses.length === 0

  const filtered = sourceCourses.filter((c) => {
    const q = confirmedQuery.toLowerCase()
    if (!q) return true
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.professor.toLowerCase().includes(q)
    )
  })

  const changeDivision = (d: Division) => {
    setDivision(d)
    setPage(1)
    tableRef.current?.scrollTo({ top: 0 })
    if (d === "liberal") onLiberalRequested?.()
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSearch = () => {
    setConfirmedQuery(query)
    setPage(1)
    tableRef.current?.scrollTo({ top: 0 })
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-4 w-4 flex-shrink-0" style={{ color: "#B0232A" }} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">26학년도 1학기 과목검색</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length}개 / {sourceCourses.length}개 과목
              {isLoadingThis && <span className="ml-1.5 text-muted-foreground/50">로딩 중...</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto items-center">
          <div className="inline-flex rounded-md border border-border overflow-hidden flex-shrink-0">
            {([
              { value: "major", label: "전공" },
              { value: "liberal", label: "교양" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeDivision(opt.value)}
                className={`px-3 h-8 text-xs font-medium transition-colors ${
                  division === opt.value
                    ? "text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                style={division === opt.value ? { backgroundColor: "#B0232A" } : {}}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="과목코드, 과목명, 교수명 검색..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-8 px-3 text-xs flex-shrink-0"
            style={{ backgroundColor: "#B0232A" }}
            onClick={handleSearch}
          >
            검색
          </Button>
        </div>
      </div>

      <div ref={tableRef} className="overflow-visible rounded-md border border-border">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24">
                코드
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                과목명
              </th>
              <th className="hidden sm:table-cell px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">
                교수
              </th>
              <th className="hidden md:table-cell px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32">
                시간
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">

              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              paginated.map((course, i) => {
                const inWishlist = wishlistIds.has(course.id)
                return (
                  <tr
                    key={`${course.id}-${i}`}
                    className={`h-12 border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${
                      i % 2 === 0 ? "" : "bg-muted/10"
                    }`}
                  >
                    <td className="px-4 py-0">
                      <span className="text-xs font-medium text-muted-foreground tracking-wide whitespace-nowrap">
                        {course.code}
                      </span>
                    </td>
                    <td className="px-4 py-0 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/course/${course.id}`}
                          className="text-xs font-medium hover:underline flex items-center gap-1 min-w-0"
                          style={{ color: "#B0232A" } as React.CSSProperties}
                        >
                          <span className="truncate">{course.name}</span>
                          <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                        </Link>
                        <span className="sm:hidden text-xs text-muted-foreground truncate flex-shrink-0">
                          · {course.professor}
                        </span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-0">
                      <span className="text-xs text-foreground whitespace-nowrap truncate block">
                        {course.professor}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-0">
                      <span className="text-xs text-muted-foreground whitespace-nowrap truncate block">
                        {course.schedule}
                      </span>
                    </td>
                    <td className="px-4 py-0 align-middle">
                      <div className="flex h-12 items-center justify-end gap-2">
                        {/* 슬롯 추가 — 추가 버튼 클릭 시 absolute dropdown 으로 슬롯 목록 펼침.
                            테이블 td 폭이 좁아 inline 펼침이 잘렸던 문제 해결을 위해 absolute 사용. */}
                        <div className="relative">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setExpandedSlotRow(expandedSlotRow === course.id ? null : course.id)
                            }
                            className="h-7 px-2.5 text-xs gap-1 hover:bg-accent whitespace-nowrap"
                            style={{ color: "#B0232A", borderColor: "#B0232A" } as React.CSSProperties}
                          >
                            <Plus className="h-3 w-3" />
                            추가
                          </Button>

                          {expandedSlotRow === course.id && (
                            <div
                              className="absolute right-0 top-full mt-1 z-20 flex flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg min-w-[120px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {SLOTS.map((s) => {
                                const inSlot = slotMemberships?.[course.id]?.includes(s) ?? false
                                return (
                                  <button
                                    key={s}
                                    onClick={() => {
                                      if (inSlot) return
                                      onAddToSlot(course.id, s)
                                      setExpandedSlotRow(null)
                                    }}
                                    disabled={inSlot}
                                    className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                                      inSlot
                                        ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
                                        : "hover:bg-muted"
                                    }`}
                                    style={inSlot ? {} : { color: "#B0232A" }}
                                    title={inSlot ? "이미 담김" : `${displaySlotName(s, slotNames?.[s])} 에 추가`}
                                  >
                                    <span>{displaySlotName(s, slotNames?.[s])}</span>
                                    {inSlot ? (
                                      <span className="text-[9px]">담김</span>
                                    ) : (
                                      <Plus className="h-3 w-3 opacity-60" />
                                    )}
                                  </button>
                                )
                              })}
                              <button
                                onClick={() => setExpandedSlotRow(null)}
                                className="mt-0.5 flex items-center justify-center gap-1 rounded border-t border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                              >
                                <X className="h-3 w-3" />
                                닫기
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 하트 — cart(관심 과목) 토글. 테두리 없이 깔끔한 아이콘 버튼. */}
                        <button
                          onClick={() => onToggleWishlist(course.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
                          title={inWishlist ? "관심 과목 해제" : "관심 과목 추가"}
                          aria-label={inWishlist ? "관심 해제" : "관심 추가"}
                        >
                          <Heart
                            className="h-4 w-4"
                            fill={inWishlist ? "#B0232A" : "transparent"}
                            stroke={inWishlist ? "#B0232A" : "currentColor"}
                            strokeWidth={inWishlist ? 0 : 2}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (() => {
        const WINDOW = 10
        const windowStart = Math.floor((page - 1) / WINDOW) * WINDOW + 1
        const windowEnd = Math.min(windowStart + WINDOW - 1, totalPages)
        const pageNums = Array.from(
          { length: windowEnd - windowStart + 1 },
          (_, i) => windowStart + i,
        )
        const prevWindowPage = windowStart - 1
        const nextWindowPage = windowEnd + 1
        return (
          <div className="mt-3 flex items-center justify-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => setPage(1)}
              disabled={page === 1}
              aria-label="첫 페이지"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => setPage(prevWindowPage)}
              disabled={windowStart === 1}
              aria-label="이전 묶음"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {pageNums.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={p === page ? "default" : "outline"}
                className="h-7 w-7 p-0 text-xs"
                style={p === page ? { backgroundColor: "#B0232A" } : {}}
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => setPage(nextWindowPage)}
              disabled={windowEnd === totalPages}
              aria-label="다음 묶음"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              aria-label="마지막 페이지"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })()}
    </section>
  )
}
