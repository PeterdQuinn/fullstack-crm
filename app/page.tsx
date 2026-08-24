import Link from "next/link";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import { PipelineRail, Reveal } from "./_landing/Reveal";

// Fonts are loaded here rather than in the root layout so this page owns its
// own type without changing anything the CRM renders.
const display = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const PIPELINE = [
  ["DISCOVER", "Google Places and OpenStreetMap, deduplicated before a single row is written."],
  ["ENRICH", "A headless crawl of the contractor's own site. Contacts, software, and the signals that matter in their trade."],
  ["RESEARCH", "The pain point, its dollar impact, the angle, and an opener that cites something verifiable."],
  ["APPROVE", "Nothing reaches a human being without your decision. This gate never opens itself."],
  ["OUTREACH", "A sequence that sends on your schedule, with tracking and one click unsubscribe."],
  ["REPLIES", "Classified on arrival. Interested books itself. Not interested suppresses itself."],
  ["CLOSE", "Call queue, bookings, onboarding, and the numbers behind all of it."],
] as const;

const STAGE_STYLE: ReadonlyArray<{ bg: string; fg: string; label: string; dot: string }> = [
  { bg: "#E8F0EA", fg: "#0B1F17", label: "#0E7A45", dot: "#0E7A45" },
  { bg: "#CFE6DA", fg: "#0B1F17", label: "#0B5C38", dot: "#0B5C38" },
  { bg: "#A8D4BC", fg: "#0B1F17", label: "#08492C", dot: "#08492C" },
  { bg: "#E9BC55", fg: "#3A2A05", label: "#3A2A05", dot: "#3A2A05" },
  { bg: "#5FA97F", fg: "#04170D", label: "#04170D", dot: "#04170D" },
  { bg: "#24774E", fg: "#FFFFFF", label: "#CFE6DA", dot: "#E9BC55" },
  { bg: "#0F4A33", fg: "#FFFFFF", label: "#8FE3B4", dot: "#E9BC55" },
];

const GRADES = [
  ["verified", "#25B466", "Confirmed on the prospect's own site, or two sources that agree."],
  ["single_source", "#93A79D", "One source only, including “not found on the pages read”."],
  ["ai_inference", "#E9BC55", "A model estimate. Labelled as such, never dressed up as fact."],
  ["not_found", "#93A79D", "No reliable value. Said plainly instead of guessed."],
] as const;

const SETUP_BUYS = [
  ["THEIR AI, THEIR NETWORK", "You connect your own AI provider and keys. It runs in your environment, on your data. Nothing leaves your control."],
  ["THE NICHE EDUCATION SESSION", "You answer a short questionnaire, You answer a short questionnaire covering your ICP, target niche, territories, differentiators and offer. Those answers become your config. Your signal logic, your research prompts, your email angles."],
  ["INBOX AND CALENDAR CONNECTED", "Outreach and reply handling goes live against your real inbox, with meetings landing on your real calendar."],
] as const;

const COMPARE: ReadonlyArray<readonly [string, string, string]> = [
  ["Seats / logins", "1", "Up to 5"],
  ["Niche configs", "1", "Multiple / territories"],
  ["Connected inboxes", "1", "Several"],
  ["Monthly lead + send volume", "Standard cap", "Higher cap"],
  ["Team roles / shared pipeline", "", "Included"],
  ["Priority support", "", "Included"],
];

const TIERS = [
  {
    name: "Solo",
    who: "Single operator",
    setup: "$1,000",
    monthly: "$600",
    annual: "$6,000",
    saves: "$1,200",
    features: [
      "One operator seat",
      "One niche config",
      "One connected inbox",
      "Full pipeline, discovery to booked meeting",
      "Bring your own AI keys",
      "Evidence graded research",
    ],
    featured: false,
  },
  {
    name: "Company",
    who: "Team",
    setup: "$3,000",
    monthly: "$1,000",
    annual: "$10,000",
    saves: "$2,000",
    features: [
      "Up to 5 seats",
      "Multiple niches and territories",
      "Several connected inboxes",
      "Higher monthly lead and send volume",
      "Team roles and shared pipeline",
      "Priority support",
    ],
    featured: true,
  },
] as const;

