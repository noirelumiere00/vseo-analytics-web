import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <img src="/favicon.png" alt="" className="h-20 w-20 object-contain logo-blend opacity-30" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>

          <h2 className="text-xl font-semibold text-foreground mb-4">
            ページが見つかりません
          </h2>

          <p className="text-muted-foreground mb-8 leading-relaxed">
            お探しのページは存在しないか、移動された可能性があります。
          </p>

          <Button onClick={() => setLocation("/dashboard")} className="px-6">
            <Home className="w-4 h-4 mr-2" />
            ホームへ戻る
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
