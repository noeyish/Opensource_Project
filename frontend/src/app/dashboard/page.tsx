"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookOpen, BookMarked, User, Upload, ChevronRight, Settings, GraduationCap, LogOut, Users, Sparkles, MessageSquare } from "lucide-react"
import { WishlistCard } from "@/components/features/wishlist-card"
import { BrowseCourses } from "@/components/features/browse-courses"
import { TimetableSlotPanel } from "@/components/features/timetable-slot-panel"
// NOTE: TimetableGrid 는 이제 TimetableSlotPanel 내부에서 사용됨. dashboard 에선 직접 사용 X.
import type { Course } from "@/lib/constants/course-data"
import { coursesApi, cartApi, usersApi, historyApi, timetablesApi, type SlotChar, type Timetable } from "@/lib/api"
import { getCurrentSemester } from "@/lib/utils"
import { totalCreditsFor } from "@/lib/credit-utils"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import type { Course as ApiCourse, CartItem } from "@/types"

// API 응답 → 컴포넌트가 기대하는 Course 타입으로 변환
function mapApiCourse(c: ApiCourse): Course {
  const categoryMap: Record<string, Course["category"]> = {
    전공필수: "전공필수",
    전공선택: "전공선택",
    교양: "교양",
    일반선택: "일반선택",
  }
  return {
    id: String(c.course_id),
    code: c.course_code,
    name: c.course_name,
    professor: c.professor?.name ?? "-",
    department: c.course_category ?? "",
    schedule: [c.class_days, c.class_start_time, c.class_end_time]
      .filter(Boolean)
      .join(" "),
    category: categoryMap[c.course_category ?? ""] ?? "일반선택",
    days: c.class_days,
    startTime: c.class_start_time,
    endTime: c.class_end_time,
  }
}

const TARGET_YEAR = 2026
const TARGET_SEMESTER = 1

// Query key factory — 다른 페이지에서도 동일 키로 캐시 공유 가능.
const QK = {
  courses: (year: number, semester: number, division: "major" | "liberal") =>
    ["courses", { year, semester, division }] as const,
  cart: ["cart"] as const,
  me: ["users", "me"] as const,
  myHistories: ["histories", "me"] as const,
  timetables: ["timetables"] as const,
}

