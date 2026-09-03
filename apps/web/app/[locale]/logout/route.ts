import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';

export async function POST(request: Request, context: { params: Promise<{ locale: string }> }) {
  const { locale } = await context.params;
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(`/${locale}/login`, request.url), { status: 303 });
}
