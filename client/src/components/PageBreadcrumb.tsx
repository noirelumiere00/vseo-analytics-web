import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem,
  BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ArrowLeft } from "lucide-react";

/**
 * Each entry defines a breadcrumb trail: an array of { label, path } segments.
 * The last segment is rendered as the current page (non-clickable).
 * A "__dynamic__" label is replaced at runtime with fetched data.
 */
interface BreadcrumbSegment {
  label: string;
  path: string;
}

type RouteDefinition = BreadcrumbSegment[];

const ROUTE_MAP: Record<string, RouteDefinition> = {
  "/dashboard": [
    { label: "ダッシュボード", path: "/dashboard" },
  ],
  "/activity": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "アクティビティ", path: "/activity" },
  ],
  "/analysis/new": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "新規SEO分析", path: "/analysis/new" },
  ],
  "/trend-discovery": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "トレンド発掘", path: "/trend-discovery" },
  ],
  "/campaigns": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "施策レポート", path: "/campaigns" },
  ],
  "/campaigns/new": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "新規施策レポート", path: "/campaigns/new" },
  ],
  "/compare": [
    { label: "ダッシュボード", path: "/dashboard" },
    { label: "アクティビティ", path: "/activity" },
    { label: "比較", path: "/compare" },
  ],
  "/admin": [
    { label: "管理画面", path: "/admin" },
  ],
  "/admin/logs": [
    { label: "管理画面", path: "/admin" },
    { label: "ログ", path: "/admin/logs" },
  ],
};

function matchDynamicRoute(location: string): {
  segments: RouteDefinition;
  analysisId: number;
  trendId: number;
  campaignId: number;
  campaignReportId: number;
} {
  const result = {
    segments: [] as RouteDefinition,
    analysisId: 0,
    trendId: 0,
    campaignId: 0,
    campaignReportId: 0,
  };

  // /analysis/:id (but not /analysis/new)
  const analysisMatch = location.match(/^\/analysis\/(\d+)$/);
  if (analysisMatch) {
    result.analysisId = parseInt(analysisMatch[1]);
    result.segments = [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "アクティビティ", path: "/activity" },
      { label: "SEO分析", path: location },
    ];
    return result;
  }

  // /trend-discovery/:id
  const trendMatch = location.match(/^\/trend-discovery\/(\d+)$/);
  if (trendMatch) {
    result.trendId = parseInt(trendMatch[1]);
    result.segments = [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "トレンド発掘", path: "/trend-discovery" },
      { label: "分析結果", path: location },
    ];
    return result;
  }

  // /campaigns/:id/report
  const reportMatch = location.match(/^\/campaigns\/(\d+)\/report$/);
  if (reportMatch) {
    result.campaignReportId = parseInt(reportMatch[1]);
    result.segments = [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "施策レポート", path: "/campaigns" },
      { label: "レポート", path: location },
    ];
    return result;
  }

  // /campaigns/:id (but not /campaigns/new)
  const campaignMatch = location.match(/^\/campaigns\/(\d+)$/);
  if (campaignMatch) {
    result.campaignId = parseInt(campaignMatch[1]);
    result.segments = [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "施策レポート", path: "/campaigns" },
      { label: "詳細", path: location },
    ];
    return result;
  }

  return result;
}

export function PageBreadcrumb() {
  const [location, setLocation] = useLocation();

  const { segments: dynamicSegments, analysisId, trendId, campaignId, campaignReportId } =
    matchDynamicRoute(location);

  // Fetch dynamic names when we have IDs
  const analysisQuery = trpc.analysis.getById.useQuery(
    { jobId: analysisId },
    { enabled: analysisId > 0 },
  );
  const trendQuery = trpc.trendDiscovery.getById.useQuery(
    { jobId: trendId },
    { enabled: trendId > 0 },
  );
  const campaignQuery = trpc.campaign.getById.useQuery(
    { id: campaignId },
    { enabled: campaignId > 0 },
  );
  const campaignReportQuery = trpc.campaign.getById.useQuery(
    { id: campaignReportId },
    { enabled: campaignReportId > 0 },
  );

  // Resolve segments: use static map or dynamic match
  let segments: RouteDefinition = dynamicSegments.length > 0
    ? [...dynamicSegments]
    : ROUTE_MAP[location]
      ? [...ROUTE_MAP[location]]
      : [];

  if (segments.length === 0) return null;

  // Append dynamic name to the last segment for detail pages
  if (analysisId > 0 && analysisQuery.data?.job?.keyword) {
    const keyword = analysisQuery.data.job.keyword.replace(/^#+/, "");
    segments[segments.length - 1] = {
      ...segments[segments.length - 1],
      label: keyword,
    };
  }
  if (trendId > 0 && trendQuery.data?.persona) {
    segments[segments.length - 1] = {
      ...segments[segments.length - 1],
      label: trendQuery.data.persona,
    };
  }
  if (campaignId > 0 && campaignQuery.data?.campaign?.name) {
    segments[segments.length - 1] = {
      ...segments[segments.length - 1],
      label: campaignQuery.data.campaign.name,
    };
  }
  if (campaignReportId > 0 && campaignReportQuery.data?.campaign?.name) {
    segments[segments.length - 1] = {
      ...segments[segments.length - 1],
      label: campaignReportQuery.data.campaign.name + " レポート",
    };
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {/* Back button */}
        <BreadcrumbItem>
          <BreadcrumbLink
            className="cursor-pointer text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="size-3.5" />
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />

        {/* All segments except the last are clickable links */}
        {segments.slice(0, -1).map((segment, index) => (
          <span key={segment.path} className="contents">
            <BreadcrumbItem>
              <BreadcrumbLink
                className="cursor-pointer text-xs"
                onClick={() => setLocation(segment.path)}
              >
                {segment.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </span>
        ))}

        {/* Last segment is the current page */}
        <BreadcrumbItem>
          <BreadcrumbPage className="text-xs">
            {segments[segments.length - 1].label}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
