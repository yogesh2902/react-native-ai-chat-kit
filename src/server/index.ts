/**
 * Server side of react-native-ai-chat-kit: a secure proxy between your app and
 * OpenAI / Anthropic / Gemini. The API key stays on the server; the app only
 * knows your URL. Built on web-standard Request/Response, so the same handler
 * runs on Vercel, Next.js, Cloudflare Workers, Deno, Bun and Node.
 *
 *   import { createChatHandlerFromEnv } from 'react-native-ai-chat-kit/server';
 *   export const POST = createChatHandlerFromEnv(process.env);
 */
import {
  buildProviderRequest,
  PROVIDERS,
  providerParser,
  validateProviderConfig,
  SUPPORTED_ATTACHMENT_TYPES,
  type ProviderAttachment,
  type ProviderConfig,
  type ProviderMessage,
  type ProviderName,
} from '../providers';
import { createSSEDecoder } from '../transports/parsers';
import type { ChatChunk } from '../types';
import { signResumeState, verifyResumeToken, type ResumeState } from './resume';
import { createTurnCollector, toolResultTurns, type ToolCallRequest, type ToolOutput } from './turns';

export type { ProviderAttachment, ProviderConfig, ProviderMessage, ProviderName };
export { buildProviderRequest, PROVIDERS };

export type ToolContext = {
  /** The id of this call. Use it to make side effects idempotent (e.g. as a booking's idempotency key). */
  toolCallId: string;
  /** The incoming request, e.g. to read the user's session. */
  request: Request;
  /** Aborted when the user taps Stop. */
  signal: AbortSignal;
};

/**
 * A tool the model can call. It runs on your server, so it can use secrets and databases.
 *
 *   bookSeat: defineTool<{ flight: string }>({
 *     description: 'Hold a seat on a flight',
 *     parameters: { type: 'object', properties: { flight: { type: 'string' } }, required: ['flight'] },
 *     needsApproval: true,
 *     approvalMessage: ({ flight }) => `Hold a seat on ${flight}?`,
 *     execute: async ({ flight }) => holdSeat(flight),
 *   })
 */
export type ChatTool<Args = any> = {
  /** What the tool does; the model reads this to decide when to call it. */
  description: string;
  /** JSON Schema of the arguments object. */
  parameters?: Record<string, unknown>;
  /** Run the tool. Whatever you return goes back to the model (and to the tool card as `result`). Throw to report a failure. */
  execute: (args: Args, context: ToolContext) => unknown | Promise<unknown>;
  /** Ask the user first (Approve / Deny card). `true`, or decide per call from the arguments. */
  needsApproval?: boolean | ((args: Args, context: ToolContext) => boolean | Promise<boolean>);
  /** Text on the tool card while it runs, e.g. 'Searching flights…'. */
  label?: string | ((args: Args) => string);
  /** The question on the approval card, e.g. 'Hold 1 seat on Akasa QP 1129 for ₹3,980?'. */
  approvalMessage?: string | ((args: Args) => string);
};

/** Typed helper for declaring a tool: `defineTool<{ city: string }>({ … })`. */
export function defineTool<Args = any>(tool: ChatTool<Args>): ChatTool<Args> {
  return tool;
}

export type ChatHandler = (request: Request) => Promise<Response>;

export type ChatHandlerOptions = ProviderConfig & {
  /** CORS for Expo web / browsers. `true` (default) allows any origin; pass an origin string to restrict. */
  cors?: boolean | string;
  /** Reject requests you don't trust, e.g. check your user's session token. Return false → 401. */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Only the most recent N messages are sent to the provider. Default 100. */
  maxMessages?: number;
  /** Reject any single message longer than this. Default 32,000 characters. */
  maxMessageChars?: number;
  /** Max total size of attached images/PDFs per request, in bytes. Default 15 MB. */
  maxAttachmentBytes?: number;
  /**
   * Models the app may pick (the model picker sends `model` in the body).
   * Anything not listed is ignored and `model` is used, so users can't switch to a model you didn't approve.
   */
  models?: string[];
  /** Let the app send its own system messages. Off by default so users can't override your system prompt. */
  allowClientSystemMessages?: boolean;
  /** Edit the conversation before it goes to the provider, e.g. to add retrieved documents (RAG). */
  transformMessages?: (messages: ProviderMessage[], request: Request) => ProviderMessage[] | Promise<ProviderMessage[]>;
  /**
   * Tools the model can call, run here on the server. Tool cards (and Approve / Deny for
   * tools with `needsApproval`) show in the app automatically.
   */
  tools?: Record<string, ChatTool>;
  /** Most model calls in one reply when using tools (each round of tool calls is a step). Default 8. */
  maxSteps?: number;
  /**
   * Secret that signs paused replies waiting for approval. Defaults to one derived from `apiKey`,
   * so rotating the key (or changing this) invalidates approvals still waiting.
   */
  toolSecret?: string;
  /** Custom fetch (testing, proxies). */
  fetch?: typeof fetch;
};

