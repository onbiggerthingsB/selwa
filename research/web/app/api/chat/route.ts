import { handleChatRequest } from '../../../lib/chat-handler';
import { authorizeApiRequest } from '../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  return handleChatRequest(request);
}
