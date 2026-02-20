/**
 * インメモリログバッファ
 * 本番環境では .manus-logs/devserver.log が存在しないため、
 * console.log/error/warn をインターセプトしてメモリ上にログを保持する。
 * /admin/logs エンドポイントからこのバッファを読み取る。
 */

const MAX_LOG_LINES = 2000;

interface LogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
}

class LogBuffer {
  private buffer: LogEntry[] = [];
  private initialized = false;

  /**
   * console.log/error/warn をインターセプトしてバッファに追加する。
   * サーバー起動時に1回だけ呼ぶ。
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;

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

    this.push('log', ['[LogBuffer] Initialized - capturing console output to memory']);
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

    this.buffer.push({
      timestamp: new Date().toISOString(),
      level,
      message,
    });

    // バッファサイズを制限
    if (this.buffer.length > MAX_LOG_LINES) {
      this.buffer = this.buffer.slice(-MAX_LOG_LINES);
    }
  }

  /**
   * 最新N行のログを取得
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
