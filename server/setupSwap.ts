import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

/**
 * 2GB のスワップファイルを構築し、メモリ不足を補う
 * 本番環境で 890MB のメモリ制限を超えるために使用
 */
export function setupSwap(): void {
  try {
    // スワップファイルのパス
    const swapFile = "/tmp/swapfile";
    const swapSizeMB = 2048; // 2GB

    // スワップファイルが既に存在するか確認
    if (fs.existsSync(swapFile)) {
      console.log("[Swap] Swap file already exists, skipping setup");
      return;
    }

    console.log(`[Swap] Creating ${swapSizeMB}MB swap file at ${swapFile}...`);

    // スワップファイルを作成（dd コマンド）
    try {
      execSync(`dd if=/dev/zero of=${swapFile} bs=1M count=${swapSizeMB}`, {
        stdio: "pipe",
      });
      console.log("[Swap] Swap file created successfully");
    } catch (e) {
      console.warn("[Swap] Failed to create swap file with dd, trying fallocate...");
      try {
        execSync(`fallocate -l ${swapSizeMB}M ${swapFile}`, {
          stdio: "pipe",
        });
        console.log("[Swap] Swap file created successfully with fallocate");
      } catch (e2) {
        console.warn("[Swap] Both dd and fallocate failed, skipping swap setup");
        return;
      }
    }

    // スワップファイルのパーミッションを設定
    try {
      execSync(`chmod 600 ${swapFile}`, { stdio: "pipe" });
      console.log("[Swap] Swap file permissions set");
    } catch (e) {
      console.warn("[Swap] Failed to set swap file permissions");
    }

    // スワップファイルをフォーマット
    try {
      execSync(`mkswap ${swapFile}`, { stdio: "pipe" });
      console.log("[Swap] Swap file formatted");
    } catch (e) {
      console.warn("[Swap] Failed to format swap file");
    }

    // スワップを有効化
    try {
      execSync(`swapon ${swapFile}`, { stdio: "pipe" });
      console.log("[Swap] Swap enabled successfully");
    } catch (e) {
      console.warn("[Swap] Failed to enable swap (may require root privileges)");
    }

    // スワップ情報を表示
    try {
      const swapInfo = execSync("free -h", { encoding: "utf-8" });
      console.log("[Swap] Current memory status:\n" + swapInfo);
    } catch (e) {
      console.warn("[Swap] Failed to display swap info");
    }
  } catch (error) {
    console.error("[Swap] Error during swap setup:", error);
  }
}

/**
 * スワップを無効化（クリーンアップ）
 */
export function cleanupSwap(): void {
  try {
    const swapFile = "/tmp/swapfile";

    if (!fs.existsSync(swapFile)) {
      console.log("[Swap] Swap file does not exist, skipping cleanup");
      return;
    }

    console.log("[Swap] Disabling swap...");

    try {
      execSync(`swapoff ${swapFile}`, { stdio: "pipe" });
      console.log("[Swap] Swap disabled");
    } catch (e) {
      console.warn("[Swap] Failed to disable swap");
    }

    try {
      fs.unlinkSync(swapFile);
      console.log("[Swap] Swap file removed");
    } catch (e) {
      console.warn("[Swap] Failed to remove swap file");
    }
  } catch (error) {
    console.error("[Swap] Error during cleanup:", error);
  }
}
