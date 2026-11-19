/**
 * Provider adapters shared by the in-app transport (`createProviderTransport`)
 * and the server handler (`react-native-ai-chat-kit/server`). Pure functions,
 * no platform APIs, so they run in React Native, browsers and any JS server.
 */
import { parseAnthropic, parseGemini, parseOpenAI, type StreamParser } from './transports/parsers';

export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  /** Model id, e.g. 'claude-sonnet-5-5'. Required: model names change too often to default. */
  model: string;
  /** System prompt: the assistant's instructions and personality. */
  system?: string;
  /**
   * Override the API base URL. With provider 'openai' this works for any
   * OpenAI-compatible API: OpenRouter, Groq, Together, Mistral, Ollama, LM Studio…
   */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Ask the model to show its reasoning (rendered as a collapsible "Thinking" block).
   * `true` uses the provider's default effort; or pass 'low' | 'medium' | 'high'.
   * Anthropic: adaptive thinking with summarized display. Gemini: thought summaries.
   * OpenAI: sets reasoning_effort (OpenAI-compatible APIs like DeepSeek stream reasoning on their own).
   */
  reasoning?: boolean | 'low' | 'medium' | 'high';
  /**
   * Let the model search the web; cited pages show as source chips under the reply.
   * Anthropic: the web_search server tool. Gemini: Google Search grounding.
   * OpenAI Chat Completions: web_search_options (needs a search-capable model).
   * Pass an object to tune it, e.g. `{ maxUses: 3 }` or `{ toolType: 'web_search_20250305' }` for older Claude models.
   */
  webSearch?: boolean | { maxUses?: number; toolType?: string };
};

/** A file sent to the model as base64. Text documents should be inlined into `content` instead. */
export type ProviderAttachment = {
  /** image/jpeg, image/png, image/webp, image/gif or application/pdf */
  mimeType: string;
  /** Base64 data without the `data:` prefix. */
  data: string;
  name?: string;
};

export type ProviderMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ProviderAttachment[];
};

export const SUPPORTED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export type ProviderRequest = { url: string; headers: Record<string, string>; body: unknown };

const DEFAULT_BASE_URL: Record<ProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

export const PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'gemini'];

const trimSlash = (url: string) => url.replace(/\/+$/, '');

type Turn = { role: 'user' | 'assistant'; content: string; attachments: ProviderAttachment[] };

const hasContent = (m: ProviderMessage) => !!m.content.trim() || !!m.attachments?.length;

/** Merge consecutive same-role turns and drop leading assistant turns (Anthropic & Gemini require user-first). */
function alternate(messages: ProviderMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'system' || !hasContent(m)) continue;
    if (out.length === 0 && m.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = [last.content, m.content].filter((c) => c.trim()).join('\n\n');
      last.attachments.push(...(m.attachments ?? []));
    } else {
      out.push({ role: m.role, content: m.content, attachments: [...(m.attachments ?? [])] });
    }
  }
  return out;
}

const dataUrl = (a: ProviderAttachment) => `data:${a.mimeType};base64,${a.data}`;
const isImage = (a: ProviderAttachment) => a.mimeType.startsWith('image/');

/** Combine the configured system prompt with any system messages in the conversation. */
function systemPrompt(config: ProviderConfig, messages: ProviderMessage[]): string | undefined {
  const parts = [config.system, ...messages.filter((m) => m.role === 'system').map((m) => m.content)].filter(
    (s): s is string => !!s && !!s.trim(),
  );
  return parts.length ? parts.join('\n\n') : undefined;
}

