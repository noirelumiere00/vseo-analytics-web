import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";

export function AdminLogs() {
  usePageTitle("システムログ");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5秒ごと
  
  const { data, isLoading, refetch } = trpc.admin.getLogs.useQuery(
    { lines: 500 },
    {
      refetchInterval: autoRefresh ? refreshInterval : false,
    }
  );

  const handleManualRefresh = () => {
    refetch();
  };

  const handleToggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const handleDownloadLogs = () => {
    if (!data?.logs) return;
    
    const logContent = data.logs.join('\n');
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(logContent)}`);
    element.setAttribute('download', `server-logs-${new Date().toISOString().split('T')[0]}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            🔍 デバッグログビューア
          </h1>
          <p className="text-slate-600">
            サーバーログをリアルタイムで監視します。プロキシ接続状況やエラーを確認できます。
          </p>
        </div>

        {/* コントロールパネル */}
        <Card className="mb-6 border-slate-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">ログ表示設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleManualRefresh}
                disabled={isLoading}
                variant="outline"
                className="gap-2"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                手動更新
              </Button>

              <Button
                onClick={handleToggleAutoRefresh}
                variant={autoRefresh ? "default" : "outline"}
                className="gap-2"
              >
                {autoRefresh ? "✓" : "○"} 自動更新（{refreshInterval / 1000}秒）
              </Button>

              <Button
                onClick={handleDownloadLogs}
                disabled={!data?.logs || data.logs.length === 0}
                variant="outline"
              >
                📥 ダウンロード
              </Button>
            </div>

            {/* ステータス情報 */}
            {data && (
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200">
                <div className="text-sm">
                  <p className="text-slate-600">総行数</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {data.totalLines?.toLocaleString() || "0"}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-slate-600">表示行数</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {data.displayedLines?.toLocaleString() || "0"}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-slate-600">ステータス</p>
                  <p className={`text-lg font-bold ${data.success ? "text-green-600" : "text-red-600"}`}>
                    {data.success ? "✓ 成功" : "✗ エラー"}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ログ表示エリア */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">ログ出力</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : data?.logs && data.logs.length > 0 ? (
              <div className="bg-slate-950 text-slate-100 rounded-lg p-4 font-mono text-sm overflow-x-auto max-h-96 overflow-y-auto">
                {data.logs.map((log: string, index: number) => {
                  // ログレベルに応じて色分け
                  let logColor = "text-slate-100";
                  if (log.includes("error") || log.includes("Error") || log.includes("ERROR")) {
                    logColor = "text-red-400";
                  } else if (log.includes("warn") || log.includes("Warn") || log.includes("WARN")) {
                    logColor = "text-yellow-400";
                  } else if (log.includes("Proxy") || log.includes("proxy") || log.includes("Country")) {
                    logColor = "text-blue-400";
                  } else if (log.includes("TikTok") || log.includes("Session")) {
                    logColor = "text-cyan-400";
                  }

                  return (
                    <div key={index} className={logColor}>
                      {log}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <p className="mb-2">📭 ログがありません</p>
                <p className="text-sm">{data?.message || "ログファイルを読み込み中..."}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ヘルプセクション */}
        <Card className="mt-6 border-slate-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-blue-900">💡 ログの見方</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-blue-800">
            <p>
              <span className="font-mono bg-red-100 px-2 py-1 rounded">Error</span> - エラーメッセージ（赤色）
            </p>
            <p>
              <span className="font-mono bg-yellow-100 px-2 py-1 rounded">Warn</span> - 警告メッセージ（黄色）
            </p>
            <p>
              <span className="font-mono bg-blue-100 px-2 py-1 rounded">Proxy/Country</span> - プロキシ接続情報（青色）
            </p>
            <p>
              <span className="font-mono bg-cyan-100 px-2 py-1 rounded">TikTok/Session</span> - TikTok スクレイピング情報（シアン色）
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
