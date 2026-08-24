import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/ai-scoring";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail, sendBlockedReason } from "@/lib/email-templates";
import { marketApproved } from "@/lib/outreach-markets";
import { nextFollowUpAt } from "@/lib/email-sequence";
import { logStatusChange } from "@/lib/audit";
import { phoenixDayStartIso } from "@/lib/lead-stats";
import { checkMailability } from "@/lib/email-validation";

// Shared automation-pipeline logic, callable in-process (from the cron) or via
// the /api/admin/automation-pipeline HTTP route (from the UI). Running it
// in-process is what lets the daily cron work: the pipeline lives under
// /api/admin, which is now behind Basic Auth, so a self-HTTP call would 401.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Kept small so the whole cron (all three phases) completes inside the
// Hobby-tier ~60s function limit. Each scrape is a headless-browser call that
// can take several seconds, so the batch is tiny and every call is bounded by
// SCRAPE_TIMEOUT_MS. The 107-lead backlog is worked down over daily runs.
const SCRAPE_BATCH = 3;
const SCRAPE_TIMEOUT_MS = 9000;
// Leads scored per run — kept small (2–3) so a full batch (each an AI call plus
// a possible enrichment scrape) finishes well inside the ~60s function limit.
// Batches of 10 reliably 504'd; 3 completes with headroom.
const SCORE_BATCH = 3;
// Max emails per run. Sends fewer if fewer qualify — never forces a number.
const SEND_CAP_PER_RUN = 100;
// Hard ceiling on outbound emails per Phoenix calendar day, counted from
// outreach_log rather than tracked in memory. A per-RUN cap alone is not a
// daily limit: automation is scheduled every 30 minutes, so a per-run cap of 12
// would still allow 12 x 48 = 576 sends/day. Counting what has already gone out
// today makes the limit hold no matter how often the cron fires, how many runs
// overlap, or how many times someone triggers it by hand.
export const DAILY_SEND_CAP = 40;
// A lead must have all of these (non-null, non-empty) to be scored. City/state
// and other fields (socials, employees, founded_year, ...) may stay null.
const REQUIRED_FIELDS = ["business_name", "email", "phone"] as const;
// Real (non-fallback) scores strictly below this are deleted.
// Lowered 80 -> 50: with the old prompt every real score landed in the 10-35
// band, so an 80 bar deleted essentially every lead the moment the phase ran.
// 50 keeps the pipeline flowing. NOTE: a kept lead is NOT automatically a
// sendable one — see SCORE_SEND_THRESHOLD.
const SCORE_KEEP_THRESHOLD = 50;
// Minimum score to actually EMAIL a lead. Deliberately one above the keep
// threshold, because 50 is the exact value lib/ai-scoring.ts writes when EVERY
// provider fails (`provider: "fallback"`). The two gates previously read
// `>= 50` to keep and `> 50` to send with no constant naming the gap, so leads
// stuck at the fallback value were retained forever and silently never mailed.
// The gap is real and intentional — a fallback 50 means "never evaluated", and
// mailing an unevaluated lead is worse than not mailing it — but it is now
// named and documented instead of being an accident of two magic numbers.
// lead_ai_summaries has no `provider` column, so a fallback 50 cannot be
// distinguished from a genuine 50 after the fact; excluding 50 is the only
// safe test available.
const SCORE_SEND_THRESHOLD = SCORE_KEEP_THRESHOLD + 1;

// Only these statuses are eligible for an automated outreach email. A lead that
// has replied, been sent a booking link, booked, or reached a terminal state
// must never receive another cold touch from the send phase.
const SENDABLE_STATUSES = ["Ready for Outreach", "Follow-Up Scheduled"] as const;

type EmailedLead = { business_name: string; email: string; city: string | null; state: string | null };

