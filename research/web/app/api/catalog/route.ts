import { getCatalog } from '../../../lib/catalog';
import { apiError, jsonResponse } from '../../../lib/chat-handler';
import { authorizeApiRequest } from '../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    return jsonResponse(getCatalog());
  } catch {
    return apiError('catalog_unavailable', 'The synthetic source catalog is unavailable.', 503);
  }
}
