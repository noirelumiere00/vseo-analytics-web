# AWS環境での永続Chromeプロファイル実装ガイド

## 背景と目的

### 現状の課題

現在の `tiktokScraper.ts` では、検索ごとに**完全にクリーンなインコグニートコンテキスト**を作成している：

```typescript
// 現在の実装（tiktokScraper.ts:186-188）
const context = await browser.createBrowserContext();
const page = await context.newPage();
```

これにより毎回「初めてTikTokに来た新しいユーザー」として認識され、Bot検出のリスクが高まる。

### 永続プロファイルの効果

| 項目 | インコグニート（現状） | 永続プロファイル |
|------|----------------------|-----------------|
| Cookie | 毎回リセット | TikTok認証Cookie保持 |
| LocalStorage | 空 | TikTokの設定データ保持 |
| ブラウザ指紋 | 毎回新規 | 一貫したフィンガープリント |
| TikTokからの見え方 | 不審な新規訪問者 | リピーターユーザー |
| CAPTCHA発生率 | 高い | **大幅に低下** |

---

## アーキテクチャ

```
┌──────────────────────────────────────────┐
│              AWS サーバー                  │
│                                          │
│  /data/chrome-profiles/                  │
│    ├── profile-0/    ← セッション1用      │
│    ├── profile-1/    ← セッション2用      │
│    └── profile-2/    ← セッション3用      │
│                                          │
│  puppeteer.launch({                      │
│    userDataDir: '/data/chrome-profiles/  │
│                  profile-{index}'        │
│  })                                      │
│          ↓                               │
│  Bright Data 住宅プロキシ (JP)            │
│          ↓                               │
│  TikTok (リピーターとして認識)             │
└──────────────────────────────────────────┘
```

---

## 実装手順

### Step 1: 環境変数の追加

`.env` に以下を追加：

```bash
# Chromeプロファイルの保存ディレクトリ
CHROME_PROFILE_DIR=/data/chrome-profiles

# プロファイル使用の有効/無効（デフォルト: true）
USE_CHROME_PROFILE=true
```

### Step 2: プロファイルディレクトリの初期化

`tiktokScraper.ts` に追加する関数：

```typescript
import * as path from "path";

// プロファイルディレクトリのベースパス
const PROFILE_BASE_DIR = process.env.CHROME_PROFILE_DIR || "/data/chrome-profiles";

/**
 * Chromeプロファイルディレクトリを確保する
 * 存在しなければ作成、存在すればそのまま使う
 */
function ensureProfileDir(sessionIndex: number): string {
  const profileDir = path.join(PROFILE_BASE_DIR, `profile-${sessionIndex}`);

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
    console.log(`[Chrome Profile] Created profile directory: ${profileDir}`);
  } else {
    console.log(`[Chrome Profile] Using existing profile: ${profileDir}`);
  }

  return profileDir;
}
```

### Step 3: ブラウザ起動方法の変更（最重要）

現在の実装では **1つのブラウザ → 3つのインコグニートコンテキスト** というアーキテクチャだが、
`userDataDir` はブラウザ起動時にしか指定できないため、**3つの独立したブラウザインスタンス**に変更する。

#### 現在の構造

```
Browser (1つ)
  ├── IncognitoContext 1 → Page → 検索
  ├── IncognitoContext 2 → Page → 検索
  └── IncognitoContext 3 → Page → 検索
```

#### 新しい構造

```
Browser 0 (profile-0) → Page → 検索
Browser 1 (profile-1) → Page → 検索
Browser 2 (profile-2) → Page → 検索
```

#### コード変更

`searchTikTokTriple()` を以下のように変更する：

