// Request-local deadlines for the existing CRM provider chain. This module is
// copied into the separate CRM by prepare-crm-budget-cleanup.mjs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const budgets = new AsyncLocalStorage<AbortSignal>();
export function aiBudgetSignal() { return budgets.getStore(); }
export function assertAiBudget() { aiBudgetSignal()?.throwIfAborted(); }
export async function withAiBudget<T>(milliseconds: number, work: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error('AI request budget exhausted');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('AI request budget exhausted')), milliseconds);
  try { return await budgets.run(controller.signal, work); }
  finally { clearTimeout(timer); }
}
export async function aiRetryDelay(milliseconds: number) {
  assertAiBudget();
  await delay(milliseconds, undefined, { signal: aiBudgetSignal() });
}
export function aiFetch(input: string | URL | Request, init: RequestInit = {}) {
  assertAiBudget();
  const budget = aiBudgetSignal();
  const signal = budget && init.signal ? AbortSignal.any([budget, init.signal]) : budget || init.signal;
  return fetch(input, { ...init, ...(signal ? { signal } : {}) });
}
