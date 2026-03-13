import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-6">
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          戻る
        </Link>
        <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <p className="text-lg">このプライバシーポリシーは準備中です（仮）</p>
          <p className="mt-2 text-sm">正式なプライバシーポリシーは近日公開予定です。</p>
        </div>
      </div>
    </div>
  );
}
