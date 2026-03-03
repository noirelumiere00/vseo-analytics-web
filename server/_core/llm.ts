import { ENV } from "./env";

export class LLMQuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMQuotaExhaustedError";
  }
}

// === 型定義（変更なし・そのまま維持） ===
export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

// ★ InvokeResult はそのまま維持（呼び出し側は一切変更不要にする）
export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ================================================================
// Bedrock Converse API 用ヘルパー
// ================================================================

/**
 * 絵文字・制御文字を除去して Bedrock Converse API の JSON シリアライゼーションエラーを防ぐ
 */
function sanitizeForBedrock(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u{1F600}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{200D}\u{20E3}\u{FE0F}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * messages配列から system role を抽出して Bedrock の system パラメータに変換
 * Bedrock Converse API は system を messages に含めず別パラメータで渡す
 */
function extractSystemAndMessages(messages: Message[]): {
  system: Array<{ text: string }>;
  bedrockMessages: Array<{ role: string; content: Array<{ text: string }> }>;
} {
  const system: Array<{ text: string }> = [];
  const bedrockMessages: Array<{ role: string; content: Array<{ text: string }> }> = [];

  for (const msg of messages) {
    const textContent = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .map(c => (typeof c === "string" ? c : c.type === "text" ? c.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";

    if (msg.role === "system") {
      system.push({ text: sanitizeForBedrock(textContent) });
    } else {
      bedrockMessages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: [{ text: sanitizeForBedrock(textContent) }],
      });
    }
  }

  return { system, bedrockMessages };
}

/**
 * response_format の json_schema 指定がある場合、
 * プロンプト末尾に JSON スキーマ指示を注入する
 * （Bedrock Converse API には json_schema モードがないため）
 */
function injectJsonSchemaInstruction(
  bedrockMessages: Array<{ role: string; content: Array<{ text: string }> }>,
  responseFormat?: ResponseFormat
): void {
  if (!responseFormat) return;

  if (responseFormat.type === "json_schema" && responseFormat.json_schema?.schema) {
    const schemaStr = JSON.stringify(responseFormat.json_schema.schema, null, 2);
    const instruction = `\n\n【出力形式の厳守】以下のJSONスキーマに完全に準拠したJSONのみを返してください。JSONの前後にマークダウンのコードブロック(\`\`\`)や説明文を付けないでください。\n${schemaStr}`;

    // 最後の user メッセージにスキーマ指示を追加
    const lastUserMsg = [...bedrockMessages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      lastUserMsg.content[lastUserMsg.content.length - 1].text += instruction;
    }
  } else if (responseFormat.type === "json_object") {
    const instruction = `\n\n【出力形式】有効なJSONのみを返してください。JSONの前後にマークダウンのコードブロックや説明文を付けないでください。`;
    const lastUserMsg = [...bedrockMessages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      lastUserMsg.content[lastUserMsg.content.length - 1].text += instruction;
    }
  }
}

/**
 * Bedrock Converse API のレスポンスを InvokeResult 形式に変換
 * → 呼び出し側（videoAnalysis.ts 等）の choices[0].message.content を変更不要にする
 */
function convertBedrockResponse(bedrockRes: any, modelId: string): InvokeResult {
  const outputText = bedrockRes.output?.message?.content
    ?.map((c: any) => c.text || "")
    .join("") || "";

  return {
    id: bedrockRes.$metadata?.requestId || "",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outputText,
        },
        finish_reason: bedrockRes.stopReason || "end_turn",
      },
    ],
    usage: bedrockRes.usage
      ? {
          prompt_tokens: bedrockRes.usage.inputTokens || 0,
          completion_tokens: bedrockRes.usage.outputTokens || 0,
          total_tokens: (bedrockRes.usage.inputTokens || 0) + (bedrockRes.usage.outputTokens || 0),
        }
      : undefined,
  };
}

// ================================================================
// メイン関数
// ================================================================

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  // AWS SDK は動的 import（トップレベルで import するとビルドサイズが膨れるため）
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({
    region: ENV.awsRegion,
    credentials: {
      accessKeyId: ENV.awsAccessKeyId,
      secretAccessKey: ENV.awsSecretAccessKey,
    },
  });

  const modelId = ENV.bedrockModelId;
  const maxTokens = params.maxTokens || params.max_tokens || 8192;

  // メッセージを Bedrock 形式に変換
  const { system, bedrockMessages } = extractSystemAndMessages(params.messages);

  // response_format の json_schema をプロンプトに注入
  const resolvedFormat =
    params.responseFormat || params.response_format || undefined;
  injectJsonSchemaInstruction(bedrockMessages, resolvedFormat);

  const command = new ConverseCommand({
    modelId,
    system,
    messages: bedrockMessages,
    inferenceConfig: {
      maxTokens,
      temperature: 0.7,
    },
  });

  try {
    const response = await client.send(command);
    return convertBedrockResponse(response, modelId);
  } catch (error: any) {
    if (
      error.name === "ThrottlingException" ||
      error.message?.includes("Too many requests") ||
      error.message?.includes("quota")
    ) {
      throw new LLMQuotaExhaustedError(
        `LLM invoke failed: ${error.name} – ${error.message}`
      );
    }
    throw new Error(`LLM invoke failed: ${error.name} – ${error.message}`);
  }
}
