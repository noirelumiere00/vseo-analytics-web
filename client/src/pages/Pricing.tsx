import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Check, Crown, Zap, Building2 } from "lucide-react";
import { toast } from "sonner";

const plans = [
  {
    id: "free" as const,
    name: "Free",
    price: "¥0",
    period: "/月",
    icon: Zap,
    limit: "月3回",
    features: [
      "SEO分析 3回/月",
      "トレンド分析 3回/月",
      "基本レポート",
    ],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: "¥9,800",
    period: "/月",
    icon: Crown,
    limit: "月30回",
    popular: true,
    features: [
      "SEO分析 30回/月",
      "トレンド分析 30回/月",
      "詳細レポート",
      "優先サポート",
    ],
  },
  {
    id: "business" as const,
    name: "Business",
    price: "¥29,800",
    period: "/月",
    icon: Building2,
    limit: "無制限",
    features: [
      "無制限分析",
      "全機能アクセス",
      "専任サポート",
      "カスタムレポート",
    ],
  },
];

export default function Pricing() {
  const statusQuery = trpc.subscription.status.useQuery(undefined, { staleTime: 30_000 });
  const checkoutMutation = trpc.subscription.createCheckout.useMutation();
  const portalMutation = trpc.subscription.createPortal.useMutation();

  const currentPlan = statusQuery.data?.plan ?? "free";
  const used = statusQuery.data?.used ?? 0;
  const limit = statusQuery.data?.limit ?? 3;
  const hasStripeSubscription = !!statusQuery.data?.sub?.stripeCustomerId;

  const handleUpgrade = async (plan: "pro" | "business") => {
    try {
      const result = await checkoutMutation.mutateAsync({ plan });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      toast.error("チェックアウトの作成に失敗しました");
    }
  };

  const handleManage = async () => {
    try {
      const result = await portalMutation.mutateAsync();
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      toast.error("ポータルの作成に失敗しました");
    }
  };

  const percentage = limit === Infinity ? 0 : Math.min((used / limit) * 100, 100);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">プラン・利用状況</h1>
          <p className="text-muted-foreground mt-1">現在のプランと利用状況を確認</p>
        </div>

        {/* Usage meter */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">今月の利用状況</span>
              <span className="text-sm text-muted-foreground capitalize">{currentPlan}プラン</span>
            </div>
            {limit !== Infinity ? (
              <>
                <Progress value={percentage} className={`h-3 ${percentage >= 100 ? "[&>div]:bg-destructive" : ""}`} />
                <p className="text-sm text-muted-foreground">
                  {used} / {limit} 回使用
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{used} 回使用（無制限）</p>
            )}
            {hasStripeSubscription && (
              <Button variant="outline" size="sm" onClick={handleManage} disabled={portalMutation.isPending}>
                サブスクリプションを管理
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Plan cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            return (
              <Card key={plan.id} className={`relative ${plan.popular ? "border-primary shadow-lg" : ""}`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                    人気
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                    <plan.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.limit}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      現在のプラン
                    </Button>
                  ) : plan.id === "free" ? (
                    <Button variant="outline" className="w-full" disabled>
                      -
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${plan.popular ? "gradient-primary text-white" : ""}`}
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={checkoutMutation.isPending}
                    >
                      アップグレード
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
