import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { isSessionValid, SESSION_COOKIE } from '@/lib/server/auth.js';
import GameShell from '@/components/GameShell';

export const dynamic = 'force-dynamic';

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const ok = await isSessionValid(jar.get(SESSION_COOKIE)?.value, env);
  if (!ok) redirect('/login');
  return <GameShell>{children}</GameShell>;
}