export default function LandingPage() {
  return (
    <main className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen bg-[#F7F9F8] text-[#0B1F17] antialiased`} style={{ fontFamily: "var(--font-body)" }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <nav className="flex items-center justify-between">
          <span className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>FULL&nbsp;STACK&nbsp;CRM</span>
          <Link href="/login" className="rounded-lg border border-[#125740]/30 px-4 py-2 text-sm font-semibold text-[#0B1F17] transition-colors hover:bg-[#125740]">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16">
        <Reveal>
          <p className="font-mono text-xs tracking-[0.2em] text-[#4F6058]" style={{ fontFamily: "var(--font-mono)" }}>
            OUTBOUND, END TO END
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" style={{ fontFamily: "var(--font-display)" }}>
            The pipeline runs itself.
            <span className="block text-[#0E7A45]">You decide who gets contacted.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#4F6058] sm:text-lg">
            Find the businesses, research them against their own website, and send outreach that cites
            something real, with a human gate before anyone is ever contacted.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[#125740] px-7 font-bold text-white transition-colors hover:bg-[#0A3A2A]">
              Sign in to your account
            </Link>
            <a href="#pricing" className="inline-flex min-h-[52px] items-center justify-center rounded-xl border border-[#125740]/30 px-7 font-semibold text-[#0B1F17] transition-colors hover:bg-white">
              See pricing
            </a>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-14 rounded-2xl border border-[#125740]/15 bg-white p-5 sm:mt-20 sm:p-7">
            <p className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#4F6058]" style={{ fontFamily: "var(--font-mono)" }}>
              THE PIPELINE
            </p>
            <PipelineRail />
          </div>
        </Reveal>
      </section>

      {/* ── Pipeline detail ──────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Seven stages. One of them is you.
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE.map(([stage, copy], index) => {
              const tone = STAGE_STYLE[index];
              const gate = stage === "APPROVE";
              return (
                <Reveal key={stage} delay={index * 60}>
                  <article
                    className={`h-full rounded-xl p-5 ${gate ? "ring-2 ring-[#3A2A05]/30" : ""}`}
                    style={{ backgroundColor: tone.bg, color: tone.fg }}
                  >
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: tone.dot }} />
                      <p className="font-mono text-[11px] tracking-[0.18em]" style={{ fontFamily: "var(--font-mono)", color: tone.label }}>
                        {stage}
                      </p>
                      {gate && (
                        <span className="ml-auto rounded-full bg-[#3A2A05] px-2 py-0.5 text-[10px] font-bold text-[#E9BC55]">
                          YOUR GATE
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm leading-6" style={{ color: tone.fg, opacity: 0.9 }}>{copy}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Bring your own AI ────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/12">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>BRING YOUR OWN AI</p>
            <h2 className="mt-5 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Your keys, your data, your network.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#4F6058]">
              Every model call runs through provider chains you configure. Put a local model first and a
              paid one last, or drop a provider entirely. Nothing is locked to a vendor, and no prospect
              data is handed to a middleman you did not choose.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ["YOUR KEYS", "You own the AI relationship. Add the providers you already pay for, reorder them, or drop one entirely. No lock in, and no vendor between you and your own prospect list."],
              ["YOUR DATA", "Your book is not harvested, resold, or used to train anything. Leads and research sit in your database, and you can export the whole thing whenever you want."],
              ["YOUR NETWORK", "It runs in your environment. Point it at a local model and the traffic never leaves your machine at all."],
            ].map(([title, copy], index) => (
              <Reveal key={title} delay={index * 80}>
                <article className="h-full rounded-xl border border-[#125740]/15 bg-white p-5">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>{title}</p>
                  <p className="mt-3 text-sm leading-6 text-[#4F6058]">{copy}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Evidence grading ─────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>EVIDENCE GRADING</p>
            <h2 className="mt-5 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Every fact says how it knows.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#4F6058]">
              Research is only useful if you can trust it in front of a prospect. A positive is confirmed.
              A negative says it was not found rather than claiming it is absent. A guess is labelled a
              guess, with the source link sitting next to it.
            </p>
          </Reveal>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <tbody>
                {GRADES.map(([grade, color, meaning], index) => (
                  <tr key={grade} className="border-b border-[#125740]/12">
                    <td className="whitespace-nowrap py-4 pr-6 align-top">
                      <span className="font-mono text-xs tracking-[0.12em]" style={{ fontFamily: "var(--font-mono)", color }}>
                        {grade}
                      </span>
                    </td>
                    <td className="py-4 text-sm leading-6 text-[#4F6058]">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── What setup buys ──────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/12">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>ONBOARDING</p>
            <h2 className="mt-5 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              What the setup fee actually buys.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#4F6058]">
              This is not a signup charge. It pays for the work of standing your engine up. Your AI wired
              into your network, and the system taught your niche before it sends a single email.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {SETUP_BUYS.map(([title, copy], index) => (
              <Reveal key={title} delay={index * 80}>
                <article className="h-full rounded-xl border border-[#125740]/15 bg-white p-5">
                  <p className="font-mono text-[11px] leading-5 tracking-[0.16em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>{title}</p>
                  <p className="mt-3 text-sm leading-6 text-[#4F6058]">{copy}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal delay={240}>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <p className="rounded-xl border border-[#125740]/15 bg-[#EFF4F1] p-5 text-sm leading-6 text-[#4F6058]">
                <span className="font-semibold text-[#0B1F17]">Solo setup, $1,000.</span> One niche, one
                inbox, one config.
              </p>
              <p className="rounded-xl border border-[#125740]/15 bg-[#EFF4F1] p-5 text-sm leading-6 text-[#4F6058]">
                <span className="font-semibold text-[#0B1F17]">Company setup, $3,000.</span> Multiple
                niches and territories, multiple inboxes, roughly triple the onboarding work.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-[#125740]/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Pricing</h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#4F6058]">
              A one time setup fee, then monthly or annual. Pay annually and you get two months free.
              Twelve months for the price of ten.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {TIERS.map((tier, index) => (
              <Reveal key={tier.name} delay={index * 100}>
                <article className={`flex h-full flex-col rounded-2xl border p-6 sm:p-8 ${tier.featured ? "border-[#0A3A2A] bg-[#125740] text-white shadow-lg" : "border-[#125740]/20 bg-[#E8F0EA]"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={`font-mono text-[11px] tracking-[0.2em] ${tier.featured ? "text-[#8FE3B4]" : "text-[#0E7A45]"}`} style={{ fontFamily: "var(--font-mono)" }}>
                      {tier.name.toUpperCase()}
                    </p>
                    {tier.featured && (
                      <span className="rounded-full bg-[#E9BC55] px-3 py-1 text-[11px] font-bold text-[#3A2A05]">FOR TEAMS</span>
                    )}
                  </div>
                  <p className={`mt-1 text-sm ${tier.featured ? "text-[#CFE6DA]" : "text-[#4F6058]"}`}>{tier.who}</p>

                  <p className={`mt-6 text-4xl font-extrabold tracking-tight ${tier.featured ? "text-white" : "text-[#0B1F17]"}`} style={{ fontFamily: "var(--font-display)" }}>
                    {tier.monthly}
                    <span className={`text-base font-medium ${tier.featured ? "text-[#CFE6DA]" : "text-[#4F6058]"}`}> a month</span>
                  </p>
                  <p className={`mt-2 text-sm ${tier.featured ? "text-[#CFE6DA]" : "text-[#4F6058]"}`}>
                    plus <span className={`font-semibold ${tier.featured ? "text-white" : "text-[#0B1F17]"}`}>{tier.setup}</span> one time setup
                  </p>

                  <div className={`mt-5 rounded-xl border p-4 ${tier.featured ? "border-[#E9BC55]/50 bg-[#0A3A2A]" : "border-[#8A6516]/35 bg-[#8A6516]/10"}`}>
                    <p className={`font-mono text-xs tracking-[0.1em] ${tier.featured ? "text-[#E9BC55]" : "text-[#8A6516]"}`} style={{ fontFamily: "var(--font-mono)" }}>
                      OR {tier.annual} A YEAR. TWO MONTHS FREE
                    </p>
                    <p className={`mt-1 text-sm font-semibold ${tier.featured ? "text-white" : "text-[#0B1F17]"}`}>Saves {tier.saves} a year</p>
                  </div>

                  <ul className="mt-7 flex-1 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className={`flex gap-3 text-sm leading-6 ${tier.featured ? "text-[#DDEDE4]" : "text-[#4F6058]"}`}>
                        <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tier.featured ? "bg-[#E9BC55]" : "bg-[#0E7A45]"}`} />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/login"
                    className={`mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 font-bold transition-colors ${
                      tier.featured ? "bg-[#E9BC55] text-[#3A2A05] hover:bg-[#d9ad48]" : "bg-[#125740] text-white hover:bg-[#0A3A2A]"
                    }`}
                  >
                    Get started
                  </Link>
                </article>
              </Reveal>
            ))}
          </div>

          {/* Side-by-side comparison */}
          <Reveal delay={200}>
            <div className="mt-12 overflow-x-auto rounded-2xl border border-[#125740]/15 bg-white">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#125740]/15">
                    <th className="px-5 py-4 text-sm font-semibold text-[#0B1F17]">&nbsp;</th>
                    <th className="px-5 py-4 text-sm font-semibold text-[#0B1F17]">Solo, $600 a month</th>
                    <th className="px-5 py-4 text-sm font-semibold text-[#0B1F17]">Company, $1,000 a month</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(([label, solo, company]) => (
                    <tr key={label} className="border-b border-[#125740]/10 last:border-0">
                      <td className="px-5 py-4 text-sm text-[#4F6058]">{label}</td>
                      <td className="px-5 py-4 text-sm text-[#0B1F17]">{solo}</td>
                      <td className="px-5 py-4 text-sm font-semibold text-[#0B1F17]">{company}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-[#4F6058]">
              Start Solo. When you hire, move up to Company and your config, leads, and history come with you.
            </p>
          </Reveal>

          {/* Payment structure / objection handling */}
          <Reveal delay={260}>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              {[
                ["HOW BILLING WORKS", "Setup fee is charged once at signup. Then you choose monthly or annual-upfront at checkout. Both run through Stripe."],
                ["WHY ANNUAL", "Annual upfront is twelve months for the price of ten. Solo saves $1,200, Company saves $2,000."],
                ["WHAT YOU OWN", "Your AI keys, your data, your client list. Export everything at any time. The setup fee buys delivered work, so it is non-refundable."],
              ].map(([title, copy], index) => (
                <article key={title} className="h-full rounded-xl border border-[#125740]/15 bg-white p-5">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>{title}</p>
                  <p className="mt-3 text-sm leading-6 text-[#4F6058]">{copy}</p>
                </article>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Your AI. Your data. Your network.
              <span className="block text-[#0E7A45]">It never leaves your control.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[#4F6058]">
              One setup fee gets your engine built around your niche. Then it runs, discovery to booked
              meeting, with you as the only gate.
            </p>
            <Link href="/login" className="mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[#125740] px-8 font-bold text-white transition-colors hover:bg-[#0A3A2A]">
              Sign in
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-[#125740]/12">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-[#4F6058] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="font-mono text-xs tracking-[0.18em]" style={{ fontFamily: "var(--font-mono)" }}>FULL STACK CRM</span>
          <span>&copy; {new Date().getFullYear()} Full Stack Services LLC. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
