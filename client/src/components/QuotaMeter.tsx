import { useQuota } from "@/hooks/useQuota";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";

export default function QuotaMeter() {
  const { plan, used, limit, isExceeded, isLoading } = useQuota();

  if (isLoading) return null;

  const percentage = limit === Infinity ? 0 : Math.min((used / limit) * 100, 100);
  const limitLabel = limit === Infinity ? "無制限" : `${limit}`;

  return (
    <div className="rounded-lg border p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">月間利用状況</span>
        <span className="font-medium capitalize">{plan}プラン</span>
      </div>
      {limit !== Infinity && (
        <Progress value={percentage} className={`h-2 ${isExceeded ? "[&>div]:bg-destructive" : ""}`} />
      )}
      <div className="flex items-center justify-between text-xs">
        <span className={isExceeded ? "text-destructive font-medium" : "text-muted-foreground"}>
          {used} / {limitLabel} 回使用
        </span>
        {isExceeded && (
          <Link href="/pricing" className="text-primary hover:underline font-medium">
            プランをアップグレード
          </Link>
        )}
      </div>
    </div>
  );
}
