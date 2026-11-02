export const HQ_ROLES = ['owner', 'admin', 'sales', 'developer', 'insurance', 'operations', 'client'] as const;
export type HqRole = (typeof HQ_ROLES)[number];

export interface ManagedApp {
  id: string; name: string; slug: string; description: string; application_type: string;
  production_url: string | null; github_repo: string | null; vercel_project: string | null;
  status: string; enabled: boolean; health_status: string; health_checked_at: string | null;
  last_deployment_at: string | null; metadata: Record<string, unknown>; updated_at: string;
}

export interface AttentionItem {
  id: string; title: string; detail: string; href: string;
  urgency: number; revenueImpact: number; occurredAt: string | null;
}

// Stage is a proxy for proximity to a sale, never a claimed dollar amount.
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => b.urgency - a.urgency || b.revenueImpact - a.revenueImpact ||
    (a.occurredAt || '9999').localeCompare(b.occurredAt || '9999') || a.id.localeCompare(b.id));
}

export function safeHttpsUrl(value: string | null, host?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!host || url.hostname === host) ? url.href : null;
  } catch { return null; }
}

export function healthLabel(app: ManagedApp, now = Date.now()): string {
  if (!app.enabled) return 'Disabled';
  const checked = Date.parse(app.health_checked_at || '');
  if (!Number.isFinite(checked) || checked > now || now - checked > 15 * 60 * 1000) return 'Unknown · no recent health check';
  return app.health_status;
}
