import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Comparison from "./Comparison";
import * as wouter from "wouter";
import * as trpcLib from "@/lib/trpc";

// Mock dependencies
vi.mock("wouter", () => ({
  useLocation: vi.fn(),
  useSearch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    analysis: {
      getById: {
        useQuery: vi.fn(),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: vi.fn(() => ({ user: { id: 1, name: "Test User" } })),
}));

describe("Comparison Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show error when comparison IDs are missing", () => {
    vi.mocked(wouter.useSearch).mockReturnValue("");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);

    render(<Comparison />);
    expect(screen.getByText("比較対象が指定されていません")).toBeInTheDocument();
  });

  it("should show loading state when data is loading", () => {
    vi.mocked(wouter.useSearch).mockReturnValue("?a=1&b=2");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);
    vi.mocked(trpcLib.trpc.analysis.getById.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    const { container } = render(<Comparison />);
    // Check if a loading container is rendered
    const loadingContainer = container.querySelector(".min-h-screen");
    expect(loadingContainer).toBeInTheDocument();
  });

  it("should show error when data is not available", () => {
    vi.mocked(wouter.useSearch).mockReturnValue("?a=1&b=2");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);
    vi.mocked(trpcLib.trpc.analysis.getById.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as any);

    render(<Comparison />);
    expect(screen.getByText("分析データを取得できませんでした")).toBeInTheDocument();
  });

  it("should render comparison page with valid data", () => {
    const mockData = {
      job: { keyword: "test", createdAt: new Date() },
      videos: [
        {
          id: 1,
          viewCount: 1000,
          likeCount: 100,
          commentCount: 50,
          shareCount: 20,
          saveCount: 10,
          score: { overallScore: 80 },
        },
      ],
      report: {
        positiveCount: 1,
        neutralCount: 0,
        negativeCount: 0,
      },
      tripleSearch: {
        duplicateAnalysis: {
          overlapRate: 50,
          appearedInAll3Count: 5,
          appearedIn2Count: 3,
        },
      },
    };

    vi.mocked(wouter.useSearch).mockReturnValue("?a=1&b=2");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);
    vi.mocked(trpcLib.trpc.analysis.getById.useQuery).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as any);

    render(<Comparison />);
    expect(screen.getByText("比較レポート")).toBeInTheDocument();
  });

  it("should handle missing optional properties gracefully", () => {
    const mockData = {
      job: { keyword: "test", createdAt: new Date() },
      videos: [
        {
          id: 1,
          viewCount: null,
          likeCount: null,
          commentCount: null,
          shareCount: null,
          saveCount: null,
          score: null,
        },
      ],
      report: null,
      tripleSearch: null,
    };

    vi.mocked(wouter.useSearch).mockReturnValue("?a=1&b=2");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);
    vi.mocked(trpcLib.trpc.analysis.getById.useQuery).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as any);

    render(<Comparison />);
    expect(screen.getByText("比較レポート")).toBeInTheDocument();
  });

  it("should calculate metrics with proper property names", () => {
    const mockData = {
      job: { keyword: "test", createdAt: new Date() },
      videos: [
        {
          id: 1,
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          shareCount: 2,
          saveCount: 3,
          score: { overallScore: 80 },
        },
      ],
      report: {
        positiveCount: 50,
        neutralCount: 30,
        negativeCount: 20,
      },
      tripleSearch: {
        duplicateAnalysis: {
          overlapRate: 0,
          appearedInAll3Count: 0,
          appearedIn2Count: 0,
        },
      },
    };

    vi.mocked(wouter.useSearch).mockReturnValue("?a=1&b=2");
    vi.mocked(wouter.useLocation).mockReturnValue(["", vi.fn()]);
    vi.mocked(trpcLib.trpc.analysis.getById.useQuery).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as any);

    render(<Comparison />);
    // Should render without errors
    expect(screen.getByText("比較レポート")).toBeInTheDocument();
  });
});
