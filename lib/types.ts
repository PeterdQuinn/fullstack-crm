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
  "What are you currently using to handle your bookings right now?",
  "Is that all done through one system or are you juggling calls, texts, and scheduling manually too?",
  "How are most of your clients coming in right now — Google, referrals, ads, or something else?",
  "What are you paying monthly for that setup right now?",
  "If you stopped paying for it, would you lose access to that whole system?",
  "What's the most frustrating part about what you're using right now?",
  "If you could change one thing about your current process, what would it be?",
];

export const POSITIONING_LINES = [
  "We're local here in Arizona.",
  "We've also worked with businesses outside the country, including Britain.",
  "We work across different sectors and niches, but right now we're focused on businesses like yours.",
  "Most of the owners we talk to are already paying monthly for tools they don't own.",
  "That's exactly why we're reaching out.",
];
