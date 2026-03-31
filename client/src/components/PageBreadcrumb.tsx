import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem,
  BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ArrowLeft } from "lucide-react";

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

type DynamicRouteResult = {
  segments: RouteDefinition;
  analysisId: number;
  trendId: number;
  campaignId: number;
  campaignReportId: number;
};

const DYNAMIC_ROUTES: {
  regex: RegExp;
  idKey: keyof Omit<DynamicRouteResult, "segments">;
  segments: (location: string) => RouteDefinition;
}[] = [
  {
    regex: /^\/analysis\/(\d+)$/,
    idKey: "analysisId",
    segments: (loc) => [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "アクティビティ", path: "/activity" },
      { label: "SEO分析", path: loc },
    ],
  },
  {
    regex: /^\/trend-discovery\/(\d+)$/,
    idKey: "trendId",
    segments: (loc) => [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "トレンド発掘", path: "/trend-discovery" },
      { label: "分析結果", path: loc },
    ],
  },
  {
    regex: /^\/campaigns\/(\d+)\/report$/,
    idKey: "campaignReportId",
    segments: (loc) => [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "施策レポート", path: "/campaigns" },
      { label: "レポート", path: loc },
    ],
  },
  {
    regex: /^\/campaigns\/(\d+)$/,
    idKey: "campaignId",
    segments: (loc) => [
      { label: "ダッシュボード", path: "/dashboard" },
      { label: "施策レポート", path: "/campaigns" },
      { label: "詳細", path: loc },
    ],
  },
];

function matchDynamicRoute(location: string): DynamicRouteResult {
  const result: DynamicRouteResult = {
    segments: [],
    analysisId: 0,
    trendId: 0,
    campaignId: 0,
    campaignReportId: 0,
  };

  for (const route of DYNAMIC_ROUTES) {
    const match = location.match(route.regex);
    if (match) {
      result[route.idKey] = parseInt(match[1]);
      result.segments = route.segments(location);
      return result;
    }
  }

  return result;
}

export function PageBreadcrumb() {
  const [location, setLocation] = useLocation();

  const { segments: dynamicSegments, analysisId, trendId, campaignId, campaignReportId } =
    matchDynamicRoute(location);

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

  let segments: RouteDefinition = dynamicSegments.length > 0
    ? [...dynamicSegments]
    : ROUTE_MAP[location]
      ? [...ROUTE_MAP[location]]
      : [];

  if (segments.length === 0) return null;

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
        <BreadcrumbItem>
          <BreadcrumbLink
            className="cursor-pointer text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="size-3.5" />
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />

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

        <BreadcrumbItem>
          <BreadcrumbPage className="text-xs">
            {segments[segments.length - 1].label}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
