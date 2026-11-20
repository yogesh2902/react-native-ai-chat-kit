/**
 * Tool-calling plumbing for the server handler: rebuild the assistant's turn
 * (text, thinking, tool calls) in each provider's own format while it streams,
 * and format tool results the way each provider expects them back.
 */
import type { ProviderName } from '../providers';

type Json = Record<string, any>;

/** A tool call the model made in one step. */
export type ToolCallRequest = {
  /** Unique within the reply; also what the app sees as the tool card id. */
  id: string;
  name: string;
  args: unknown;
  /** Gemini: the provider's own call id, if it sent one (needed when answering). */
  providerId?: string;
};

export type ToolOutput = { id: string; name: string; output: unknown; isError?: boolean; providerId?: string };

export type TurnCollector = {
  /** Feed every SSE `data:` payload of one provider response. */
  push(data: string): void;
  /** After the response ends: the assistant turn in the provider's format, and the tool calls in it. */
  finish(): { assistant: unknown; toolCalls: ToolCallRequest[] };
};

function tryJson(data: string): Json | undefined {
  try {
    const v = JSON.parse(data);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

let counter = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function openAICollector(): TurnCollector {
  let text = '';
  const calls = new Map<number, { id: string; name: string; args: string }>();
  return {
    push(data) {
      const obj = tryJson(data);
      const delta = obj?.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.content === 'string') text += delta.content;
      for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const index = typeof tc.index === 'number' ? tc.index : calls.size;
        const call = calls.get(index) ?? { id: '', name: '', args: '' };
        if (typeof tc.id === 'string' && tc.id) call.id = tc.id;
        if (typeof tc.function?.name === 'string' && tc.function.name) call.name = call.name || tc.function.name;
        if (typeof tc.function?.arguments === 'string') call.args += tc.function.arguments;
        calls.set(index, call);
      }
    },
    finish() {
      const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => ({ ...c, id: c.id || newCallId() }));
      const assistant: Json = { role: 'assistant', content: text || null };
      if (list.length) {
        assistant.tool_calls = list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }));
      }
      return { assistant, toolCalls: list.map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.args) })) };
    },
  };
}

function anthropicCollector(): TurnCollector {
  const blocks: Json[] = [];
  const json = new Map<number, string>();
  return {
    push(data) {
      const obj = tryJson(data);
      if (!obj) return;
      const index: number = typeof obj.index === 'number' ? obj.index : blocks.length;
      if (obj.type === 'content_block_start') {
        const block = { ...(obj.content_block ?? {}) };
        if (block.type === 'text') block.text = block.text ?? '';
        if (block.type === 'thinking') {
          block.thinking = block.thinking ?? '';
          block.signature = block.signature ?? '';
        }
        if (block.type === 'tool_use' || block.type === 'server_tool_use') json.set(index, '');
        delete block.citations;
        blocks[index] = block;
      } else if (obj.type === 'content_block_delta') {
        const block = blocks[index];
        const delta = obj.delta ?? {};
        if (!block) return;
        if (delta.type === 'text_delta') block.text = (block.text ?? '') + String(delta.text ?? '');
        else if (delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + String(delta.thinking ?? '');
        else if (delta.type === 'signature_delta') block.signature = String(delta.signature ?? '');
        else if (delta.type === 'input_json_delta') json.set(index, (json.get(index) ?? '') + String(delta.partial_json ?? ''));
      } else if (obj.type === 'content_block_stop') {
        const block = blocks[index];
        const raw = json.get(index);
        if (block && raw !== undefined) {
          block.input = raw.trim() ? parseArgs(raw) : block.input ?? {};
          json.delete(index);
        }
      }
    },
    finish() {
      // Any tool block that never got its stop event still needs its input.
      for (const [index, raw] of json) {
        const block = blocks[index];
        if (block) block.input = raw.trim() ? parseArgs(raw) : block.input ?? {};
      }
      const content = blocks.filter((b) => b && !(b.type === 'text' && !String(b.text ?? '').trim()));
      return {
        assistant: { role: 'assistant', content },
        toolCalls: content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: String(b.id), name: String(b.name), args: b.input ?? {} })),
      };
    },
  };
}

function geminiCollector(): TurnCollector {
  const parts: Json[] = [];
  return {
    push(data) {
      const obj = tryJson(data);
      const incoming = obj?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(incoming)) return;
      for (const part of incoming) {
        const last = parts[parts.length - 1];
        // Merge plain text pieces; keep anything carrying a thought signature or a call as-is.
        const plain = (p: Json) => typeof p.text === 'string' && !p.thoughtSignature && Object.keys(p).every((k) => k === 'text' || k === 'thought');
        if (last && plain(last) && plain(part) && !!last.thought === !!part.thought) last.text += part.text;
        else parts.push({ ...part });
      }
    },
    finish() {
      const toolCalls: ToolCallRequest[] = [];
      for (const part of parts) {
        const call = part.functionCall;
        if (!call?.name) continue;
        const providerId = typeof call.id === 'string' && call.id ? call.id : undefined;
        toolCalls.push({ id: providerId ?? newCallId(), name: String(call.name), args: call.args ?? {}, ...(providerId ? { providerId } : {}) });
      }
      return { assistant: { role: 'model', parts }, toolCalls };
    },
  };
}

export function createTurnCollector(provider: ProviderName): TurnCollector {
  return provider === 'anthropic' ? anthropicCollector() : provider === 'gemini' ? geminiCollector() : openAICollector();
}

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value ?? null));

/** The turn(s) that hand tool results back to the model. */
export function toolResultTurns(provider: ProviderName, outputs: ToolOutput[]): unknown[] {
  if (!outputs.length) return [];
  switch (provider) {
    case 'anthropic':
      return [
        {
          role: 'user',
          content: outputs.map((o) => ({
            type: 'tool_result',
            tool_use_id: o.id,
            content: asText(o.output),
            ...(o.isError ? { is_error: true } : {}),
          })),
        },
      ];
    case 'gemini':
      return [
        {
          role: 'user',
          parts: outputs.map((o) => ({
            functionResponse: {
              name: o.name,
              ...(o.providerId ? { id: o.providerId } : {}),
              response: o.isError ? { error: asText(o.output) } : { result: o.output ?? null },
            },
          })),
        },
      ];
    default:
      return outputs.map((o) => ({ role: 'tool', tool_call_id: o.id, content: asText(o.output) }));
  }
}
