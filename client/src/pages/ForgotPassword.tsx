import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useState } from "react";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
import { Link } from "wouter";

export default function ForgotPassword() {
  usePageTitle("パスワードリセット");
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
      {/* Mobile branding */}
      <div className="lg:hidden mb-8 flex flex-col items-center gap-3">
        <img src="/favicon.png" alt="VSEO Analytics" className="h-14 w-14 object-contain logo-blend" />
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <h2
            className="text-2xl tracking-tight"
            style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace', fontWeight: 700 }}
          >
            パスワードリセット
          </h2>
          <p className="text-sm text-muted-foreground">
            登録メールアドレスにリセットリンクを送信します
          </p>
        </div>

        {sent ? (
          <div className="space-y-5 text-center py-4">
            <div
              className="mx-auto h-14 w-14 rounded-full flex items-center justify-center"
              style={{ background: "rgba(10, 10, 10, 0.06)" }}
            >
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              メールを送信しました。<br />受信トレイを確認し、リセットリンクをクリックしてください。
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full h-11 border-border/60 mt-2">
                <ArrowLeft className="mr-2 h-4 w-4" />
                ログインに戻る
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                メールアドレス
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoFocus
                className="h-11 bg-secondary/50 border-border/60 focus:bg-background transition-colors duration-200"
              />
            </div>
            {error && (
              <div
                className="px-4 py-3 rounded-md border text-sm animate-in fade-in slide-in-from-top-1 duration-200"
                style={{
                  background: "rgba(215, 25, 33, 0.06)",
                  borderColor: "rgba(215, 25, 33, 0.15)",
                  color: "var(--destructive)",
                }}
              >
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 bg-primary text-primary-foreground font-medium transition-all duration-200 hover:shadow-md"
              disabled={loading}
            >
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
              <Link href="/login" className="text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" />
                ログインに戻る
              </Link>
            </p>
          </form>
        )}
      </div>
    </PublicLayout>
  );
}