type Json = Record<string, unknown>;

function corsHeaders(cors: ChatHandlerOptions['cors']): Record<string, string> {
  if (cors === false) return {};
  return {
    'Access-Control-Allow-Origin': typeof cors === 'string' ? cors : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonError(status: number, message: string, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

const ROLES = new Set(['user', 'assistant', 'system']);

function readMessages(body: unknown): IncomingMessage[] | string {
  const raw = (body as Json | null)?.messages;
  if (!Array.isArray(raw)) return 'Body must be JSON like { "messages": [{ "role": "user", "content": "Hi" }] }';
  const out: IncomingMessage[] = [];
  for (const m of raw) {
    const role = (m as Json)?.role;
    const content = (m as Json)?.content;
    if (typeof role !== 'string' || !ROLES.has(role) || typeof content !== 'string') {
      return 'Each message needs a role (user, assistant or system) and string content.';
    }
    const rawAttachments = (m as Json).attachments;
    let attachments: ProviderAttachment[] | undefined;
    if (rawAttachments !== undefined) {
      if (!Array.isArray(rawAttachments)) return 'attachments must be an array.';
      attachments = [];
      for (const a of rawAttachments) {
        const mimeType = (a as Json)?.mimeType;
        const data = (a as Json)?.data;
        const name = (a as Json)?.name;
        if (typeof mimeType !== 'string' || !SUPPORTED_ATTACHMENT_TYPES.includes(mimeType)) {
          return `Unsupported attachment type "${String(mimeType)}". Allowed: ${SUPPORTED_ATTACHMENT_TYPES.join(', ')}.`;
        }
        if (typeof data !== 'string' || !data) return 'Each attachment needs base64 data.';
        attachments.push({ mimeType, data, ...(typeof name === 'string' ? { name } : {}) });
      }
    }
    const rawCalls = (m as Json).toolCalls;
    let toolCalls: ClientToolCall[] | undefined;
    if (rawCalls !== undefined) {
      if (!Array.isArray(rawCalls)) return 'toolCalls must be an array.';
      toolCalls = [];
      for (const c of rawCalls) {
        const id = (c as Json)?.id;
        const name = (c as Json)?.name;
        if (typeof id !== 'string' || typeof name !== 'string') return 'Each tool call needs an id and a name.';
        const approval = (c as Json).approval;
        const resumeToken = (c as Json).resumeToken;
        toolCalls.push({
          id,
          name,
          ...(approval === 'approved' || approval === 'denied' || approval === 'pending' ? { approval } : {}),
          ...(typeof resumeToken === 'string' ? { resumeToken } : {}),
        });
      }
    }
    out.push({
      role: role as ProviderMessage['role'],
      content,
      ...(attachments?.length ? { attachments } : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
    });
  }
  return out;
}

type ClientToolCall = { id: string; name: string; approval?: 'approved' | 'denied' | 'pending'; resumeToken?: string };
type IncomingMessage = ProviderMessage & { toolCalls?: ClientToolCall[] };

const encoder = new TextEncoder();
const sse = (chunk: ChatChunk) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);

/** Create a request handler that streams replies from the configured provider. */
export function createChatHandler(options: ChatHandlerOptions | (() => ChatHandlerOptions)): ChatHandler {
  return async function chatHandler(request: Request): Promise<Response> {
    let config: ChatHandlerOptions;
    try {
      config = typeof options === 'function' ? options() : options;
      validateProviderConfig(config);
    } catch (e) {
      // Configuration problems are the developer's, not the user's: log details, return a generic error.
      console.error('[react-native-ai-chat-kit/server]', e instanceof Error ? e.message : e);
      return jsonError(500, 'Chat server is not configured. Check the server logs.', corsHeaders(true));
    }
    const cors = corsHeaders(config.cors ?? true);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return jsonError(405, 'Use POST.', cors);

    if (config.authorize && !(await config.authorize(request))) return jsonError(401, 'Unauthorized.', cors);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'Body must be valid JSON.', cors);
    }
    const parsed = readMessages(body);
    if (typeof parsed === 'string') return jsonError(400, parsed, cors);

    const maxChars = config.maxMessageChars ?? 32_000;
    if (parsed.some((m) => m.content.length > maxChars)) return jsonError(413, `A message is longer than ${maxChars} characters.`, cors);
    const attachmentBytes = parsed.reduce(
      (sum, m) => sum + (m.attachments ?? []).reduce((s2, a) => s2 + Math.floor((a.data.length * 3) / 4), 0),
      0,
    );
    const maxBytes = config.maxAttachmentBytes ?? 15 * 1024 * 1024;
    if (attachmentBytes > maxBytes) return jsonError(413, `Attachments exceed ${Math.round(maxBytes / 1024 / 1024)} MB.`, cors);

    // A reply paused for tool approval comes back as its last message, with the user's decisions.
    const last = parsed[parsed.length - 1];
    const resuming = config.tools && last?.role === 'assistant' && last.toolCalls?.some((c) => c.resumeToken) ? last : undefined;
    const history = resuming ? parsed.slice(0, -1) : parsed;

    let messages: ProviderMessage[] = (config.allowClientSystemMessages ? history : history.filter((m) => m.role !== 'system'))
      .slice(-(config.maxMessages ?? 100))
      .map(({ role, content, attachments }) => ({ role, content, ...(attachments ? { attachments } : {}) }));
    if (config.transformMessages) messages = await config.transformMessages(messages, request);
    if (!messages.some((m) => m.role === 'user')) return jsonError(400, 'No user message to reply to.', cors);

    const requested = (body as Json | null)?.model;
    const model = typeof requested === 'string' && config.models?.includes(requested) ? requested : config.model;
    if (config.tools && Object.keys(config.tools).length) {
      return toolLoopResponse({ config: { ...config, model }, messages, request, resuming, cors });
    }
    const upstreamRequest = buildProviderRequest({ ...config, model }, messages);
    const doFetch = config.fetch ?? fetch;
    let upstream: Response;
    try {
      upstream = await doFetch(upstreamRequest.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...upstreamRequest.headers },
        body: JSON.stringify(upstreamRequest.body),
        signal: request.signal,
      });
    } catch (e) {
      console.error('[react-native-ai-chat-kit/server] provider unreachable:', e);
      return jsonError(502, `Could not reach ${config.provider}.`, cors);
    }

    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => '')).slice(0, 500);
      console.error(`[react-native-ai-chat-kit/server] ${config.provider} error ${upstream.status}: ${detail}`);
      // Pass the provider's message through (it never contains your key) so developers can see e.g. "model not found".
      let message = detail;
      try {
        const j = JSON.parse(detail);
        message = j?.error?.message ?? j?.message ?? detail;
      } catch {
        /* not JSON */
      }
      return jsonError(502, `${config.provider} returned ${upstream.status}${message ? `: ${message}` : ''}`, cors);
    }

    const parse = providerParser(config.provider);
    const decoder = createSSEDecoder();
    const textDecoder = new TextDecoder();
    const emit = (events: { event?: string; data: string }[], controller: TransformStreamDefaultController<Uint8Array>) => {
      for (const event of events) {
        if (event.data === '[DONE]') continue;
        for (const chunk of parse(event.data, event.event)) controller.enqueue(sse(chunk));
      }
    };

    // Provider SSE in → this kit's SSE out. Cancellation (user tapped Stop) flows back to the provider.
    const stream = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          emit(decoder.push(textDecoder.decode(bytes, { stream: true })), controller);
        },
        flush(controller) {
          emit(decoder.push(textDecoder.decode()), controller);
          emit(decoder.end(), controller);
        },
      }),
    );

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable proxy buffering (nginx) so tokens arrive live
        ...cors,
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Tool loop: call the model, run the tools it asks for, feed the results back,
// repeat until it answers. Tools that need approval pause the reply.

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const callText = <Args>(value: string | ((args: Args) => string) | undefined, args: Args): string | undefined => {
  try {
    return typeof value === 'function' ? value(args) : value;
  } catch {
    return undefined;
  }
};

