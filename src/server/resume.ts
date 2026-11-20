/**
 * Signed resume tokens for tool approvals. When a tool needs the user's OK the
 * server pauses the reply and hands the app a token holding the reply so far
 * (in the provider's own format) and the calls waiting for a decision. The app
 * sends it back with Approve / Deny; the HMAC signature means a client can't
 * invent tool calls or change their arguments.
 */
import type { ProviderName } from '../providers';
import type { ToolCallRequest, ToolOutput } from './turns';

export type ResumeState = {
  v: 1;
  provider: ProviderName;
  /** Provider-format turns of this reply so far, ending with the assistant turn that made the calls. */
  turns: unknown[];
  /** Calls from that turn that already ran (they didn't need approval). */
  done: ToolOutput[];
  /** Calls waiting for the user's decision. */
  pending: ToolCallRequest[];
  /** Steps used so far, so a paused reply keeps its step budget. */
  steps: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new Error('Tool approvals need the Web Crypto API (Node 20+, Bun, Deno, Cloudflare Workers, Vercel).');
  return s;
}

const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, key);
  }
  return key;
}

export async function signResumeState(state: ResumeState, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(state)));
  const signature = new Uint8Array(await subtle().sign('HMAC', await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

/** The state inside a token, or undefined if it was tampered with or isn't one of ours. */
export async function verifyResumeToken(token: string, secret: string): Promise<ResumeState | undefined> {
  const dot = token.indexOf('.');
  if (dot <= 0) return undefined;
  const payload = token.slice(0, dot);
  try {
    const ok = await subtle().verify('HMAC', await hmacKey(secret), fromBase64Url(token.slice(dot + 1)), encoder.encode(payload));
    if (!ok) return undefined;
    const state = JSON.parse(decoder.decode(fromBase64Url(payload)));
    return state?.v === 1 && Array.isArray(state.turns) && Array.isArray(state.pending) ? (state as ResumeState) : undefined;
  } catch {
    return undefined;
  }
}
