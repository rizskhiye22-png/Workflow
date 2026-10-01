import { env } from 'cloudflare:workers';
import { handleApi } from '@/lib/server/api.js';

export const dynamic = 'force-dynamic';

const handler = (request) => handleApi(request, env);
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
