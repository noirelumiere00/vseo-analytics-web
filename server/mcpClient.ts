/**
 * mcpClient.ts — X (Twitter) MCP HTTP Client
 *
 * Calls the Python FastMCP server via HTTP JSON-RPC 2.0.
 * Provides typed convenience wrappers for X search/user operations.
 * Gracefully degrades when the MCP server is not available.
 */

import { ENV } from "./_core/env";

// ================================================================
// Types
// ================================================================

export interface XPost {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount?: number;
  hashtags?: string[];
  urls?: string[];
  lang?: string;
}

export interface XUser {
  id: string;
  username: string;
  displayName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
  profileImageUrl?: string;
  createdAt?: string;
}

// ================================================================
// Core RPC caller
// ================================================================

let requestId = 0;

async function callMCP<T>(method: string, params: Record<string, unknown>): Promise<T> {
  if (!ENV.xmcpBaseUrl) {
    throw new XMCPUnavailableError("XMCP_BASE_URL is not configured");
  }

  const url = `${ENV.xmcpBaseUrl.replace(/\/+$/, "")}/rpc`;
  const body = {
    jsonrpc: "2.0",
    id: ++requestId,
    method,
    params,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 429) {
      // Rate limited — retry with exponential backoff
      const retryAfter = Number(res.headers.get("Retry-After") || "2");
      await sleep(retryAfter * 1000);
      return callMCP(method, params);
    }

    if (!res.ok) {
      throw new XMCPError(`MCP HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json() as any;
    if (json.error) {
      throw new XMCPError(`MCP RPC error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    return json.result as T;
  } catch (err: any) {
    if (err instanceof XMCPError || err instanceof XMCPUnavailableError) throw err;
    if (err.name === "AbortError") {
      throw new XMCPError("MCP request timed out (30s)");
    }
    throw new XMCPUnavailableError(`MCP connection failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ================================================================
// Error classes
// ================================================================

export class XMCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XMCPError";
  }
}

export class XMCPUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XMCPUnavailableError";
  }
}

// ================================================================
// Convenience wrappers
// ================================================================

/**
 * Search recent X posts by query string.
 * Gracefully returns empty array if MCP is unavailable.
 */
export async function searchXPosts(query: string, maxResults: number = 50): Promise<XPost[]> {
  try {
    const result = await callMCP<{ posts: XPost[] }>("searchPostsRecent", {
      query,
      max_results: maxResults,
    });
    return result.posts || [];
  } catch (err) {
    if (err instanceof XMCPUnavailableError) {
      console.warn(`[X MCP] Unavailable, skipping search for "${query}"`);
      return [];
    }
    throw err;
  }
}

/**
 * Get a user's recent posts.
 */
export async function getUserPosts(userId: string, maxResults: number = 50): Promise<XPost[]> {
  try {
    const result = await callMCP<{ posts: XPost[] }>("getUserPosts", {
      user_id: userId,
      max_results: maxResults,
    });
    return result.posts || [];
  } catch (err) {
    if (err instanceof XMCPUnavailableError) {
      console.warn(`[X MCP] Unavailable, skipping getUserPosts for ${userId}`);
      return [];
    }
    throw err;
  }
}

/**
 * Get a user's liked posts.
 */
export async function getUserLikedPosts(userId: string, maxResults: number = 50): Promise<XPost[]> {
  try {
    const result = await callMCP<{ posts: XPost[] }>("getUserLikedPosts", {
      user_id: userId,
      max_results: maxResults,
    });
    return result.posts || [];
  } catch (err) {
    if (err instanceof XMCPUnavailableError) {
      console.warn(`[X MCP] Unavailable, skipping getUserLikedPosts for ${userId}`);
      return [];
    }
    throw err;
  }
}

/**
 * Get user profile by username.
 */
export async function getUserByUsername(username: string): Promise<XUser | null> {
  try {
    return await callMCP<XUser>("getUserByUsername", { username });
  } catch (err) {
    if (err instanceof XMCPUnavailableError) {
      console.warn(`[X MCP] Unavailable, skipping getUserByUsername for @${username}`);
      return null;
    }
    throw err;
  }
}

/**
 * Check if X MCP server is available.
 */
export async function isXMCPAvailable(): Promise<boolean> {
  if (!ENV.xmcpBaseUrl) return false;
  try {
    await callMCP("ping", {});
    return true;
  } catch {
    return false;
  }
}

// ================================================================
// Helpers
// ================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
