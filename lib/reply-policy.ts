export type ReplyBucket = "interested" | "not_interested" | "unclear";

const POSITIVE = new Set(["Interested", "Asked Price", "Send Info"]);
const NEGATIVE = new Set(["Not Interested", "Stop"]);

/**
 * Pure reply policy shared by production actions and contract tests.
 * Wrong Person deliberately requires human review: the company may still be a
 * valid prospect even though the current contact is not.
 */
export function bucketForCategory(category: string): ReplyBucket {
  if (POSITIVE.has(category)) return "interested";
  if (NEGATIVE.has(category)) return "not_interested";
  return "unclear";
}