function toolLoopResponse(input: {
  config: ChatHandlerOptions;
  messages: ProviderMessage[];
  request: Request;
  resuming: IncomingMessage | undefined;
  cors: Record<string, string>;
}): Response {
  const { config, messages, request, resuming, cors } = input;
  const tools = config.tools ?? {};
  const definitions = Object.entries(tools).map(([name, t]) => ({ name, description: t.description, parameters: t.parameters }));
  const maxSteps = Math.max(1, config.maxSteps ?? 8);
  const secret = config.toolSecret ?? `react-native-ai-chat-kit:tools:${config.apiKey}`;
  const doFetch = config.fetch ?? fetch;
  const parse = providerParser(config.provider);
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: ChatChunk) => {
        try {
          controller.enqueue(sse(chunk));
        } catch {
          /* client went away */
        }
      };
      const context = (toolCallId: string): ToolContext => ({ toolCallId, request, signal: abort.signal });

      const run = async (call: ToolCallRequest): Promise<ToolOutput> => {
        const tool = tools[call.name];
        const base = { id: call.id, name: call.name, ...(call.providerId ? { providerId: call.providerId } : {}) };
        if (!tool) {
          send({ type: 'tool-call-end', id: call.id, error: `Unknown tool "${call.name}"` });
          return { ...base, output: `Unknown tool "${call.name}".`, isError: true };
        }
        try {
          const output = await tool.execute(call.args as never, context(call.id));
          send({ type: 'tool-call-end', id: call.id, result: output });
          return { ...base, output: output ?? null };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`[react-native-ai-chat-kit/server] tool "${call.name}" failed:`, message);
          send({ type: 'tool-call-end', id: call.id, error: message });
          return { ...base, output: `Error: ${message}`, isError: true };
        }
      };

      try {
        let turns: unknown[] = [];
        let steps = 0;

        if (resuming) {
          // The newest token: a reply can pause more than once.
          const token = [...(resuming.toolCalls ?? [])].reverse().find((c) => c.resumeToken)?.resumeToken ?? '';
          const state = await verifyResumeToken(token, secret);
          if (!state || state.provider !== config.provider) {
            send({ type: 'error', message: 'This approval has expired. Ask again to continue.' });
            return;
          }
          const decisions = new Map((resuming.toolCalls ?? []).map((c) => [c.id, c.approval]));
          const outputs: ToolOutput[] = [...state.done];
          for (const call of state.pending) {
            if (decisions.get(call.id) === 'approved') outputs.push(await run(call));
            else {
              outputs.push({
                id: call.id,
                name: call.name,
                output: 'The user declined this action. Do not run it; ask what they would like instead.',
                ...(call.providerId ? { providerId: call.providerId } : {}),
              });
            }
          }
          turns = [...state.turns, ...toolResultTurns(config.provider, outputs)];
          steps = state.steps;
        }

        while (true) {
          if (abort.signal.aborted) break;
          const lastStep = steps >= maxSteps - 1;
          const upstreamRequest = buildProviderRequest(config, messages, {
            tools: definitions,
            continuation: turns,
            ...(lastStep ? { toolChoice: 'none' as const } : {}),
          });
          steps++;
          const upstream = await doFetch(upstreamRequest.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...upstreamRequest.headers },
            body: JSON.stringify(upstreamRequest.body),
            signal: abort.signal,
          });
          if (!upstream.ok || !upstream.body) {
            const detail = (await upstream.text().catch(() => '')).slice(0, 500);
            console.error(`[react-native-ai-chat-kit/server] ${config.provider} error ${upstream.status}: ${detail}`);
            let message = detail;
            try {
              const j = JSON.parse(detail);
              message = j?.error?.message ?? j?.message ?? detail;
            } catch {
              /* not JSON */
            }
            send({ type: 'error', message: `${config.provider} returned ${upstream.status}${message ? `: ${message}` : ''}` });
            break;
          }

          // Stream this step to the app while rebuilding the assistant's turn.
          const collector = createTurnCollector(config.provider);
          const decoder = createSSEDecoder();
          const textDecoder = new TextDecoder();
          const handle = (events: { event?: string; data: string }[]) => {
            for (const event of events) {
              if (event.data === '[DONE]') continue;
              collector.push(event.data);
              for (const chunk of parse(event.data, event.event)) send(chunk);
            }
          };
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            handle(decoder.push(textDecoder.decode(value, { stream: true })));
          }
          handle(decoder.push(textDecoder.decode()));
          handle(decoder.end());

          const { assistant, toolCalls } = collector.finish();
          if (!toolCalls.length || abort.signal.aborted) break;
          turns = [...turns, assistant];

          // Show every call on a card, then run the ones that don't need approval.
          const waiting: ToolCallRequest[] = [];
          const outputs: ToolOutput[] = [];
          for (const call of toolCalls) {
            const tool = tools[call.name];
            send({ type: 'tool-call-start', id: call.id, name: call.name, label: callText(tool?.label, call.args), args: call.args });
            const ask = tool?.needsApproval;
            const needs = typeof ask === 'function' ? await ask(call.args as never, context(call.id)) : !!ask;
            if (needs) waiting.push(call);
          }
          for (const call of toolCalls) if (!waiting.includes(call)) outputs.push(await run(call));

          if (waiting.length) {
            const state: ResumeState = { v: 1, provider: config.provider, turns, done: outputs, pending: waiting, steps };
            const resumeToken = await signResumeState(state, secret);
            for (const call of waiting) {
              const tool = tools[call.name];
              send({
                type: 'tool-approval-request',
                id: call.id,
                name: call.name,
                label: callText(tool?.label, call.args),
                args: call.args,
                message: callText(tool?.approvalMessage, call.args),
                resumeToken,
              });
            }
            break; // the app continues the reply once the user decides
          }
          turns = [...turns, ...toolResultTurns(config.provider, outputs)];
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('[react-native-ai-chat-kit/server] tool loop failed:', e);
          send({ type: 'error', message: e instanceof Error ? e.message : 'The reply failed.' });
        }
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, ...cors } });
}

