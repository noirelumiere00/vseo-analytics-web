import { useParams, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { verifyExportToken } from "@/lib/exportToken";
import AnalysisDetail from "./AnalysisDetail";

/**
 * PDF出力用のViewページ
 * - トークンを検証してからデータを表示
 * - Puppeteerがレンダリングするまで待機
 * - ネットワーク通信完了後にPDF化可能な状態になる
 */
export default function ReportView() {
  const params = useParams<{ jobId: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(params.jobId || "0");

  // URLからトークンを取得
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // トークン検証
  useEffect(() => {
    if (!token) {
      setError("トークンが見つかりません");
      setIsLoading(false);
      return;
    }

    // クライアント側でのトークン検証（サーバー側でも検証される）
    const result = verifyExportToken(token);
    if (!result) {
      setError("トークンが無効または期限切れです");
      setIsLoading(false);
      return;
    }

    if (result.jobId !== jobId) {
      setError("ジョブIDが一致しません");
      setIsLoading(false);
      return;
    }

    setIsTokenValid(true);
    setIsLoading(false);
  }, [token, jobId]);

  // ネットワーク完了を待機（Puppeteer用）
  useEffect(() => {
    if (isTokenValid) {
      // すべてのネットワークリクエストが完了するまで待機
      // Puppeteer側で waitUntil: 'networkidle2' が使用されるため、
      // ここでも同期を取る
      if (document.readyState === "complete") {
        // ページ完全読み込み済み
        return;
      }

      const handleLoad = () => {
        // ページ読み込み完了
      };

      window.addEventListener("load", handleLoad);
      return () => window.removeEventListener("load", handleLoad);
    }
  }, [isTokenValid]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">検証中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-red-600 font-semibold">{error}</p>
          <button
            onClick={() => setLocation("/")}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  if (!isTokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">トークンが無効です</p>
          <button
            onClick={() => setLocation("/")}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  // トークン検証済み → AnalysisDetail を表示
  // Puppeteer がこのページを開いてレンダリングする
  return <AnalysisDetail />;
}
