export const FOLLOW_UP_DELAY_DAYS = 3;
export const MANUAL_SEND_CAP = 100;

export function nextFollowUpAt(from = new Date()): string {
  return new Date(
    from.getTime() + FOLLOW_UP_DELAY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}