type Env = Record<string, string | undefined>;

const KEY_FALLBACK: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * Read provider settings from environment variables, so switching providers is
 * a settings change, not a code change:
 *
 * - `AI_PROVIDER`: openai | anthropic | gemini
 * - `AI_API_KEY`: or OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
 * - `AI_MODEL`: e.g. claude-sonnet-5-5
 * - `AI_SYSTEM_PROMPT`, `AI_BASE_URL`, `AI_TEMPERATURE`, `AI_MAX_TOKENS` (optional)
 * - `AI_MODELS` (optional): comma-separated models the app's model picker may choose
 * - `AI_REASONING` (optional): true | low | medium | high, to stream the model's reasoning
 * - `AI_WEB_SEARCH` (optional): true, to let the model search the web and cite sources
 * - `CHAT_ACCESS_TOKEN` (optional): require `Authorization: Bearer <token>` from the app
 */
export function chatOptionsFromEnv(env: Env): ChatHandlerOptions {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase() as ProviderName;
  const num = (v: string | undefined) => (v !== undefined && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  const token = env.CHAT_ACCESS_TOKEN;
  return {
    provider,
    apiKey: env.AI_API_KEY ?? (KEY_FALLBACK[provider] ? env[KEY_FALLBACK[provider]] : undefined) ?? '',
    model: env.AI_MODEL ?? '',
    system: env.AI_SYSTEM_PROMPT || undefined,
    baseUrl: env.AI_BASE_URL || undefined,
    temperature: num(env.AI_TEMPERATURE),
    maxTokens: num(env.AI_MAX_TOKENS),
    models: env.AI_MODELS ? env.AI_MODELS.split(',').map((m) => m.trim()).filter(Boolean) : undefined,
    reasoning: readReasoning(env.AI_REASONING),
    webSearch: /^(1|true|yes|on)$/i.test(env.AI_WEB_SEARCH ?? '') || undefined,
    authorize: token ? (req) => req.headers.get('authorization') === `Bearer ${token}` : undefined,
  };
}

function readReasoning(value: string | undefined): ChatHandlerOptions['reasoning'] {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return /^(1|true|yes|on)$/.test(v) || undefined;
}

/** `createChatHandler` configured from environment variables (read on each request). */
export function createChatHandlerFromEnv(env: Env, overrides: Partial<ChatHandlerOptions> = {}): ChatHandler {
  return createChatHandler(() => ({ ...chatOptionsFromEnv(env), ...overrides }));
}

// ---------------------------------------------------------------------------
// Node.js / Express adapter

type NodeRequest = AsyncIterable<Uint8Array | string> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set by express.json() if it already parsed the body. */
  body?: unknown;
};
type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  write(chunk: Uint8Array): unknown;
  end(): unknown;
  flushHeaders?: () => void;
  writableEnded?: boolean;
  on(event: 'close', listener: () => void): unknown;
};

/**
 * Use the handler with Node's http module or Express:
 *
 *   http.createServer(toNodeHandler(handler)).listen(3000);
 *   app.post('/chat', toNodeHandler(handler));
 */
export function toNodeHandler(handler: ChatHandler) {
  return async (req: NodeRequest, res: NodeResponse): Promise<void> => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const method = (req.method ?? 'GET').toUpperCase();
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (req.body !== undefined && typeof req.body === 'object') {
        body = JSON.stringify(req.body); // already parsed by express.json()
      } else {
        let text = '';
        const decoder = new TextDecoder();
        for await (const chunk of req) text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        body = text;
      }
    }

    const response = await handler(
      new Request(`http://${headers.get('host') ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body, signal: controller.signal }),
    );

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.flushHeaders?.();
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {
        /* client went away */
      }
    }
    res.end();
  };
}