```typescript
export async function searchTikTokTriple(
  keyword: string,
  videosPerSearch: number = 15,
  onProgress?: (message: string, percent: number) => void
): Promise<TikTokTripleSearchResult> {
  const useProfile = process.env.USE_CHROME_PROFILE !== "false";
  const chromiumPath = findChromiumPath();

  if (onProgress) onProgress("3つのブラウザを起動中...", 5);

  const searches: TikTokSearchResult[] = [];

  for (let i = 0; i < 3; i++) {
    if (onProgress) {
      onProgress(`検索${i + 1}/3: ブラウザで検索中...`, 10 + i * 25);
    }

    // セッションごとに独立したブラウザを起動
    let browser: Browser;
    try {
      const launchOptions: any = {
        executablePath: chromiumPath,
        headless: true,
        args: buildChromiumArgs(),
      };

      // 永続プロファイルを使用する場合
      if (useProfile) {
        launchOptions.userDataDir = ensureProfileDir(i);
        console.log(`[TikTok Session ${i + 1}] Using persistent profile`);
      }

      browser = await puppeteer.launch(launchOptions);
    } catch (launchError: any) {
      console.error(`[Puppeteer] Failed to launch browser ${i + 1}:`, launchError.message);
      throw launchError;
    }

    try {
      const result = await searchWithBrowser(
        browser,
        keyword,
        videosPerSearch,
        i,
        useProfile, // プロファイル使用時はインコグニートにしない
        (msg) => {
          if (onProgress) onProgress(msg, 10 + i * 25);
        }
      );
      searches.push(result);
    } finally {
      await browser.close();
    }

    // 次の検索前に間隔を空ける
    if (i < 2) {
      if (onProgress)
        onProgress(`検索${i + 1}完了。次の検索まで待機中...`, 10 + (i + 1) * 25 - 5);
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }

  // ... 以降の重複度分析はそのまま
}
```

### Step 4: 検索関数の修正

`searchInIncognitoContext` を修正して、プロファイル使用時はインコグニートコンテキストを作らないようにする：

```typescript
async function searchWithBrowser(
  browser: Browser,
  keyword: string,
  maxVideos: number,
  sessionIndex: number,
  usePersistentProfile: boolean,
  onProgress?: (message: string) => void
): Promise<TikTokSearchResult> {
  let page: Page;
  let context: any = null;

  if (usePersistentProfile) {
    // 永続プロファイル: デフォルトコンテキストを使用
    // → Cookie、LocalStorage がプロファイルに保存される
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
  } else {
    // インコグニート: 従来通り（フォールバック）
    context = await browser.createBrowserContext();
    page = await context.newPage();
  }

  try {
    // ここから先は既存のページ設定コード（viewport, UA, proxy auth等）
    await page.setViewport({ width: 800, height: 600 });
    await page.setUserAgent(USER_AGENTS[sessionIndex % USER_AGENTS.length]);
    // ... 残りは既存コードと同じ
  } finally {
    if (context) {
      await context.close();
    }
  }
}
```

### Step 5: Stealth Pluginの有効化（バグ修正）

現在 `StealthPlugin` がインポートされているだけで **適用されていない**。
`puppeteer-core` → `puppeteer-extra` に切り替える：

```typescript
// Before（現状 - バグ）
import puppeteer from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
const stealthPlugin = StealthPlugin(); // 使われていない！

// After（修正後）
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteerExtra.use(StealthPlugin());

// launch時
const browser = await puppeteerExtra.launch({
  executablePath: chromiumPath,
  headless: true,
  args: buildChromiumArgs(),
  userDataDir: useProfile ? ensureProfileDir(i) : undefined,
});
```

> **注意**: `puppeteer-extra` パッケージが必要。未インストールの場合：
> ```bash
> npm install puppeteer-extra
> ```

### Step 6: プロファイルの初回ウォームアップ

初回起動時にTikTokのトップページを訪問し、Cookieを生成する仕組み：

```typescript
/**
 * プロファイルのウォームアップ
 * 初回のみTikTokトップを訪問してCookieを設定する
 */
async function warmupProfile(page: Page, sessionIndex: number): Promise<void> {
  const markerFile = path.join(PROFILE_BASE_DIR, `profile-${sessionIndex}`, ".warmed-up");

  if (fs.existsSync(markerFile)) {
    console.log(`[Chrome Profile ${sessionIndex}] Already warmed up, skipping`);
    return;
  }

  console.log(`[Chrome Profile ${sessionIndex}] First run - warming up profile...`);

  try {
    // TikTokトップページを訪問（Cookieが自動設定される）
    await page.goto("https://www.tiktok.com/ja-JP", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 人間らしい動きをシミュレート
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

    // 少しスクロール
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });

    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

    // ウォームアップ完了マーカーを書き込み
    fs.writeFileSync(markerFile, new Date().toISOString());
    console.log(`[Chrome Profile ${sessionIndex}] Warmup complete`);
  } catch (error) {
    console.warn(`[Chrome Profile ${sessionIndex}] Warmup failed:`, error);
    // ウォームアップ失敗でも検索は続行する
  }
}
```

---

## AWS環境での設定

### ディスク容量

| 項目 | サイズ |
|------|--------|
| 空のプロファイル | ~5MB |
| ウォームアップ済み | ~20-50MB |
| プロファイル × 3 | ~60-150MB |

**推奨**: `/data` に最低 **500MB** の空き容量を確保。

