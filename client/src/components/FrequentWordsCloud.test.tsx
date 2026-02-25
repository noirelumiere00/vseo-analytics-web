import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrequentWordsCloud } from "./FrequentWordsCloud";
import "@testing-library/jest-dom";

describe("FrequentWordsCloud", () => {
  it("ポジティブワードとネガティブワードを正しく表示する", () => {
    const positiveWords = [
      { word: "素晴らしい", count: 10 },
      { word: "良い", count: 8 },
      { word: "最高", count: 6 },
    ];
    const negativeWords = [
      { word: "悪い", count: 5 },
      { word: "つまらない", count: 3 },
    ];

    render(
      <FrequentWordsCloud
        positiveWords={positiveWords}
        negativeWords={negativeWords}
      />
    );

    // ポジティブワードが表示されているか確認
    expect(screen.getByText("素晴らしい")).toBeTruthy();
    expect(screen.getByText("良い")).toBeTruthy();
    expect(screen.getByText("最高")).toBeTruthy();

    // ネガティブワードが表示されているか確認
    expect(screen.getByText("悪い")).toBeTruthy();
    expect(screen.getByText("つまらない")).toBeTruthy();

    // セクションタイトルが表示されているか確認
    expect(screen.getByText("ポジティブワード")).toBeTruthy();
    expect(screen.getByText("ネガティブワード")).toBeTruthy();
  });

  it("ワードがない場合は「データなし」を表示する", () => {
    render(
      <FrequentWordsCloud positiveWords={[]} negativeWords={[]} />
    );

    const dataNotFound = screen.getAllByText("データなし");
    expect(dataNotFound.length).toBe(2); // ポジティブとネガティブの両方
  });

  it("ポジティブワードのみがある場合は、ポジティブワードのみ表示される", () => {
    const positiveWords = [
      { word: "素晴らしい", count: 10 },
    ];

    render(
      <FrequentWordsCloud
        positiveWords={positiveWords}
        negativeWords={[]}
      />
    );

    expect(screen.getByText("素晴らしい")).toBeTruthy();
    expect(screen.getAllByText("データなし").length).toBe(1);
  });

  it("ネガティブワードのみがある場合は、ネガティブワードのみ表示される", () => {
    const negativeWords = [
      { word: "悪い", count: 5 },
    ];

    render(
      <FrequentWordsCloud
        positiveWords={[]}
        negativeWords={negativeWords}
      />
    );

    expect(screen.getByText("悪い")).toBeTruthy();
    expect(screen.getAllByText("データなし").length).toBe(1);
  });

  it("複数のワードが正しく表示される", () => {
    const positiveWords = [
      { word: "素晴らしい", count: 15 },
      { word: "良い", count: 12 },
      { word: "最高", count: 10 },
      { word: "楽しい", count: 8 },
    ];
    const negativeWords = [
      { word: "悪い", count: 7 },
      { word: "つまらない", count: 5 },
      { word: "がっかり", count: 3 },
    ];

    render(
      <FrequentWordsCloud
        positiveWords={positiveWords}
        negativeWords={negativeWords}
      />
    );

    // すべてのワードが表示されているか確認
    positiveWords.forEach((w) => {
      expect(screen.getByText(w.word)).toBeTruthy();
    });
    negativeWords.forEach((w) => {
      expect(screen.getByText(w.word)).toBeTruthy();
    });
  });
});