/** Build the HTTP request that streams a reply from the provider. */
export function buildProviderRequest(config: ProviderConfig, messages: ProviderMessage[]): ProviderRequest {
  const base = trimSlash(config.baseUrl ?? DEFAULT_BASE_URL[config.provider]);
  const system = systemPrompt(config, messages);

  switch (config.provider) {
    case 'openai': {
      const custom = !!config.baseUrl;
      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages
            .filter((m) => m.role !== 'system' && hasContent(m))
            .map((m) =>
              m.attachments?.length
                ? {
                    role: m.role,
                    content: [
                      ...m.attachments.map((a) =>
                        isImage(a)
                          ? { type: 'image_url', image_url: { url: dataUrl(a) } }
                          : { type: 'file', file: { filename: a.name ?? 'document.pdf', file_data: dataUrl(a) } },
                      ),
                      ...(m.content.trim() ? [{ type: 'text', text: m.content }] : []),
                    ],
                  }
                : { role: m.role, content: m.content },
            ),
        ],
      };
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (typeof config.reasoning === 'string' && !custom) body.reasoning_effort = config.reasoning;
      if (config.webSearch) body.web_search_options = {};
      // OpenAI's own API uses max_completion_tokens; compatible APIs still expect max_tokens.
      if (config.maxTokens !== undefined) body[custom ? 'max_tokens' : 'max_completion_tokens'] = config.maxTokens;
      return {
        url: `${base}/chat/completions`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
      };
    }
    case 'anthropic': {
      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        max_tokens: config.maxTokens ?? 4096,
        messages: alternate(messages).map((t) =>
          t.attachments.length
            ? {
                role: t.role,
                // Claude works best with images/documents before the question.
                content: [
                  ...t.attachments.map((a) =>
                    isImage(a)
                      ? { type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.data } }
                      : { type: 'document', source: { type: 'base64', media_type: a.mimeType, data: a.data }, ...(a.name ? { title: a.name } : {}) },
                  ),
                  ...(t.content.trim() ? [{ type: 'text', text: t.content }] : []),
                ],
              }
            : { role: t.role, content: t.content },
        ),
      };
      if (system) body.system = system;
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.reasoning) {
        // Current Claude models think adaptively; 'summarized' makes the reasoning visible.
        body.thinking = { type: 'adaptive', display: 'summarized' };
        if (typeof config.reasoning === 'string') body.output_config = { effort: config.reasoning };
      }
      if (config.webSearch) {
        const opts = typeof config.webSearch === 'object' ? config.webSearch : {};
        body.tools = [
          { type: opts.toolType ?? 'web_search_20260209', name: 'web_search', ...(opts.maxUses ? { max_uses: opts.maxUses } : {}) },
        ];
      }
      return {
        url: `${base}/messages`,
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          // Required for calls from a browser (Expo web); harmless elsewhere.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body,
      };
    }
    case 'gemini': {
      const generationConfig: Record<string, unknown> = {};
      if (config.temperature !== undefined) generationConfig.temperature = config.temperature;
      if (config.maxTokens !== undefined) generationConfig.maxOutputTokens = config.maxTokens;
      if (config.reasoning) generationConfig.thinkingConfig = { includeThoughts: true };
      const body: Record<string, unknown> = {
        contents: alternate(messages).map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...t.attachments.map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
            ...(t.content.trim() ? [{ text: t.content }] : []),
          ],
        })),
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
      if (config.webSearch) body.tools = [{ google_search: {} }];
      return {
        url: `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
        headers: { 'x-goog-api-key': config.apiKey },
        body,
      };
    }
    default:
      throw new Error(`Unknown AI provider "${String((config as { provider: unknown }).provider)}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
}

export function providerParser(provider: ProviderName): StreamParser {
  return provider === 'anthropic' ? parseAnthropic : provider === 'gemini' ? parseGemini : parseOpenAI;
}

export function validateProviderConfig(config: Partial<ProviderConfig>): asserts config is ProviderConfig {
  if (!config.provider || !PROVIDERS.includes(config.provider)) {
    throw new Error(`AI provider must be one of: ${PROVIDERS.join(', ')} (got "${String(config.provider)}").`);
  }
  if (!config.apiKey) throw new Error(`Missing API key for provider "${config.provider}".`);
  if (!config.model) throw new Error(`Missing model for provider "${config.provider}".`);
}
