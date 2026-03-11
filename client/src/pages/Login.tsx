import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Loader2, Search, Video, TrendingUp } from "lucide-react";

export default function Login() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }
    if (!password) {
      setError("パスワードを入力してください");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "ログインに失敗しました");
        return;
      }

      window.location.href = "/";
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Search, text: "定量的な上位動画分析" },
    { icon: Video, text: "OCR + 音声のコンテンツ完全解析" },
    { icon: TrendingUp, text: "AIによる戦略提案レポート" },
  ];

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding Panel */}
      <div className="hidden lg:flex flex-col justify-center px-12 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative space-y-8 max-w-md">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="gradient-text">VSEO Analytics</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            ショート動画時代のPR革命ツール。個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」。
          </p>

          <div className="space-y-4 pt-4">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="flex items-center justify-center px-4">
        <Card className="w-full max-w-sm border-0 shadow-none lg:border lg:shadow-sm">
          <CardHeader className="text-center space-y-2">
            {/* Mobile-only branding */}
            <div className="lg:hidden mb-4">
              <h1 className="text-2xl font-bold">
                <span className="gradient-text">VSEO Analytics</span>
              </h1>
            </div>
            <CardTitle className="text-xl font-semibold">サインイン</CardTitle>
            <p className="text-sm text-muted-foreground">
              登録済みのアカウントでログイン
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">名前</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="例: 田中太郎"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="4文字以上"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
              <Button type="submit" className="w-full gradient-primary text-white" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ログイン中...
                  </>
                ) : (
                  "サインイン"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
