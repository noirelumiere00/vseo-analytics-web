import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem,
  BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useLocation } from "wouter";

const ROUTE_MAP: Record<string, { label: string; parent?: string }> = {
  "/dashboard": { label: "ダッシュボード" },
  "/activity": { label: "アクティビティ" },
  "/history": { label: "キーワード分析" },
  "/analysis/new": { label: "新規分析", parent: "/history" },
  "/compare": { label: "比較分析", parent: "/history" },
  "/trend": { label: "トレンド推移", parent: "/history" },
  "/trend-insights": { label: "トレンド発掘" },
  "/trend-discovery": { label: "新規分析", parent: "/trend-insights" },
  "/campaigns": { label: "施策レポート" },
  "/campaigns/new": { label: "新規作成", parent: "/campaigns" },
  "/admin": { label: "管理画面" },
};

export function PageBreadcrumb() {
  const [location, setLocation] = useLocation();

  // Determine current route info
  let currentLabel = "";
  let parentPath = "";
  let parentLabel = "";

  // Check dynamic routes
  if (location.startsWith("/analysis/") && location !== "/analysis/new") {
    currentLabel = "分析詳細";
    parentPath = "/history";
    parentLabel = "キーワード分析";
  } else if (location.startsWith("/trend-discovery/") && location !== "/trend-discovery") {
    currentLabel = "トレンド詳細";
    parentPath = "/trend-insights";
    parentLabel = "トレンド発掘";
  } else if (location === "/campaigns/new") {
    currentLabel = "新規作成";
    parentPath = "/campaigns";
    parentLabel = "施策レポート";
  } else if (location.match(/^\/campaigns\/\d+\/report$/)) {
    currentLabel = "レポート";
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
