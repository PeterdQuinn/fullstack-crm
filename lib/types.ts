export interface Lead {
  id: string;
  business_name: string;
  owner_name: string;
  contact_name?: string;
  phone: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  niche: string;
  industry?: string;
  employees?: string;
  annual_revenue?: string;
  founded_year?: string;
  short_description?: string;
  technologies?: string;
  keywords?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  instagram_url?: string;
  yelp_url?: string;
  apollo_account_id?: string;
  current_software?: string;
  monthly_spend_estimate?: string;
  status: LeadStatus;
  last_called_at?: string;
  next_follow_up_at?: string;
  meeting_booked: boolean;
  meeting_date?: string;
  created_at: string;
  updated_at: string;
}

export type LeadStatus =
  | "New"
  | "Called"
  | "No Answer"
  | "Follow-Up"
  | "Interested"
  | "Booked"
  | "Dead";

export type CallOutcome =
  | "No answer"
  | "Left voicemail"
  | "Spoke with gatekeeper"
  | "Spoke with owner"
  | "Callback requested"
  | "Not interested"
  | "Interested"
  | "Booked meeting";

export interface CallLog {
  id: string;
  lead_id: string;
  called_at: string;
  outcome: CallOutcome;
  notes?: string;
  current_software?: string;
  client_acquisition_method?: string;
  pain_point?: string;
  next_follow_up_at?: string;
  created_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  note: string;
  created_at: string;
}

export interface Appointment {
  id: string;
  lead_id: string;
  meeting_date: string;
  meeting_time: string;
  google_event_id?: string;
  notes?: string;
  created_at: string;
}

export const LEAD_STATUSES: LeadStatus[] = [
  "New", "Called", "No Answer", "Follow-Up", "Interested", "Booked", "Dead"
];

export const CALL_OUTCOMES: CallOutcome[] = [
  "No answer", "Left voicemail", "Spoke with gatekeeper", "Spoke with owner",
  "Callback requested", "Not interested", "Interested", "Booked meeting"
];

export const STATUS_COLORS: Record<LeadStatus, string> = {
  "New": "bg-blue-100 text-blue-800",
  "Called": "bg-yellow-100 text-yellow-800",
  "No Answer": "bg-gray-100 text-gray-700",
  "Follow-Up": "bg-purple-100 text-purple-800",
  "Interested": "bg-emerald-100 text-emerald-800",
  "Booked": "bg-green-100 text-green-800",
  "Dead": "bg-red-100 text-red-700",
};

export const GUIDED_QUESTIONS = [
  "What software are you currently using to run your jobs and bookings?",
  "How many different tools are you paying for right now — like scheduling, invoicing, CRM, anything like that?",
  "What are you paying total across all of those every month?",
  "If you stopped paying tomorrow, would you lose access to all of that?",
  "How long have you been on [software]? Has the price gone up since you started?",
  "What's the most frustrating part about how your operation runs right now?",
  "If you had a system built exactly for your business that you owned outright — no monthly fees — what would that be worth to you?",
];

export const POSITIONING_LINES = [
  "We're based right here in Arizona — we're not a national SaaS company, we're local.",
  "We've built custom systems for landscapers, HVAC, plumbers, roofers, towing companies — businesses exactly like yours.",
  "Every system we build is owned 100% by the client. No subscriptions, no lock-in, no vendor telling you what you can and can't do.",
  "Most owners we talk to are spending $300 to $700 a month on software they'll never own. That's $4,000 to $8,000 a year, every year, forever.",
  "We build it once, you own it forever. Your monthly cost drops to $99 to $199 for hosting. That's it.",
  "The average client breaks even in under two years — and after that it's pure savings.",
];