export type PhaseResult =
  | { phase: "scrape"; considered: number; enriched: number; fieldsFound: number }
  | {
      phase: "score";
      considered: number;
      scored: number;
      kept: number;
      deleted: number;
      fallback: number;
      incompleteDeleted: number;
      enriched: number;
      /** "archive" (default, reversible) or "delete" (ALLOW_LEAD_DELETION=true). */
      retirementMode: "archive" | "delete";
    }
  | { phase: "send"; eligible: number; sent: number; skipped: number; emailed: EmailedLead[] };

// Hard deletion is opt-in and OFF unless ALLOW_LEAD_DELETION is exactly "true".
// Anything else — unset, "false", "1", "yes" — archives. Fail-safe by design:
// a typo in the env var must never escalate to destroying rows.
const hardDeleteEnabled = () => process.env.ALLOW_LEAD_DELETION === "true";

/**
 * Retire a lead from the pipeline.
 *
 * Archives by default (reversible, keeps the audit trail); hard-deletes only
 * when ALLOW_LEAD_DELETION=true. Errors are logged, never thrown — retiring one
 * lead must not abort the rest of the batch.
 */
async function retireLead(id: string, reason: string): Promise<void> {
  if (hardDeleteEnabled()) {
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) console.error(`Hard delete failed for lead ${id}: ${error.message}`);
    else console.warn(`Lead ${id} HARD DELETED (ALLOW_LEAD_DELETION=true) — ${reason}`);
    return;
  }

  const { error } = await supabase
    .from("leads")
    .update({
      archived_at: new Date().toISOString(),
      archive_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) console.error(`Archive failed for lead ${id}: ${error.message}`);
  else console.log(`Lead ${id} archived — ${reason}`);
}

