import { z } from 'zod';

export const MODEL_IDENTITY = 'fake://research-chat-v1' as const;
export const MAX_MESSAGE_CODEPOINTS = 2_000;
export const MAX_CONVERSATION_CODEPOINTS = 8_000;
export const MAX_MESSAGES = 9;
export const MAX_REQUEST_BYTES = 65_536;

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const unicodeText = z.string().refine(hasValidUnicode, 'Invalid Unicode text');
const nonblankText = unicodeText.refine((value) => value.trim().length > 0, 'Text must not be blank');
const hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestIdentifier = z.string().min(1).max(64).refine((value) => !/[^A-Za-z0-9._-]/.test(value), 'Invalid request identifier');

export const citationSchema = z.object({
  source_id: nonblankText,
  version,
  content_sha256: hash,
}).strict();

export const sourceCardSchema = z.object({
  source_id: nonblankText,
  version,
  content_sha256: hash,
  title: nonblankText,
  original_text: nonblankText,
  language: z.enum(['en', 'bo', 'zh']),
  source_kind: z.literal('synthetic_fixture'),
  scope: z.literal('nonclinical'),
  language_review: z.literal('pending'),
  medical_review: z.literal('not_applicable'),
}).strict();

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: nonblankText.refine(
    (value) => codePointLength(value) <= MAX_MESSAGE_CODEPOINTS,
    'Message exceeds the character limit',
  ),
}).strict();

export const requestSchema = z.object({
  schema_version: z.literal('1.0'),
  request_id: requestIdentifier,
  source: citationSchema,
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
}).strict().superRefine((value, context) => {
  if (value.messages.length % 2 !== 1 || value.messages.some(
    (message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'),
  )) {
    context.addIssue({ code: 'custom', path: ['messages'], message: 'Messages must alternate from user and end with user' });
  }
  if (value.messages.reduce((total, message) => total + codePointLength(message.content), 0) > MAX_CONVERSATION_CODEPOINTS) {
    context.addIssue({ code: 'custom', path: ['messages'], message: 'Conversation exceeds the character limit' });
  }
});

export const responseSchema = z.object({
  schema_version: z.literal('1.0'),
  request_id: requestIdentifier,
  outcome: z.enum(['success', 'timeout', 'cancelled', 'context_overflow', 'runtime_failure']),
  answer: nonblankText.refine((value) => codePointLength(value) <= 4_000, 'Answer exceeds the character limit').nullable(),
  citations: z.array(citationSchema).max(1),
  model_identity: z.literal(MODEL_IDENTITY),
  synthetic: z.literal(true),
  input_tokens: z.null(),
  output_tokens: z.null(),
}).strict().superRefine((value, context) => {
  if (value.outcome === 'success') {
    if (value.answer === null || value.citations.length !== 1) {
      context.addIssue({ code: 'custom', message: 'Success requires a complete answer and one citation' });
    }
  } else if (value.answer !== null || value.citations.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Failed responses cannot contain partial output' });
  }
});

export const catalogSchema = z.object({
  schema_version: z.literal('1.0'),
  mode: z.literal('synthetic_demo'),
  sources: z.array(sourceCardSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  if (new Set(value.sources.map((source) => source.source_id)).size !== value.sources.length) {
    context.addIssue({ code: 'custom', path: ['sources'], message: 'Source identities must be distinct' });
  }
});

export type Citation = z.infer<typeof citationSchema>;
export type SourceCard = z.infer<typeof sourceCardSchema>;
export type ChatRequest = z.infer<typeof requestSchema>;
export type ChatResponse = z.infer<typeof responseSchema>;
export type CatalogResponse = z.infer<typeof catalogSchema>;

export function sameCitation(left: Citation, right: Citation): boolean {
  return left.source_id === right.source_id
    && left.version === right.version
    && left.content_sha256 === right.content_sha256;
}

export function citationForSource(source: SourceCard): Citation {
  return {
    source_id: source.source_id,
    version: source.version,
    content_sha256: source.content_sha256,
  };
}

/** Both the request identifier and the complete source version bind an answer. */
export function validateResponseForRequest(value: unknown, request: ChatRequest): ChatResponse {
  const boundRequest = requestSchema.parse(request);
  const response = responseSchema.parse(value);
  if (response.request_id !== boundRequest.request_id) throw new Error('Response request identifier mismatch');
  if (response.outcome === 'success' && !sameCitation(response.citations[0], boundRequest.source)) {
    throw new Error('Response source citation mismatch');
  }
  return response;
}
