import { NextRequest, NextResponse } from 'next/server';
import { insuranceDb } from '@/lib/insurance/db';
import { DEFAULT_LANGUAGE_TARGETING, SUPPORTED_LANGUAGES } from '@/lib/insurance/languages';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const group = params.get('group') || 'all';
  const limit = Number(params.get('limit') ?? 50);
  const offset = Number(params.get('offset') ?? 0);
  if (!['all', 'bilingual', 'possible', 'other'].includes(group) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: 'Use group=all|bilingual|possible|other, limit=1–100, and offset=0–100000' }, { status: 400 });
  }
  const db = insuranceDb();
  const [queue, settings] = await Promise.all([
    db.rpc('insurance_recruiting_queue', { p_group: group, p_limit: limit, p_offset: offset }),
    db.from('insurance_settings').select('recruiting_languages').eq('id', 'owner').single(),
  ]);
  if (queue.error || settings.error) return NextResponse.json({ error: 'Recruiting queue unavailable. Verify insurance migrations 022 and 023 are applied.' }, { status: 503 });
  return NextResponse.json({ ...queue.data, group, language_targeting: settings.data.recruiting_languages || DEFAULT_LANGUAGE_TARGETING, supported_languages: SUPPORTED_LANGUAGES });
}
