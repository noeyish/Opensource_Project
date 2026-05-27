"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Users,
  FileText,
  Flag,
  CheckCircle,
  XCircle,
  Loader2,
  MessageSquare,
  GraduationCap,
  BookOpen,
  Activity,
  ShieldAlert,
  Sparkles,
  ArrowRight,
} from "lucide-react"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

function getAdminToken() {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/admin_token=([^;]+)/)
  return match ? match[1] : null
}

type HealthData = {
  status: string
  admin: string
  stats: { users: number; posts: number; pending_reports: number }
}

const MENU_CARDS = [
  {
    href: "/admin/users",
    label: "사용자 관리",
    description: "가입 회원 조회·차단·삭제",
    icon: Users,
    color: "#3B82F6",
  },
  {
    href: "/admin/posts",
    label: "게시글 관리",
    description: "커뮤니티 게시글 목록 및 삭제",
    icon: FileText,
    color: "#8B5CF6",
  },
  {
    href: "/admin/reports",
    label: "신고 관리",
    description: "미처리 신고 검토 및 처리",
    icon: Flag,
    color: "#EF4444",
    badgeKey: "pending_reports" as const,
  },
  {
    href: "/admin/contacts",
    label: "문의 관리",
    description: "사용자 문의 답변 및 처리",
    icon: MessageSquare,
    color: "#F59E0B",
  },
  {
    href: "/admin/professors",
    label: "교수 데이터",
    description: "교수 정보 크롤링 및 AI 요약",
    icon: GraduationCap,
    color: "#10B981",
  },
  {
    href: "/admin/lectures",
    label: "강의계획서",
    description: "강의계획서 PDF 업로드 및 분석",
    icon: BookOpen,
    color: "#06B6D4",
  },
  {
    href: "/admin/monitoring",
    label: "모니터링",
    description: "서버 상태 및 Grafana 대시보드",
    icon: Activity,
    color: "#6366F1",
  },
  {
    href: "/admin/security",
    label: "보안 모니터링",
    description: "보안 이벤트 분석 및 알림",
    icon: ShieldAlert,
    color: "#DC2626",
  },
  {
    href: "/admin/assistant",
    label: "운영 어시스턴트",
    description: "Gemini 기반 관리자 AI 챗",
    icon: Sparkles,
    color: "#B0232A",
  },
]

export default function AdminDashboard() {
  const router = useRouter()
  const [health, setHealth] = useState<HealthData | null>(null)
  const [pendingContacts, setPendingContacts] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const token = getAdminToken()
    if (!token) { router.replace("/admin/login"); return }

    Promise.all([
      fetch(`${BASE_URL}/admin/health`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${BASE_URL}/admin/contacts/counts`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([healthRes, contactsRes]) => {
        if (!healthRes.ok) throw new Error("인증 실패")
        const healthData = await healthRes.json()
        setHealth(healthData)
        if (contactsRes.ok) {
          const contactsData = await contactsRes.json()
          setPendingContacts(contactsData.total ?? 0)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [router])

  const getBadge = (card: typeof MENU_CARDS[number]) => {
    if (!health) return 0
    if (card.badgeKey === "pending_reports") return health.stats.pending_reports
    if (card.href === "/admin/contacts") return pendingContacts
    return 0
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-8 border-l-2 pl-4" style={{ borderColor: "#B0232A" }}>
        <h1 className="text-lg font-bold text-foreground">대시보드</h1>
        <p className="mt-1 text-sm text-muted-foreground">서간표 관리자 패널 — 항목을 선택해 이동하세요.</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 로딩 중...
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <XCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {health && (
        <>
          {/* 서버 상태 */}
          <div className="mb-5 flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="font-medium">서버 정상</span>
            <span className="text-muted-foreground">· 관리자: {health.admin}</span>
          </div>

          {/* 주요 지표 */}
          <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              icon={Users}
              label="전체 회원"
              value={health.stats.users}
              color="#3B82F6"
              href="/admin/users"
            />
            <MetricCard
              icon={FileText}
              label="전체 게시글"
              value={health.stats.posts}
              color="#8B5CF6"
              href="/admin/posts"
            />
            <MetricCard
              icon={Flag}
              label="미처리 신고"
              value={health.stats.pending_reports}
              color="#EF4444"
              href="/admin/reports"
              alert={health.stats.pending_reports > 0}
            />
            <MetricCard
              icon={MessageSquare}
              label="미처리 문의"
              value={pendingContacts}
              color="#F59E0B"
              href="/admin/contacts"
              alert={pendingContacts > 0}
            />
          </div>

          {/* 메뉴 카드 그리드 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MENU_CARDS.map((card) => {
              const Icon = card.icon
              const badge = getBadge(card)
              return (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group relative rounded-lg border border-border bg-card p-5 hover:border-[#B0232A]/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="rounded-md p-2" style={{ backgroundColor: `${card.color}15` }}>
                      <Icon className="h-5 w-5" style={{ color: card.color }} />
                    </div>
                    {badge > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">{card.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
                  <ArrowRight className="absolute right-4 bottom-4 h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-[#B0232A] group-hover:translate-x-0.5 transition-all" />
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
  href,
  alert = false,
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
  href: string
  alert?: boolean
}) {
  return (
    <Link
      href={href}
      className={`group rounded-lg border bg-card p-4 hover:shadow-sm transition-all ${
        alert ? "border-red-300 dark:border-red-800" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="rounded-md p-1.5" style={{ backgroundColor: `${color}15` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        {alert && (
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
      <p className="text-2xl font-bold text-foreground mb-0.5">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{label}</p>
    </Link>
  )
}
