import { NextResponse } from 'next/server';
import { getOwnerId } from '@/lib/scope';

export async function GET() {
  await getOwnerId();
  // Set only after uploading and validating the Windows package on the release host.
  const url = process.env.BROWSER_RELEASE_URL;
  if (url && url.startsWith('https://')) return NextResponse.redirect(url);
  return NextResponse.json({ error: 'Gói Windows chưa được phát hành trên website. Bản thử nghiệm hiện được bàn giao riêng từ thư mục dist của dự án.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
