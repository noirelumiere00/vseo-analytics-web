import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem,
  BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

const ROUTE_MAP: Record<string, { label: string; parent?: string }> = {
  "/dashboard": { label: "ダッシュボード" },
  "/activity": { label: "アクティビティ" },
  "/analysis/new": { label: "新規分析", parent: "/activity" },
  "/compare": { label: "比較分析", parent: "/activity" },
  "/trend": { label: "トレンド推移", parent: "/activity" },
  "/trend-discovery": { label: "トレンド発掘", parent: "/activity" },
  "/campaigns": { label: "施策レポート" },
  "/campaigns/new": { label: "新規作成", parent: "/campaigns" },
  "/admin": { label: "管理画面" },
};

export function PageBreadcrumb() {
  const [location, setLocation] = useLocation();

  // Extract campaign ID for report routes
  const reportMatch = location.match(/^\/campaigns\/(\d+)\/report$/);
  const campaignId = reportMatch ? parseInt(reportMatch[1]) : 0;
  const campaignQuery = trpc.campaign.getById.useQuery(
    { id: campaignId },
    { enabled: campaignId > 0 },
  );

  // Determine current route info
  let currentLabel = "";
  let parentPath = "";
  let parentLabel = "";

  // Check dynamic routes
  if (location.startsWith("/analysis/") && location !== "/analysis/new") {
    currentLabel = "分析詳細";
    parentPath = "/activity";
    parentLabel = "アクティビティ";
  } else if (location.startsWith("/trend-discovery/") && location !== "/trend-discovery") {
    currentLabel = "トレンド詳細";
    parentPath = "/activity";
    parentLabel = "アクティビティ";
  } else if (location === "/campaigns/new") {
    currentLabel = "新規作成";
    parentPath = "/campaigns";
    parentLabel = "施策レポート";
  } else if (reportMatch) {
    currentLabel = campaignQuery.data?.campaign?.name || "レポート";
    parentPath = "/campaigns";
    parentLabel = "施策レポート";
  } else if (location.startsWith("/campaigns/") && location !== "/campaigns") {
    currentLabel = "詳細";
    parentPath = "/campaigns";
    parentLabel = "施策レポート";
  } else {
    const route = ROUTE_MAP[location];
    if (route) {
      currentLabel = route.label;
      if (route.parent) {
        parentPath = route.parent;
        parentLabel = ROUTE_MAP[route.parent]?.label || "";
      }
    }
  }

  if (!currentLabel) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {parentPath && parentLabel && (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink
                className="cursor-pointer text-xs"
                onClick={() => setLocation(parentPath)}
              >
                {parentLabel}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbPage className="text-xs">{currentLabel}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
