import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import BrowserManager from './manager';

export default async function BrowserPage() {
  if (!(await getCurrentUser())) redirect('/login?from=/browser');
  return <BrowserManager />;
}
