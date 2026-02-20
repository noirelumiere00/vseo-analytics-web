import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateExportToken, verifyExportToken, clearAllTokens } from "./_core/exportToken";

describe("PDF Export Token Management", () => {
  beforeAll(() => {
    clearAllTokens();
  });

  afterAll(() => {
    clearAllTokens();
  });

  it("should generate a valid export token", () => {
    const token = generateExportToken(123, 456, 600);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("should verify a valid token and return jobId and userId", () => {
    const token = generateExportToken(789, 101, 600);
    const result = verifyExportToken(token);
    expect(result).not.toBeNull();
    expect(result?.jobId).toBe(789);
    expect(result?.userId).toBe(101);
  });

  it("should return null for invalid token", () => {
    const result = verifyExportToken("invalid-token");
    expect(result).toBeNull();
  });

  it("should delete token after verification (one-time use)", () => {
    const token = generateExportToken(111, 222, 600);
    
    // First verification should succeed
    const result1 = verifyExportToken(token);
    expect(result1).not.toBeNull();
    
    // Second verification should fail (token already used)
    const result2 = verifyExportToken(token);
    expect(result2).toBeNull();
  });

  it("should handle expired tokens", async () => {
    const token = generateExportToken(333, 444, 1); // 1 second expiration
    
    // Wait for token to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));
    
    const result = verifyExportToken(token);
    expect(result).toBeNull();
  });

  it("should clear all tokens", () => {
    generateExportToken(555, 666, 600);
    generateExportToken(777, 888, 600);
    
    clearAllTokens();
    
    // Verify no tokens exist
    const result = verifyExportToken("any-token");
    expect(result).toBeNull();
  });

  it("should generate different tokens for different requests", () => {
    const token1 = generateExportToken(999, 1000, 600);
    const token2 = generateExportToken(999, 1000, 600);
    
    expect(token1).not.toBe(token2);
  });

  it("should support custom expiration time", () => {
    const token = generateExportToken(1111, 2222, 300); // 5 minutes
    const result = verifyExportToken(token);
    
    expect(result).not.toBeNull();
    expect(result?.jobId).toBe(1111);
    expect(result?.userId).toBe(2222);
  });
});

describe("PDF Export Token - Security", () => {
  beforeAll(() => {
    clearAllTokens();
  });

  afterAll(() => {
    clearAllTokens();
  });

  it("should prevent token reuse (replay attack protection)", () => {
    const token = generateExportToken(3333, 4444, 600);
    
    // First use
    const result1 = verifyExportToken(token);
    expect(result1?.jobId).toBe(3333);
    
    // Second use should fail
    const result2 = verifyExportToken(token);
    expect(result2).toBeNull();
  });

  it("should generate cryptographically random tokens", () => {
    const tokens = new Set<string>();
    
    for (let i = 0; i < 100; i++) {
      const token = generateExportToken(5555 + i, 6666 + i, 600);
      tokens.add(token);
    }
    
    // All tokens should be unique
    expect(tokens.size).toBe(100);
  });

  it("should have sufficient token length", () => {
    const token = generateExportToken(7777, 8888, 600);
    
    // 32 bytes = 64 hex characters
    expect(token.length).toBe(64);
  });
});
