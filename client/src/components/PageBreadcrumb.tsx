import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem,
  BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useLocation } from "wouter";

const ROUTE_MAP: Record<string, { label: string; parent?: string }> = {
  "/": { label: "TikTok SEO分析" },
  "/history": { label: "分析履歴" },
  "/dashboard": { label: "ダッシュボード" },
  "/trend-discovery": { label: "TikTokトレンド分析" },
  "/trend-insights": { label: "トレンド分析結果" },
  "/compare": { label: "比較分析", parent: "/history" },
  "/trend": { label: "トレンド推移", parent: "/dashboard" },
  "/admin": { label: "管理画面" },
};

export function PageBreadcrumb() {
  const [location, setLocation] = useLocation();

  // Determine current route info
  let currentLabel = "";
  let parentPath = "";
  let parentLabel = "";

  // Check dynamic routes
  if (location.startsWith("/analysis/")) {
    currentLabel = "分析詳細";
    parentPath = "/history";
    parentLabel = "分析履歴";
  } else if (location.startsWith("/trend-discovery/") && location !== "/trend-discovery") {
    currentLabel = "トレンド詳細";
    parentPath = "/trend-discovery";
    parentLabel = "TikTokトレンド分析";
  } else if (location === "/campaigns/new") {
    currentLabel = "新規作成";
    parentPath = "/campaigns";
    parentLabel = "施策効果レポート";
  } else if (location.startsWith("/campaigns/") && location !== "/campaigns") {
    currentLabel = "キャンペーン詳細";
    parentPath = "/campaigns";
    parentLabel = "施策効果レポート";
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
