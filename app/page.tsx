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
  ["ENRICH", "A headless crawl of the contractor's own site — contacts, software, and the signals that matter in their trade."],
  ["RESEARCH", "The pain point, its dollar impact, the angle, and an opener that cites something verifiable."],
  ["APPROVE", "Nothing reaches a human being without your decision. This gate never opens itself."],
  ["OUTREACH", "A sequence that sends on your schedule, with tracking and one-click unsubscribe."],
  ["REPLIES", "Classified on arrival. Interested books itself, not interested suppresses itself."],
  ["CLOSE", "Call queue, bookings, onboarding, and the numbers behind all of it."],
] as const;

const GRADES = [
  ["verified", "#25B466", "Confirmed on the prospect's own site, or two sources that agree."],
  ["single_source", "#93A79D", "One source only — including “not found on the pages read”."],
  ["ai_inference", "#E9BC55", "A model estimate. Labelled as such, never dressed up as fact."],
  ["not_found", "#93A79D", "No reliable value. Said plainly instead of guessed."],
] as const;

const TIERS = [
  {
    name: "Solo",
    monthly: "$600",
    setup: "$1,000 setup",
    annual: "$6,000/yr",
    features: ["One operator seat", "Full pipeline, discovery to close", "Bring your own AI keys", "Evidence-graded research", "Email sequences and reply automation"],
    featured: false,
  },
  {
    name: "Company",
    monthly: "$1,000",
    setup: "$3,000 setup",
    annual: "$10,000/yr",
    features: ["Everything in Solo", "Multiple operator seats", "Shared queues and reporting", "Priority onboarding", "Direct support line"],
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
            something real — with a human gate before anyone is ever contacted.
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
          <div className="mt-14 rounded-2xl border border-[#125740]/30/15 bg-white p-5 sm:mt-20 sm:p-7">
            <p className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#4F6058]" style={{ fontFamily: "var(--font-mono)" }}>
              THE PIPELINE
            </p>
            <PipelineRail />
          </div>
        </Reveal>
      </section>

      {/* ── Pipeline detail ──────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/30/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Seven stages. One of them is you.
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE.map(([stage, copy], index) => {
              const gate = stage === "APPROVE";
              return (
                <Reveal key={stage} delay={index * 60}>
                  <article className={`h-full rounded-xl border p-5 ${gate ? "border-[#8A6516]/35 bg-[#8A6516]/[0.06]" : "border-[#125740]/30/15 bg-white"}`}>
                    <p className={`font-mono text-[11px] tracking-[0.18em] ${gate ? "text-[#8A6516]" : "text-[#0E7A45]"}`} style={{ fontFamily: "var(--font-mono)" }}>
                      {stage}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#4F6058]">{copy}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Bring your own AI ────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/30/12">
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
              ["YOUR KEYS", "Add the providers you already pay for. Free tiers first, paid at the tail."],
              ["YOUR DATA", "Leads and research sit in your database. Export the whole thing whenever."],
              ["YOUR NETWORK", "Point it at a local model and the traffic never leaves your machine."],
            ].map(([title, copy], index) => (
              <Reveal key={title} delay={index * 80}>
                <article className="h-full rounded-xl border border-[#125740]/30/15 bg-white p-5">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>{title}</p>
                  <p className="mt-3 text-sm leading-6 text-[#4F6058]">{copy}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Evidence grading ─────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/30/12 bg-[#EFF4F1]">
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
                  <tr key={grade} className="border-b border-[#125740]/30/12">
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

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-[#125740]/30/12">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Pricing</h2>
            <p className="mt-4 text-base text-[#4F6058]">Annual billing includes two months free.</p>
          </Reveal>
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {TIERS.map((tier, index) => (
              <Reveal key={tier.name} delay={index * 100}>
                <article className={`flex h-full flex-col rounded-2xl border p-6 sm:p-8 ${tier.featured ? "border-[#125740] bg-[#125740]/[0.05]" : "border-[#125740]/30/15 bg-white"}`}>
                  <p className="font-mono text-[11px] tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>{tier.name.toUpperCase()}</p>
                  <p className="mt-5 text-4xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                    {tier.monthly}
                    <span className="text-base font-medium text-[#4F6058]">/mo</span>
                  </p>
                  <p className="mt-2 text-sm text-[#4F6058]">{tier.setup}</p>
                  <p className="mt-1 font-mono text-xs text-[#8A6516]" style={{ fontFamily: "var(--font-mono)" }}>
                    or {tier.annual} — two months free
                  </p>
                  <ul className="mt-7 flex-1 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-6 text-[#4F6058]">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#125740]" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/login"
                    className={`mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 font-bold transition-colors ${
                      tier.featured ? "bg-[#125740] text-white hover:bg-[#0A3A2A]" : "border border-[#125740]/30 text-[#0B1F17] hover:bg-[#125740]"
                    }`}
                  >
                    Get started
                  </Link>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="border-t border-[#125740]/30/12 bg-[#EFF4F1]">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Stop guessing which lead is worth the call.
            </h2>
            <Link href="/login" className="mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[#125740] px-8 font-bold text-white transition-colors hover:bg-[#0A3A2A]">
              Sign in
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-[#125740]/30/12">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-[#4F6058] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="font-mono text-xs tracking-[0.18em]" style={{ fontFamily: "var(--font-mono)" }}>FULL STACK CRM</span>
          <span>&copy; {new Date().getFullYear()} Full Stack Services LLC. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
