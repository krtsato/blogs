// 日時系のユーティリティ

export function subDays(timestampMs: number, days: number): number {
  return timestampMs - days * 24 * 60 * 60 * 1000;
}