const fetchCourses = (division: "major" | "liberal") =>
  coursesApi
    .list({ year: TARGET_YEAR, semester: TARGET_SEMESTER, division })
    .then((data) => data.map(mapApiCourse))

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [liberalRequested, setLiberalRequested] = useState(false)

  // 인증 가드 — 토큰 없으면 로그인 페이지로
  useEffect(() => {
    const token = localStorage.getItem("access_token")
    if (!token) router.replace("/login")
  }, [router])

  // React Query 가 mount/unmount 무관하게 캐시를 유지하므로 페이지 이동 후 돌아와도 즉시 hit.
  const majorQuery = useQuery({
    queryKey: QK.courses(TARGET_YEAR, TARGET_SEMESTER, "major"),
    queryFn: () => fetchCourses("major"),
  })
  const liberalQuery = useQuery({
    queryKey: QK.courses(TARGET_YEAR, TARGET_SEMESTER, "liberal"),
    queryFn: () => fetchCourses("liberal"),
    // 사용자가 교양 토글을 누른 적이 있을 때만 활성화. prefetch 가 미리 캐시를 채워놓으므로 hit.
    enabled: liberalRequested,
  })
  const meQuery = useQuery({ queryKey: QK.me, queryFn: () => usersApi.me() })
  const cartQuery = useQuery({ queryKey: QK.cart, queryFn: () => cartApi.get() })
  const historiesQuery = useQuery({
    queryKey: QK.myHistories,
    queryFn: () => historyApi.getMyHistories(),
  })
  const timetablesQuery = useQuery({
    queryKey: QK.timetables,
    queryFn: () => timetablesApi.list(),
  })

  // 전공 fetch 끝나면 교양도 백그라운드 prefetch (캐시에 채워두기)
  useEffect(() => {
    if (majorQuery.isSuccess) {
      queryClient.prefetchQuery({
        queryKey: QK.courses(TARGET_YEAR, TARGET_SEMESTER, "liberal"),
        queryFn: () => fetchCourses("liberal"),
      })
    }
  }, [majorQuery.isSuccess, queryClient])

  const majorCourses = majorQuery.data ?? []
  const liberalCourses = liberalQuery.data ?? []
  const loadingDivision: "major" | "liberal" | null = majorQuery.isPending
    ? "major"
    : liberalCourses.length === 0 &&
      (liberalQuery.isFetching ||
        queryClient.isFetching({
          queryKey: QK.courses(TARGET_YEAR, TARGET_SEMESTER, "liberal"),
        }) > 0)
    ? "liberal"
    : null

  const fetchLiberalIfNeeded = useCallback(() => {
    setLiberalRequested(true)
  }, [])

  const userName = meQuery.data?.name ?? ""
  const userInterests = useMemo(
    () =>
      meQuery.data?.interests
        ? meQuery.data.interests.split(",").filter(Boolean)
        : [],
    [meQuery.data?.interests],
  )
  const cartItems = cartQuery.data ?? []
  const histories = historiesQuery.data ?? []
  const timetables = timetablesQuery.data ?? []

  const wishlistIds = useMemo(
    () => new Set(cartItems.map((item) => String(item.course_id))),
    [cartItems],
  )
  const cartIdMap = useMemo(
    () => new Map(cartItems.map((item) => [String(item.course_id), item.id])),
    [cartItems],
  )

  // 슬롯별 사용자 별명 — WishlistCard / 추후 표시용에서 사용.
  const slotNames = useMemo<Record<SlotChar, string | null>>(() => {
    const m: Record<SlotChar, string | null> = { A: null, B: null, C: null, D: null }
    for (const t of timetables) m[t.slot] = t.name
    return m
  }, [timetables])

  // courseId → 들어있는 슬롯 목록. BrowseCourses 슬롯 버튼 disable 표시용.
  const slotMemberships = useMemo<Record<string, SlotChar[]>>(() => {
    const m: Record<string, SlotChar[]> = {}
    for (const t of timetables) {
      for (const c of t.courses) {
        const key = String(c.course_id)
        if (!m[key]) m[key] = []
        m[key].push(t.slot)
      }
    }
    return m
  }, [timetables])

  const wishlistedCourses = useMemo<Course[]>(
    () =>
      cartItems
        .filter((item) => item.course)
        .map((item) => mapApiCourse(item.course!)),
    [cartItems],
  )

  const addToWishlist = async (id: string) => {
    if (!localStorage.getItem("access_token")) return
    try {
      const newItem = await cartApi.add(Number(id))
      queryClient.setQueryData<CartItem[]>(QK.cart, (prev) =>
        prev ? [...prev, newItem] : [newItem],
      )
    } catch {/* 이미 추가됨 등 */}
  }

  const removeFromWishlist = async (id: string) => {
    const cartId = cartIdMap.get(id)
    if (cartId == null) return
    try {
      await cartApi.remove(cartId)
      queryClient.setQueryData<CartItem[]>(QK.cart, (prev) =>
        prev?.filter((item) => item.id !== cartId) ?? [],
      )
    } catch {}
  }

  // 검색 카드의 하트 버튼 — cart 토글
  const toggleWishlist = async (id: string) => {
    if (wishlistIds.has(id)) {
      await removeFromWishlist(id)
    } else {
      await addToWishlist(id)
    }
  }

  // 검색 카드의 [A][B][C][D] 슬롯 버튼 — 해당 슬롯에 즉시 추가
  const addToSlot = async (id: string, slot: SlotChar) => {
    if (!localStorage.getItem("access_token")) {
      alert("로그인이 필요합니다.")
      return
    }
    try {
      const updated = await timetablesApi.addCourse(slot, Number(id))
      queryClient.setQueryData<Timetable[]>(QK.timetables, (prev) =>
        prev?.map((t) => (t.slot === slot ? updated : t)) ?? [updated],
      )
    } catch (e) {
      // backend 미기동 / 중복 등 — 사용자에게 피드백
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`addToSlot(${slot}, ${id}) 실패:`, e)
      alert(`슬롯 ${slot} 에 추가 실패\n${msg}`)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("access_token")
    document.cookie = "access_token=; path=/; max-age=0"
    // 캐시 비움 — 다른 사용자가 로그인했을 때 이전 사용자 데이터 누수 방지
    queryClient.clear()
    router.replace("/login")
  }

  // 관심 과목 섹션 — 모바일에선 시간표 위, 데스크탑에선 사이드바에 동일하게 렌더링
  const wishlistSection = (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <BookMarked className="h-4 w-4" style={{ color: "#B0232A" }} />
        <h2 className="text-sm font-semibold text-foreground">내 관심 과목</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {wishlistedCourses.length}개
        </span>
      </div>

      {wishlistedCourses.length === 0 ? (
        <div className="h-[380px] flex flex-col items-center justify-center rounded-md border border-dashed border-border px-3 text-center">
          <BookMarked className="h-5 w-5 text-muted-foreground/40 mb-1.5" />
          <p className="text-xs text-muted-foreground">관심 과목이 비어있습니다.</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            검색에서 ♡ 버튼으로 추가
          </p>
        </div>
      ) : (
        <div className="h-[380px] overflow-y-auto pr-1 flex flex-col gap-2">
          {wishlistedCourses.map((course) => (
            <WishlistCard
              key={course.id}
              course={course}
              onRemove={removeFromWishlist}
              slotNames={slotNames}
              inSlots={slotMemberships[course.id] ?? []}
              onAddToSlot={addToSlot}
            />
          ))}
        </div>
      )}
    </section>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <BookOpen className="h-5 w-5 flex-shrink-0" style={{ color: "#B0232A" }} />
              <span className="text-xl font-semibold text-foreground tracking-tight font-logo">서간표</span>
              <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2.5 ml-0.5">
                {getCurrentSemester().label}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/profile"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{userName || "프로필"}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">로그아웃</span>
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content — 중앙 메인 + 우측 sticky 사이드바 (관심 과목) */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* 중앙 메인 컬럼 */}
          <div className="flex flex-col gap-6">

          {/* Intro */}
          <div className="border-l-2 pl-4" style={{ borderColor: "#B0232A" }}>
            <h1 className="text-lg font-semibold text-foreground text-balance">
              수강 계획 대시보드
            </h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              관심 과목을 저장하고, 강의계획서와 교수 연구 분야를 확인하세요.
            </p>
          </div>

          {/* Quick Stats */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Link
              href="/profile"
              className="group rounded-lg border border-border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" style={{ color: "#B0232A" }} />
                  <span className="text-xs font-medium text-muted-foreground">프로필</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm font-medium text-foreground">{userName || "로그인 필요"}</p>
              <p className="mt-1 text-xs text-muted-foreground">프로필 설정</p>
            </Link>

            <Link
              href="/timetable"
              className="group rounded-lg border border-border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4" style={{ color: "#B0232A" }} />
                  <span className="text-xs font-medium text-muted-foreground">시간표</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm font-medium text-foreground">시간표 업로드</p>
              <p className="mt-1 text-xs text-muted-foreground">이미지 자동 인식</p>
            </Link>

            <Link
              href="/graduation"
              className="group rounded-lg border border-border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4" style={{ color: "#B0232A" }} />
                  <span className="text-xs font-medium text-muted-foreground">이수 현황</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {totalCreditsFor(histories)}학점 이수
              </p>
              <p className="mt-1 text-xs text-muted-foreground">졸업 요건 확인</p>
            </Link>
            <Link
              href="/professors"
              className="group rounded-lg border border-border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" style={{ color: "#B0232A" }} />
                  <span className="text-xs font-medium text-muted-foreground">교수님</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm font-medium text-foreground">프로필 보러가기</p>
              <p className="mt-1 text-xs text-muted-foreground">연구 분야 탐색</p>
            </Link>
          </div>

          {/* 포트폴리오 + 커뮤니티 — 같은 카드 톤, 시간표 위 */}
          <div className="grid gap-3 lg:grid-cols-2">
            {/* 포트폴리오 */}
            <Link
              href="/portfolio"
              className="group rounded-lg border border-border bg-card p-4 hover:shadow-sm transition-shadow flex items-center gap-3"
            >
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "rgba(176, 35, 42, 0.1)" }}
              >
                <Sparkles className="h-4 w-4" style={{ color: "#B0232A" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold text-foreground">내 포트폴리오</h2>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: "rgba(176, 35, 42, 0.1)", color: "#B0232A" }}
                  >
                    AI 평가
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed truncate">
                  활동·자격증·프로젝트 → AI 진로 평가
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
            </Link>

            {/* 커뮤니티 게시판 — 포트폴리오와 같은 카드 톤 */}
            <section className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "rgba(176, 35, 42, 0.1)" }}
              >
                <MessageSquare className="h-4 w-4" style={{ color: "#B0232A" }} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-foreground">내 커뮤니티 게시판</h2>
                {userInterests.length === 0 ? (
                  <Link
                    href="/profile"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5 inline-block"
                  >
                    관심 분야를 선택하면 게시판이 표시됩니다 →
                  </Link>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {userInterests.map((item) => (
                      <Link
                        key={item}
                        href={`/community/${encodeURIComponent(item)}`}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted"
                        style={{ borderColor: "#B0232A", color: "#B0232A" }}
                      >
                        {item}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* 관심 과목 — 모바일/태블릿에서만 시간표 위에 표시 (데스크탑은 사이드바에) */}
          <div className="lg:hidden">{wishlistSection}</div>

          {/* 내 시간표 — A/B/C/D 4 슬롯 + 고정 + 비교 */}
          <TimetableSlotPanel
            timetables={timetables}
            isLoading={timetablesQuery.isPending}
            mapApiCourse={mapApiCourse}
          />

          {/* Browse Section — 카드별 [하트(cart 토글)] + [추가(A/B/C/D 슬롯 선택)] */}
          <BrowseCourses
            majorCourses={majorCourses}
            liberalCourses={liberalCourses}
            wishlistIds={wishlistIds}
            slotMemberships={slotMemberships}
            slotNames={slotNames}
            onToggleWishlist={toggleWishlist}
            onAddToSlot={addToSlot}
            onLiberalRequested={fetchLiberalIfNeeded}
            loadingDivision={loadingDivision}
          />

          </div>

          {/* 우측 sticky 사이드바 — 데스크탑 전용 (모바일에선 시간표 위에 표시됨) */}
          <aside className="hidden lg:flex lg:sticky lg:top-20 lg:self-start flex-col gap-4">
            {wishlistSection}
          </aside>
        </div>
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
          <p className="text-xs text-muted-foreground/60 text-center">
            서간표 - {getCurrentSemester().label}
          </p>
        </div>
      </footer>
    </div>
  )
}
