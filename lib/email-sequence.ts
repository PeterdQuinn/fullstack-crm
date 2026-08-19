export const FOLLOW_UP_DELAY_DAYS = 3;

export function nextFollowUpAt(from = new Date()): string {
  return new Date(
    from.getTime() + FOLLOW_UP_DELAY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}
