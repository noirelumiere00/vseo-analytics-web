import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { ENV } from "./env";

let sesClient: SESClient | null = null;

function getSESClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: ENV.awsRegion,
      credentials: {
        accessKeyId: ENV.awsAccessKeyId,
        secretAccessKey: ENV.awsSecretAccessKey,
      },
    });
  }
  return sesClient;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const client = getSESClient();
  const from = ENV.sesFromAddress || "noreply@example.com";

  const command = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: "【VSEO Analytics】パスワードリセット", Charset: "UTF-8" },
      Body: {
        Html: {
          Data: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>パスワードリセット</h2>
              <p>VSEO Analyticsのパスワードリセットが要求されました。</p>
              <p>以下のリンクをクリックして新しいパスワードを設定してください（有効期限: 1時間）：</p>
              <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">パスワードをリセット</a></p>
              <p style="color: #666; font-size: 12px; margin-top: 24px;">このメールに心当たりがない場合は無視してください。</p>
            </div>
          `,
          Charset: "UTF-8",
        },
        Text: {
          Data: `VSEO Analytics パスワードリセット\n\n以下のURLからパスワードを再設定してください（有効期限: 1時間）：\n${resetUrl}\n\nこのメールに心当たりがない場合は無視してください。`,
          Charset: "UTF-8",
        },
      },
    },
  });

  try {
    await client.send(command);
    console.log(`[Email] Password reset email sent to ${to}`);
  } catch (error) {
    console.error("[Email] Failed to send password reset email:", error);
    // Don't throw — caller should always return success to prevent email enumeration
  }
}
