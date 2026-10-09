import type { LyricLine } from './contracts';

export function activeLyric(lines: LyricLine[], seconds: number): LyricLine | undefined {
  let current: LyricLine | undefined;
  for (const line of lines) {
    if (line.timeSeconds > seconds) break;
    current = line;
  }
  return current;
}