### EBS/EFSの選択

| ストレージ | メリット | デメリット |
|-----------|---------|-----------|
| **EBS** (推奨) | 高速、低コスト | EC2にアタッチ必要 |
| **EFS** | 複数インスタンス共有可 | 若干遅い、コスト高 |
| **ローカルSSD** | 最速 | インスタンス停止で消失 |

**推奨構成**: EBSボリューム（gp3、最小10GB）を `/data` にマウント。

### package.json の build スクリプト修正

プロファイルディレクトリを自動作成するよう追加：

```json
{
  "scripts": {
    "build": "mkdir -p /data/chrome-profiles/profile-{0,1,2} && ... 既存のビルドコマンド",
    "start": "mkdir -p /data/chrome-profiles/profile-{0,1,2} && ... 既存のstartコマンド"
  }
}
```

### 環境変数の設定

AWS環境（EC2/ECS/Lambda等）に以下を設定：

```bash
# 必須
CHROME_PROFILE_DIR=/data/chrome-profiles
USE_CHROME_PROFILE=true

# 既存（Bright Dataプロキシ）
PROXY_SERVER=http://brd.superproxy.io:22225
PROXY_USERNAME=brd-customer-xxx-zone-residential_proxy1
PROXY_PASSWORD=xxxxx
```

---

## プロファイル管理

### 定期クリーンアップ

プロファイルが肥大化した場合のリセットスクリプト：

```typescript
/**
 * プロファイルをリセット（肥大化や問題発生時）
 */
function resetProfile(sessionIndex: number): void {
  const profileDir = path.join(PROFILE_BASE_DIR, `profile-${sessionIndex}`);

  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
    console.log(`[Chrome Profile] Reset profile-${sessionIndex}`);
  }

  // 再作成
  ensureProfileDir(sessionIndex);
}

/**
 * 全プロファイルをリセット
 */
function resetAllProfiles(): void {
  for (let i = 0; i < 3; i++) {
    resetProfile(i);
  }
}
```

### 推奨リセットタイミング

- **週次**: 自動クリーンアップ（cronジョブ等）
- **CAPTCHAが頻発した時**: 該当プロファイルをリセット
- **プロファイルが100MBを超えた時**: リセット

```bash
# cron例: 毎週日曜深夜3時にリセット
0 3 * * 0 rm -rf /data/chrome-profiles/profile-* && mkdir -p /data/chrome-profiles/profile-{0,1,2}
```

---

## ロック機構（同時アクセス防止）

同じプロファイルを複数プロセスが同時使用するとクラッシュする。
ファイルロックで排他制御する：

```typescript
/**
 * プロファイルのロックファイルを使った排他制御
 */
function acquireProfileLock(sessionIndex: number): boolean {
  const lockFile = path.join(PROFILE_BASE_DIR, `profile-${sessionIndex}`, ".lock");

  if (fs.existsSync(lockFile)) {
    // ロックが古すぎる場合（10分以上）は強制解放
    const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (lockAge > 10 * 60 * 1000) {
      console.warn(`[Chrome Profile] Stale lock detected on profile-${sessionIndex}, forcing release`);
      fs.unlinkSync(lockFile);
    } else {
      return false; // ロック中
    }
  }

  fs.writeFileSync(lockFile, `${process.pid}-${Date.now()}`);
  return true;
}

function releaseProfileLock(sessionIndex: number): void {
  const lockFile = path.join(PROFILE_BASE_DIR, `profile-${sessionIndex}`, ".lock");
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
}
```

---

## 全体の変更一覧

| ファイル | 変更内容 |
|---------|---------|
| `server/tiktokScraper.ts` | `puppeteer-extra` に切り替え、`userDataDir` 対応、ウォームアップ追加 |
| `.env` | `CHROME_PROFILE_DIR`, `USE_CHROME_PROFILE` 追加 |
| `package.json` | `puppeteer-extra` 依存追加、start/buildスクリプトにmkdir追加 |

### 期待される効果

1. **CAPTCHA発生率**: 大幅低下（住宅プロキシ + 永続プロファイル + Stealth Plugin）
2. **検索速度**: ウォームアップ済みならCookie再設定不要で若干高速化
3. **安定性**: TikTokがリピーターとして認識 → レート制限緩和

### リスクと対策

| リスク | 対策 |
|--------|------|
| プロファイル肥大化 | 週次クリーンアップ |
| 同時アクセス | ファイルロック機構 |
| プロファイル破損 | リセット機能 + フォールバック（インコグニート） |
| ディスク不足 | モニタリング + アラート |
