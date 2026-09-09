import { EMAIL_FAILURE_STATUS } from "@/lib/suppression";

// What is actually in each queue, defined once.
//
// These lists existed in three places that had drifted apart. The dashboard
// badge counted "Call Needed" and "Ready for Outreach"; the call queue page it
// links to listed eight statuses. The dashboard said one number, the page showed
// another, and neither was wrong about its own definition. A queue's contents
// and its count must come from the same list.

/** Leads the Email Workspace lists and send-batch will mail. */
export const EMAIL_QUEUE_STATUSES = [
  "Ready for Outreach",
  "Email 1 Sent",
  "Email 2 Sent",
  "Follow-Up Scheduled",
] as const;

/** Leads worth a phone call. Includes dead-address leads: see lib/suppression. */
export const CALL_QUEUE_STATUSES = [
  "Call Needed",
  "Ready for Outreach",
  "No Answer",
  "Follow-Up",
  "Follow-Up Scheduled",
  "Needs Follow-Up",
  "Interested",
  EMAIL_FAILURE_STATUS,
] as const;

/** Reached an end state. Never work-queue material. */
export const TERMINAL_STATUSES = [
  "Won", "Lost", "Dead", "No Response", "Do Not Contact", "Bad Data",
] as const;

// NOTE: lib/automation.ts keeps its own, narrower SENDABLE_STATUSES on purpose.
// Automated touch 1 only ever goes to "Ready for Outreach" / "Follow-Up
// Scheduled"; touches 2 and 3 belong to process-followups, which knows how to
// stop on a reply. That narrowness is a safety property, not drift.
