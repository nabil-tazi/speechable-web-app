import type { DiffSegment } from "../types";

/**
 * Computes a word-level diff between two strings using LCS algorithm.
 * Returns an array of segments marking unchanged, removed, and added text.
 */
export function computeWordDiff(original: string, updated: string): DiffSegment[] {
  // Tokenize preserving whitespace and separating punctuation
  const tokenize = (text: string): string[] => {
    const tokens: string[] = [];
    let current = "";
    const punctuation = /[.,;:!?'"()[\]{}\-—–]/;
    for (const char of text) {
      if (/\s/.test(char)) {
        // Whitespace - push current word, then push whitespace
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(char);
      } else if (punctuation.test(char)) {
        // Punctuation - push current word, then push punctuation as separate token
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(char);
      } else {
        current += char;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  };

  const originalTokens = tokenize(original);
  const updatedTokens = tokenize(updated);

  // Simple LCS-based diff
  const m = originalTokens.length;
  const n = updatedTokens.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalTokens[i - 1] === updatedTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const segments: DiffSegment[] = [];
  let i = m,
    j = n;
  const tempSegments: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalTokens[i - 1] === updatedTokens[j - 1]) {
      tempSegments.push({ type: "unchanged", text: originalTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempSegments.push({ type: "added", text: updatedTokens[j - 1] });
      j--;
    } else {
      tempSegments.push({ type: "removed", text: originalTokens[i - 1] });
      i--;
    }
  }

  // Reverse and merge consecutive segments of the same type
  tempSegments.reverse();
  for (const seg of tempSegments) {
    const last = segments[segments.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      segments.push({ ...seg });
    }
  }

  return segments;
}
