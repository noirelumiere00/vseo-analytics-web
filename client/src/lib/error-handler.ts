import { toast } from "sonner";

interface ErrorMessage {
  title: string;
  description: string;
  action?: string;
}

const ERROR_MAP: Record<string, ErrorMessage> = {
  UNAUTHORIZED: {
    title: "ログインが必要です",
    description: "再ログインしてください",
  },
  FORBIDDEN: {
    title: "権限がありません",
    description: "この操作を行う権限がありません",
  },
  TOO_MANY_REQUESTS: {
    title: "利用上限に達しました",
    description: "リクエストの上限に達しました",
    action: "プランのアップグレードをご検討ください",
  },
  TIMEOUT: {
    title: "タイムアウトしました",
    description: "リクエストがタイムアウトしました",
    action: "しばらくしてから再試行してください",
  },
  NOT_FOUND: {
    title: "データが見つかりません",
    description: "お探しのデータは存在しないか、削除された可能性があります",
  },
};

const DEFAULT_ERROR: ErrorMessage = {
  title: "エラーが発生しました",
  description: "予期しないエラーが発生しました",
  action: "しばらくしてから再試行してください",
};

function getTrpcErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "code" in error.data
  ) {
    return String((error.data as { code: string }).code);
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: string }).message);
    for (const code of Object.keys(ERROR_MAP)) {
      if (message.includes(code)) return code;
    }
  }

  return undefined;
}

export function getErrorMessage(error: unknown): ErrorMessage {
  const code = getTrpcErrorCode(error);
  if (code && code in ERROR_MAP) {
    return ERROR_MAP[code];
  }
  return DEFAULT_ERROR;
}

export function handleTrpcError(error: unknown): void {
  const { title, description, action } = getErrorMessage(error);
  toast.error(title, {
    description: action ? `${description}\n${action}` : description,
  });
}