async function scrapeLeadData(lead: any) {
  // Bound every scrape so a single slow/hanging browser launch can't consume
  // the whole cron's 60s budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: lead.website || undefined,
          business_name: lead.business_name,
          city: lead.city || "",
        }),
        signal: controller.signal,
      }
    );
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed/timed out for ${lead.business_name}:`, error);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export async function runAutomationPhase(phase: string): Promise<PhaseResult> {
  // PHASE 1: SCRAPE — enrich existing leads missing critical data.
  if (phase === "scrape") {
    const { data: leadsToScrape } = await supabase
      .from("leads")
      .select("*")
      .or("email.is.null,phone.is.null,owner_name.is.null")
      .is("archived_at", null)
      .limit(SCRAPE_BATCH);

    let enriched = 0;
    let fieldsFound = 0;

    for (const lead of leadsToScrape || []) {
      const scrapedData = await scrapeLeadData(lead);
      const updates: any = {};

      if (scrapedData.email && !lead.email) updates.email = scrapedData.email;
      if (scrapedData.phone && !lead.phone) updates.phone = scrapedData.phone;
      if (scrapedData.owner && !lead.owner_name) updates.owner_name = scrapedData.owner;
      if (scrapedData.current_software && !lead.current_software)
        updates.current_software = scrapedData.current_software;
      if (scrapedData.description && !lead.short_description)
        updates.short_description = scrapedData.description;
      if (scrapedData.technologies && !lead.technologies)
        updates.technologies = scrapedData.technologies;

      if (Object.keys(updates).length > 0) {
        await supabase.from("leads").update(updates).eq("id", lead.id);
        enriched++;
        fieldsFound += Object.keys(updates).length;
      }
    }

    return { phase: "scrape", considered: (leadsToScrape || []).length, enriched, fieldsFound };
  }

  // PHASE 2: SCORE — enforce data completeness, then AI-score.
  if (phase === "score") {
    // Target UNSCORED leads directly. Pull the set of already-scored lead ids
    // first, then over-fetch the oldest leads and filter those out. Without this
    // anti-join, an unordered page can come back all-scored and the phase
    // no-ops forever, never reaching the unscored backlog.
    const { data: scoredRows } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id");
    const scoredIds = new Set((scoredRows || []).map((r) => r.lead_id));

    const { data: pool } = await supabase
      .from("leads")
      .select(
        "id, business_name, email, phone, city, state, website, owner_name, short_description, industry, current_software, technologies, created_at"
      )
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(SCORE_BATCH * 40);
    const candidates = (pool || [])
      .filter((l) => !scoredIds.has(l.id))
      .slice(0, SCORE_BATCH * 5);

    let considered = 0;
    let scored = 0;
    let kept = 0;
    let fallback = 0;
    let enriched = 0;

    // Deletions are DEFERRED: nothing is deleted inside the scoring loop. We
    // collect ids here and delete only after the loop finishes cleanly. If the
    // function times out (or throws) mid-batch, execution never reaches the
    // deletion block, so a failed/partial run deletes nothing — a pure no-op,
    // the same protection principle as the fallback-score guard below.
    const incompleteToDelete: string[] = []; // failed the completeness gate (never scored)
    const belowThresholdToDelete: string[] = []; // real provider scored them under the bar

    const isBlank = (v: any) => v === null || v === undefined || String(v).trim() === "";

    for (const lead of candidates || []) {
      if (considered >= SCORE_BATCH) break;
      try {
        const { data: existing } = await supabase
          .from("lead_ai_summaries")
          .select("id")
          .eq("lead_id", lead.id)
          .single();
        if (existing) continue; // already scored

        considered++;

        // --- Data-completeness gate (item 5) ---
        // Required fields must all be present. Missing ones get ONE targeted,
        // cheap enrichment attempt; if still missing, the lead is queued for
        // deletion AFTER the batch completes (never mid-loop).
        let missing = REQUIRED_FIELDS.filter((f) => isBlank((lead as any)[f]));
        if (missing.length > 0) {
          // The only cheap scraper path (scrape-phone) can fill email/phone and
          // needs a business_name to search. A lead missing business_name has
          // no scraper path and can't be enriched.
          const scrapeable = !isBlank(lead.business_name) && missing.some((f) => f === "email" || f === "phone");
          if (scrapeable) {
            const scraped = await scrapeLeadData(lead); // one bounded attempt, no LLM
            const updates: any = {};
            if (isBlank(lead.email) && scraped.email) { updates.email = scraped.email; lead.email = scraped.email; }
            if (isBlank(lead.phone) && scraped.phone) { updates.phone = scraped.phone; lead.phone = scraped.phone; }
            if (Object.keys(updates).length > 0) {
              await supabase.from("leads").update(updates).eq("id", lead.id);
              enriched++;
            }
            missing = REQUIRED_FIELDS.filter((f) => isBlank((lead as any)[f]));
          }

          if (missing.length > 0) {
            // Still missing a required field after the enrichment attempt.
            // Defer the delete — a timeout must never orphan-delete a lead
            // that was never actually scored.
            incompleteToDelete.push(lead.id);
            continue;
          }
        }

        // --- Scoring ---
        // Pass the id so scoreLead re-reads the full row (phone, website,
        // ratings, socials, ...) instead of scoring the six fields we happen
        // to have selected above.
        const summary = await scoreLead({
          id: lead.id,
          business_name: lead.business_name,
          owner_name: lead.owner_name,
          industry: lead.industry,
          current_software: lead.current_software,
          technologies: lead.technologies,
          short_description: lead.short_description,
        });

        // "fallback" means EVERY AI provider failed and lead_score is a
        // placeholder (50), not a real judgment. Missing/unknown provider is
        // treated as fallback too, so we never delete on an uncertain score.
        const isFallback = (summary.provider || "fallback") === "fallback";
        if (isFallback) {
          // Leave the lead completely as-is: no summary persisted, no status
          // change, no delete. Re-scored next run once a provider recovers.
          fallback++;
          continue;
        }

        const score = summary.lead_score || 0;
        scored++;

        await supabase.from("lead_ai_summaries").upsert({
          lead_id: lead.id,
          main_pain_point: summary.main_pain_point,
          best_attack_angle: summary.best_attack_angle,
          recommended_first_message: summary.recommended_first_message,
          recommended_follow_up: summary.recommended_follow_up,
          lead_score: score,
          confidence_level: summary.confidence_level,
          missing_data_needed: summary.missing_data_needed,
        });

        if (score >= SCORE_KEEP_THRESHOLD) {
          kept++;
          const { data: leadData } = await supabase
            .from("leads")
            .select("status")
            .eq("id", lead.id)
            .single();
          if (leadData && (!leadData.status || leadData.status === "New")) {
            await supabase.from("leads").update({ status: "Ready for Outreach" }).eq("id", lead.id);
            await logStatusChange({ leadId: lead.id, from: leadData.status ?? null, to: "Ready for Outreach", source: "automation" });
          }
        } else {
          // A REAL provider judged this lead below the bar (item 4). Defer the
          // delete to the post-loop block so a later timeout can't leave the
          // run half-deleted.
          belowThresholdToDelete.push(lead.id);
        }
      } catch (error) {
        console.error(`Error scoring ${lead.business_name}:`, error);
      }
    }

    // --- Retirement block: reached ONLY if the scoring loop completed. ---
    // A timeout/crash during the loop skips all of this, guaranteeing that a
    // failed run retires nothing.
    //
    // DEFAULT IS ARCHIVE, NOT DELETE. `delete` on leads cascades to call_logs,
    // lead_notes, appointments, outreach_log, lead_ai_summaries, lead_socials
    // and status_audit_log — so a hard delete also destroys the audit trail
    // that would explain it, with no undo. Archived rows are stamped and
    // filtered out of every candidate query instead, which is operationally
    // identical for the pipeline and fully reversible.
    let incompleteDeleted = 0;
    let deleted = 0;
    for (const id of incompleteToDelete) {
      await retireLead(id, "incomplete: missing a required field after enrichment");
      incompleteDeleted++;
    }
    for (const id of belowThresholdToDelete) {
      await retireLead(id, `below threshold: real score < ${SCORE_KEEP_THRESHOLD}`);
      deleted++;
    }

    return {
      phase: "score",
      considered,
      scored,
      kept,
      // `deleted` / `incompleteDeleted` are RETIREMENT counts. Under the default
      // archive mode nothing is destroyed — the names are kept so existing
      // consumers of this payload keep working; retirementMode says which
      // actually happened.
      deleted,
      fallback,
      incompleteDeleted,
      enriched,
      retirementMode: hardDeleteEnabled() ? "delete" : "archive",
    };
  }

  // PHASE 3: SEND — email high-score leads, up to SEND_CAP_PER_RUN per run.
  if (phase === "send") {
    // Hard stop: never mail a lead while the CAN-SPAM postal address is still
    // the placeholder. This is a legal requirement, not a formatting detail.
    const blocked = sendBlockedReason();
    if (blocked) {
      console.error(blocked);
      return { phase, sent: 0, skipped: 0, emailed: [], blocked } as any;
    }
    // Per-run cap only (item 3): fetch at most SEND_CAP_PER_RUN candidates and
    // send however many qualify — no per-day tracking, no forced count.
    // Candidate query, shared by both passes below. `email` is required here,
    // so phone-only leads are never even considered for a send.
    const candidates = (limit: number) => {
      const q = supabase
        .from("leads")
        .select(
          "id, business_name, email, city, state, status, owner_name, industry, niche, email_sent_count, lead_ai_summaries(recommended_first_message, recommended_follow_up, lead_score)"
        )
        .eq("opt_out", false)
        .eq("bounced", false)
        .eq("complained", false)
        .not("email", "is", null)
        .neq("email", "")
        .lt("email_sent_count", 3)
        // Status gate: without this, a lead sitting at "Booking Link Sent" or
        // "Booked" with email_sent_count < 3 would be handed another COLD email,
        // directly contradicting the reply automation that just moved it there.
        .in("status", SENDABLE_STATUSES as unknown as string[])
        .is("archived_at", null);
      // The market gate is applied in JS, not here: approved markets can sit in
      // either `industry` or `niche` (discovery fills only `niche` for some
      // sources) and PostgREST's `in.` is case-sensitive, so "Landscaping" would
      // slip past a filter written for "landscaping". Over-fetch and narrow
      // below, where `marketApproved` does a case-insensitive check on both.
      return q.limit(limit);
    };

    // Daily cap, counted from the database so it survives restarts, overlapping
    // runs and manual triggers. Every outbound email row written today counts,
    // including ones that later bounced — the domain saw the send either way.
    const dayStart = phoenixDayStartIso();
    const { count: sentToday, error: countErr } = await supabase
      .from("outreach_log")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "outbound")
      .gte("sent_at", dayStart);

    // Fail CLOSED: if the count can't be read we cannot prove we're under the
    // cap, and guessing risks torching the domain. Skip the run instead.
    if (countErr) {
      console.error("Daily send cap: count failed, skipping run —", countErr.message);
      return { phase, sent: 0, skipped: 0, emailed: [], blocked: countErr.message } as any;
    }

    const alreadySent = sentToday || 0;
    const remainingToday = DAILY_SEND_CAP - alreadySent;
    if (remainingToday <= 0) {
      console.log(`Daily send cap reached: ${alreadySent}/${DAILY_SEND_CAP} since ${dayStart}`);
      return { phase, sent: 0, skipped: 0, emailed: [], cappedAt: DAILY_SEND_CAP, sentToday: alreadySent } as any;
    }

    // APPROVED MARKETS ONLY (lib/outreach-markets.ts). This used to be pinned to
    // HVAC because the touch-1 copy opened "most HVAC shops are paying $300–500
    // a month". Commit 11a356d replaced that with copy that never names a trade,
    // so the allowlist now covers every market the current sequence reads
    // correctly for. It is still an allowlist: a lead whose market is unset or
    // unapproved is skipped, never mailed generic copy by accident.
    const fetchLimit = Math.min(SEND_CAP_PER_RUN, remainingToday);
    // Over-fetch so the in-JS market filter still has `fetchLimit` to work with.
    const { data: pool } = await candidates(fetchLimit * 5);
    const leads = (pool || []).filter(marketApproved).slice(0, fetchLimit);

    let sent = 0;
    let skipped = 0;
    const emailed: EmailedLead[] = [];

    for (const lead of leads || []) {
      // Second line of defence: two runs overlapping could each read the same
      // count before either writes. Stop the moment this run's own sends would
      // cross the remaining allowance.
      if (sent >= remainingToday) {
        console.log(`Daily send cap hit mid-run at ${alreadySent + sent}/${DAILY_SEND_CAP}`);
        break;
      }

      const summary = Array.isArray(lead.lead_ai_summaries)
        ? lead.lead_ai_summaries[0]
        : lead.lead_ai_summaries;
      const score = summary?.lead_score || 0;

      if (score < SCORE_SEND_THRESHOLD || !lead.email) {
        skipped++;
        continue;
      }

      // Never mail an address the scraper invented. A 20% bounce rate on the
      // first live batch traced entirely to fabricated addresses (`@2x.png`
      // image refs, Sentry hosts, percent-encoded fragments). Mark them so the
      // lead is excluded permanently rather than retried next run.
      const mailability = await checkMailability(lead.email);

      // A resolver blip must not condemn a lead: skip this run and retry next.
      if (!mailability.ok && mailability.transient) {
        console.warn(`Deferring ${lead.business_name}: ${lead.email} — ${mailability.reason}`);
        skipped++;
        continue;
      }

      if (!mailability.ok) {
        console.warn(`Skipping ${lead.business_name}: ${lead.email} — ${mailability.reason}`);
        await supabase.from("leads")
          .update({ status: "Bad Email", updated_at: new Date().toISOString() })
          .eq("id", lead.id);
        await logStatusChange({ leadId: lead.id, from: (lead as any).status ?? null, to: "Bad Email", source: "automation", reason: mailability.reason });
        skipped++;
        continue;
      }

      // Persist a repaired address so what we mail matches what the CRM shows.
      if (mailability.email !== lead.email) {
        await supabase.from("leads")
          .update({ email: mailability.email, updated_at: new Date().toISOString() })
          .eq("id", lead.id);
        lead.email = mailability.email;
      }

      const emailNum = (lead.email_sent_count || 0) + 1;
      if (emailNum > 3) {
        skipped++;
        continue;
      }

      // Shared renderer — identical output to the manual Email Queue view.
      const rendered = renderOutreachEmail({
        leadId: lead.id,
        businessName: lead.business_name,
        ownerName: (lead as any).owner_name,
        emailSentCount: lead.email_sent_count || 0,
      });
      const { subject, html, bodyText } = rendered;

      try {
        const result = await sendEmail(
          lead.email,
          subject,
          html,
          undefined,
          `crm-${lead.id}-email-${emailNum}`
        );
        const { data: existingLog, error: existingLogError } = await supabase
          .from("outreach_log").select("id").eq("provider_message_id", result.id).maybeSingle();
        if (existingLogError) throw new Error(`Sent email but log lookup failed: ${existingLogError.message}`);
        if (!existingLog) {
          const { error: logError } = await supabase.from("outreach_log").insert({
            lead_id: lead.id,
            channel: "email",
            direction: "outbound",
            message_type: `email_${emailNum}`,
            subject,
            message_body: bodyText,
            status: "sent",
            provider: "resend",
            provider_message_id: result.id,
            sent_at: new Date().toISOString(),
          });
          if (logError) throw new Error(`Sent email but failed to log it: ${logError.message}`);
        }

        const nextFollowUp = emailNum < 3 ? nextFollowUpAt() : null;
        const { data: updatedLead, error: updateError } = await supabase
          .from("leads")
          .update({
            email_sent_count: emailNum,
            status: `Email ${emailNum} Sent`,
            next_follow_up_at: nextFollowUp,
          })
          .eq("id", lead.id)
          .select("id")
          .single();
        if (updateError || !updatedLead) {
          throw new Error(updateError?.message || "Sent email but lead update changed no rows");
        }
        await logStatusChange({ leadId: lead.id, from: (lead as any).status ?? null, to: `Email ${emailNum} Sent`, source: "automation" });

        // Sending moves the lead to "Email N Sent", which is deliberately NOT
        // in SENDABLE_STATUSES — so this phase will not touch it again. Touches
        // 2 and 3 are handed to the follow-up processor instead
        // (app/api/cron/process-followups), which is the path that knows how to
        // stop on a reply. Without this hand-off the status gate above would
        // silently truncate the sequence to a single email.
        if (emailNum < 3) {
          const { error: taskError } = await supabase.from("follow_up_tasks").insert({
            lead_id: lead.id,
            task_type: `send_email_${emailNum + 1}`,
            due_at: nextFollowUp,
            status: "pending",
          });
          if (taskError) {
            throw new Error(`Email sent but follow-up scheduling failed: ${taskError.message}`);
          }
        }

        sent++;
        // item 6: record exactly who was emailed and where.
        emailed.push({
          business_name: lead.business_name,
          email: lead.email,
          city: lead.city ?? null,
          state: lead.state ?? null,
        });
      } catch (err) {
        console.error(`Error sending to ${lead.business_name}:`, err);
        throw err;
      }
    }

    return { phase: "send", eligible: (leads || []).length, sent, skipped, emailed };
  }

  throw new Error(`Unknown automation phase: ${phase}`);
}
