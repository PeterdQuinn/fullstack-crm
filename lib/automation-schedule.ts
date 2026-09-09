// The schedule, in one place the UI can read.
//
// .github/workflows/cron.yml is the thing that actually fires; YAML cannot be
// imported, so this mirrors it and automation-contract-test asserts the two
// agree. The Automation page needs it to answer "when does this run next",
// which was previously a paragraph of prose the reader had to trust.
//
// Phoenix is UTC-7 all year, so these UTC hours are stable.

export interface StageSchedule {
  stage: string;
  label: string;
  minute: number;
  /** UTC hours. */
  hours: number[];
  description: string;
}

export const STAGE_SCHEDULE: StageSchedule[] = [
  { stage: "discover-leads", label: "Discovery", minute: 0, hours: [13],
    description: "Finds new businesses" },
  { stage: "enrich-leads", label: "Enrichment", minute: 0, hours: [14, 17, 20],
    description: "Scrapes sites for an email address" },
  { stage: "research-leads", label: "Research", minute: 45, hours: [14, 17, 20],
    description: "Gathers evidence and extracts a fact" },
  { stage: "process-discovered-leads", label: "Scoring", minute: 0, hours: [15, 18, 21],
    description: "Scores leads and promotes them to outreach" },
  { stage: "automation", label: "Sending", minute: 0, hours: [16, 19, 22],
    description: "Sends first-touch emails" },
  { stage: "poll-replies", label: "Reply check", minute: 30,
    hours: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23], description: "Reads the mailbox and acts on replies" },
  { stage: "process-followups", label: "Follow-ups", minute: 35,
    hours: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23], description: "Sends touches 2 and 3 when due" },
  { stage: "daily-digest", label: "Daily digest", minute: 0, hours: [1],
    description: "Emails you the summary and any alerts" },
];

/** Next UTC firing time for a stage, as an ISO string. */
export function nextRunAt(schedule: StageSchedule, now = new Date()): string {
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const hour of [...schedule.hours].sort((a, b) => a - b)) {
      const candidate = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
        hour, schedule.minute, 0, 0,
      ));
      if (candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}
