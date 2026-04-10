/**
 * ログバッファ（インメモリ＋ファイル永続化）
 * console.log/error/warn をインターセプトし、メモリとファイルの両方にログを保持する。
 * /admin/logs エンドポイントからこのバッファを読み取る。
 */

import fs from "fs";
import path from "path";

const MAX_LOG_LINES = 2000;
const LOG_DIR = path.resolve(process.cwd(), "data", "logs");
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB — ローテーション閾値

interface LogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
}

class LogBuffer {
  private buffer: LogEntry[] = [];
  private initialized = false;
  private logStream: fs.WriteStream | null = null;
  private currentLogFile: string = "";
  private writesSinceCheck: number = 0;
  private estimatedFileSize: number = 0;

  /**
   * console.log/error/warn をインターセプトしてバッファ＋ファイルに追加する。
   * サーバー起動時に1回だけ呼ぶ。
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;

    // ログディレクトリ作成
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      this.openLogStream();
    } catch (err) {
      // ファイルシステムが使えない場合はメモリのみで動作
      console.warn("[LogBuffer] Failed to create log directory, running in memory-only mode:", err);
    }

    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalInfo = console.info.bind(console);

    const self = this;

    console.log = (...args: any[]) => {
      self.push('log', args);
      originalLog(...args);
    };

    console.error = (...args: any[]) => {
      self.push('error', args);
      originalError(...args);
    };

    console.warn = (...args: any[]) => {
      self.push('warn', args);
      originalWarn(...args);
    };

    console.info = (...args: any[]) => {
      self.push('info', args);
      originalInfo(...args);
    };

    this.push('log', ['[LogBuffer] Initialized - capturing to memory + file']);
  }

  private openLogStream() {
    const dateStr = new Date().toISOString().slice(0, 10); // "2026-04-06"
    this.currentLogFile = path.join(LOG_DIR, `app-${dateStr}.log`);
    this.logStream = fs.createWriteStream(this.currentLogFile, { flags: "a" });
    this.logStream.on("error", () => {
      // ストリームエラー時はnullにしてメモリのみモードにフォールバック
      this.logStream = null;
    });
  }

  /** 日付が変わった場合やサイズ超過時にログファイルをローテーション */
  private maybeRotate() {
    if (!this.logStream) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const expectedFile = path.join(LOG_DIR, `app-${dateStr}.log`);
    if (expectedFile !== this.currentLogFile) {
      this.logStream.end();
      this.openLogStream();
      return;
    }
    // サイズベースローテーション（推定サイズで判定、statSync不要）
    if (this.estimatedFileSize > MAX_LOG_FILE_SIZE) {
      try {
        this.logStream.end();
        const rotatedName = this.currentLogFile.replace(".log", `-${Date.now()}.log`);
        fs.renameSync(this.currentLogFile, rotatedName);
        this.openLogStream();
      } catch {
        // ローテーション失敗は無視（次の書き込みで再試行）
      }
    }
  }

  private push(level: LogEntry['level'], args: any[]) {
    const message = args.map(a => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a, null, 0);
      } catch {
        return String(a);
      }
    }).join(' ');

    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level, message };

    // メモリバッファに追加
    this.buffer.push(entry);
    if (this.buffer.length > MAX_LOG_LINES) {
      this.buffer = this.buffer.slice(-MAX_LOG_LINES);
    }

    // ファイルに追記
    if (this.logStream) {
      const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
      this.logStream.write(line);
      this.estimatedFileSize += Buffer.byteLength(line, "utf-8");
      this.writesSinceCheck++;
      // 100回書き込みごとにローテーションチェック（毎回statSyncを呼ばない）
      if (this.writesSinceCheck >= 100) {
        this.writesSinceCheck = 0;
        this.maybeRotate();
      }
    }
  }

  /**
   * 最新N行のログを取得（メモリバッファから）
   */
  getLines(count: number = 500): string[] {
    const recent = this.buffer.slice(-count);
    return recent.map(entry => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`);
  }

  /**
   * バッファの総行数
   */
  get totalLines(): number {
    return this.buffer.length;
  }
}

// シングルトンインスタンス
export const logBuffer = new LogBuffer();
