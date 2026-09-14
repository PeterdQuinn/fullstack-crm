"use client";
import { useState } from 'react';
import { fitIsCurrent, type FitAssessment, type TargetProfile } from '@/lib/insurance/fit';
import type { InsuranceProspect } from '@/lib/insurance/types';
const input = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';
const lines = (value: FormDataEntryValue | null) => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
export function TargetingForm({ profile, busy, save }: { profile?: TargetProfile; busy: boolean; save: (profile: TargetProfile) => Promise<unknown> }) {
  const [open, setOpen] = useState(!profile);
  return <section className="rounded-xl border border-teal-200 bg-white p-5">
    <button className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
      <h2 className="font-bold text-slate-900">Company targeting {profile ? `· ${profile.company}` : '· setup needed'}</h2>
      <p className="mt-1 text-sm text-slate-600">{profile ? profile.offer : 'Define the offer and requirements for this track. Company fit needs your criteria.'}</p>
      <span className="mt-2 inline-block text-xs font-semibold text-teal-800">{open ? 'Hide settings' : 'Edit targeting'}</span>
    </button>
    {open && <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      await save({ company: String(values.get('company') || ''), offer: String(values.get('offer') || ''), must_haves: lines(values.get('must_haves')), dealbreakers: lines(values.get('dealbreakers')), search_terms: String(values.get('search_terms') || '') });
    }}>
      <label className="text-sm font-medium">Company / agency<input className={input} name="company" required maxLength={150} defaultValue={profile?.company} /></label>
      <label className="text-sm font-medium">Discovery search terms<input className={input} name="search_terms" required maxLength={160} defaultValue={profile?.search_terms} placeholder="Life insurance independent producer" /></label>
      <label className="text-sm font-medium md:col-span-2">Products and actual offer<textarea className={input} name="offer" required maxLength={1000} defaultValue={profile?.offer} placeholder="Describe what this agency sells or offers recruits. Include only benefits you can substantiate." /></label>
      <label className="text-sm font-medium">Must-haves · one per line, up to 8<textarea className={input} name="must_haves" required rows={4} defaultValue={profile?.must_haves.join('\n')} placeholder="Use observable requirements, such as experience selling life insurance." /></label>
      <label className="text-sm font-medium">Dealbreakers · one per line, up to 8<textarea className={input} name="dealbreakers" rows={4} defaultValue={profile?.dealbreakers.join('\n')} placeholder="Conditions that would make this offer unsuitable." /></label>
      <p className="text-xs text-slate-600 md:col-span-2">Saving activates company-fit checks for this track's outreach. Existing assessments must match this profile and be less than 30 days old. Unanswered must-haves hold outreach for research. Territory is checked against each prospect's selected state.</p>
      <button disabled={busy} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save targeting</button>
    </form>}
  </section>;
}
export function CompanyFit({ person, profile, busy, research }: { person: InsuranceProspect & { fit_assessment?: FitAssessment }; profile?: TargetProfile; busy: boolean; research: () => void }) {
  const fit = person.fit_assessment;
  const current = profile && fitIsCurrent(fit, profile, person);
  const label = !profile ? 'Targeting not configured' : !fit ? 'Not researched' : !current ? 'Research needs refreshing' : fit.verdict.replaceAll('_', ' ');
  return <section className="mb-4 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-slate-900">Company fit · <span className="capitalize">{label}</span></h3>
      <button disabled={busy || !profile} onClick={research} className="rounded-lg bg-teal-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Research company fit</button></div>
    <p className="mt-2 text-xs text-slate-600">Research searches public sources using this person's name and your targeting terms. Excerpts support an assessment; they are not verified license records or proof of interest.</p>
    {fit && <>
      <p className="mt-3 text-sm font-medium">{fit.next_step}</p>
      <p className="mt-1 text-xs text-slate-500">Assessed {new Date(fit.assessed_at).toLocaleString()} · {fit.confidence} confidence · public search excerpts</p>
      <div className="mt-3 space-y-3">{fit.checks.map((check, index) => <div key={index} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <p><span className="font-semibold capitalize">{check.result}</span> · {check.kind === 'dealbreaker' ? 'Dealbreaker: ' : ''}{check.criterion}</p>
        {check.quote && <blockquote className="mt-2 border-l-2 border-teal-300 pl-3 text-slate-600">“{check.quote}”</blockquote>}
        {check.source_url && <a className="mt-1 block break-all text-xs text-teal-800 underline" href={check.source_url} target="_blank" rel="noreferrer">Review source</a>}
      </div>)}</div>
      <details className="mt-3 text-xs text-slate-600"><summary>Research sources ({fit.evidence.length})</summary>{fit.evidence.map(source => <div key={source.url} className="mt-3"><a className="text-teal-800 underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.snippet}</p><p>Publication: {source.published || 'unknown'} · Retrieved {source.observed_at ? new Date(source.observed_at).toLocaleDateString() : 'unknown (saved discovery excerpt)'}</p></div>)}</details>
    </>}
  </section>;
}
