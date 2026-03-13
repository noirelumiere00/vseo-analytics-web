import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { useState } from "react";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
import { Link } from "wouter";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@")) {
      setError("有効なメールアドレスを入力してください");
      return;
    }

    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <Card className="w-full max-w-sm border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="text-center space-y-2">
          <div className="lg:hidden mb-4 flex flex-col items-center gap-3">
            <img src="/favicon.png" alt="VSEO Analytics" className="h-14 w-14 object-contain logo-blend" />
          </div>
          <CardTitle className="text-xl font-semibold">パスワードリセット</CardTitle>
          <p className="text-sm text-muted-foreground">
            登録メールアドレスにリセットリンクを送信します
          </p>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                メールを送信しました。受信トレイを確認し、リセットリンクをクリックしてください。
              </p>
              <Link href="/login">
                <Button variant="outline" className="w-full mt-4">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  ログインに戻る
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="例: user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoFocus
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
                    送信中...
                  </>
                ) : (
                  "リセットメールを送信"
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-primary hover:underline">
                  <ArrowLeft className="inline mr-1 h-3 w-3" />
                  ログインに戻る
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </PublicLayout>
  );
}
