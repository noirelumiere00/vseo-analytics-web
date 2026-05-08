import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useState, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { ScanSearch, Crosshair, Package } from "lucide-react";
import { ContextAnalysisContent } from "./ContextAnalysis";
import { PainAnalysisContent } from "./PainAnalysis";

export default function ProductAnalysis() {
  usePageTitle("商品分析");

  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const tabFromUrl = params.get("tab") || "context";
  const idFromUrl = params.get("id") ? parseInt(params.get("id")!, 10) : null;

  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const [contextId, setContextId] = useState<number | null>(tabFromUrl === "context" ? idFromUrl : null);
  const [painId, setPainId] = useState<number | null>(tabFromUrl === "pain" ? idFromUrl : null);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const id = tab === "context" ? contextId : painId;
    const url = id ? `/product-analysis?tab=${tab}&id=${id}` : `/product-analysis?tab=${tab}`;
    setLocation(url, { replace: true });
  };

  const handleContextNavigate = useCallback((id: number | null) => {
    setContextId(id);
    const url = id ? `/product-analysis?tab=context&id=${id}` : "/product-analysis?tab=context";
    setLocation(url, { replace: true });
  }, [setLocation]);

  const handlePainNavigate = useCallback((id: number | null) => {
    setPainId(id);
    const url = id ? `/product-analysis?tab=pain&id=${id}` : "/product-analysis?tab=pain";
    setLocation(url, { replace: true });
  }, [setLocation]);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5" />
            商品分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            商品のコンテキスト（文脈）とペイン（悩み）を多角的に分析します
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="context" className="gap-1.5">
              <ScanSearch className="h-4 w-4" />
              コンテキスト分析
            </TabsTrigger>
            <TabsTrigger value="pain" className="gap-1.5">
              <Crosshair className="h-4 w-4" />
              ペイン分析
            </TabsTrigger>
          </TabsList>

          <TabsContent value="context" className="mt-4">
            <ContextAnalysisContent
              externalId={contextId}
              onNavigate={handleContextNavigate}
            />
          </TabsContent>

          <TabsContent value="pain" className="mt-4">
            <PainAnalysisContent
              externalId={painId}
              onNavigate={handlePainNavigate}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
