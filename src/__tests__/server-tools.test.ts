import { describe, expect, it, vi } from 'vitest';
import { createChatHandler, defineTool, type ChatHandlerOptions } from '../server';
import { parseNative } from '../transports/parsers';
import type { ChatChunk } from '../types';

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

/** A fake provider: answers each call with the next canned SSE body and records what it was sent. */
function fakeProvider(responses: string[]) {
  const bodies: any[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const body = responses.shift();
    if (body === undefined) throw new Error('No more canned responses');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return { fetch: fetchFn as unknown as typeof fetch, bodies };
}

async function post(options: ChatHandlerOptions, body: unknown): Promise<ChatChunk[]> {
  const handler = createChatHandler(options);
  const res = await handler(new Request('http://localhost/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  expect(res.status).toBe(200);
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .flatMap((b) => parseNative(b.slice(6)));
}

const textOf = (chunks: ChatChunk[]) => chunks.map((c) => (c.type === 'text-delta' ? c.text : '')).join('');

describe('server tools: OpenAI', () => {
  it('runs a tool, feeds the result back and streams the answer', async () => {
    const execute = vi.fn(async ({ city }: { city: string }) => ({ city, forecast: 'sunny', high: 31 }));
    const provider = fakeProvider([
      sse([
        { choices: [{ delta: { content: 'Let me check. ' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Goa"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ]),
      sse([{ choices: [{ delta: { content: "It's sunny in Goa, 31°." } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']),
    ]);
    const chunks = await post(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-test',
        fetch: provider.fetch,
        tools: {
          get_weather: defineTool<{ city: string }>({
            description: 'Weather for a city',
            parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
            label: ({ city }) => `Checking the weather in ${city}…`,
            execute,
          }),
        },
      },
      { messages: [{ role: 'user', content: 'Weather in Goa?' }] },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ city: 'Goa' });
    expect(execute.mock.calls[0]![1]).toMatchObject({ toolCallId: 'call_1' });
    expect(chunks).toContainEqual({ type: 'tool-call-start', id: 'call_1', name: 'get_weather', label: 'Checking the weather in Goa…', args: { city: 'Goa' } });
    expect(chunks).toContainEqual({ type: 'tool-call-end', id: 'call_1', result: { city: 'Goa', forecast: 'sunny', high: 31 } });
    expect(textOf(chunks)).toBe("Let me check. It's sunny in Goa, 31°.");
    expect(chunks.filter((c) => c.type === 'finish').pop()).toEqual({ type: 'finish', reason: 'stop' });

    // First call declares the tool; the second carries the call and its result.
    expect(provider.bodies[0].tools[0]).toMatchObject({ type: 'function', function: { name: 'get_weather', description: 'Weather for a city' } });
    const second = provider.bodies[1].messages;
    expect(second.at(-2)).toEqual({
      role: 'assistant',
      content: 'Let me check. ',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Goa"}' } }],
    });
    expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"city":"Goa","forecast":"sunny","high":31}' });
  });

  it('reports a failing tool to the model and the app', async () => {
    const provider = fakeProvider([
      sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'broken', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]),
      sse([{ choices: [{ delta: { content: 'Sorry, that failed.' }, finish_reason: 'stop' }] }]),
    ]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const chunks = await post(
      {
        provider: 'openai',
        apiKey: 'k',
        model: 'm',
        fetch: provider.fetch,
        tools: { broken: { description: 'Always fails', execute: () => Promise.reject(new Error('Service down')) } },
      },
      { messages: [{ role: 'user', content: 'go' }] },
    );
    errors.mockRestore();
    expect(chunks).toContainEqual({ type: 'tool-call-end', id: 'c1', error: 'Service down' });
    expect(provider.bodies[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Error: Service down' });
  });

  it('stops offering tools on the last step', async () => {
    const call = (id: string) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: 'again', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]);
    const provider = fakeProvider([call('a'), call('b'), sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }])]);
    const chunks = await post(
      { provider: 'openai', apiKey: 'k', model: 'm', fetch: provider.fetch, maxSteps: 3, tools: { again: { description: 'x', execute: () => 'ok' } } },
      { messages: [{ role: 'user', content: 'loop' }] },
    );
    expect(provider.bodies).toHaveLength(3);
    expect(provider.bodies[0].tool_choice).toBeUndefined();
    expect(provider.bodies[2].tool_choice).toBe('none');
    expect(textOf(chunks)).toBe('Done.');
  });
});

describe('server tools: approval (Anthropic)', () => {
  const step1 = sse([
    { type: 'message_start', message: { id: 'msg_1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Holding a seat needs consent.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'I can hold it for 15 minutes.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'hold_seat', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"flight":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"QP 1129"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ]);
  const step2 = sse([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Held until 18:45.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ]);

  const options = (provider: ReturnType<typeof fakeProvider>, execute: (args: { flight: string }) => unknown): ChatHandlerOptions => ({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-test',
    reasoning: true,
    fetch: provider.fetch,
    tools: {
      hold_seat: defineTool<{ flight: string }>({
        description: 'Hold a seat',
        parameters: { type: 'object', properties: { flight: { type: 'string' } } },
        needsApproval: true,
        label: ({ flight }) => `Hold seat: ${flight}`,
        approvalMessage: ({ flight }) => `Hold 1 seat on ${flight}?`,
        execute,
      }),
    },
  });
  const user = { role: 'user', content: 'Hold the Akasa seat' };

  async function pause(execute: (args: { flight: string }) => unknown) {
    const provider = fakeProvider([step1]);
    const chunks = await post(options(provider, execute), { messages: [user] });
    const request = chunks.find((c) => c.type === 'tool-approval-request') as Extract<ChatChunk, { type: 'tool-approval-request' }>;
    return { chunks, request, provider };
  }

  it('pauses for approval without running the tool', async () => {
    const execute = vi.fn(() => ({ held: true }));
    const { chunks, request, provider } = await pause(execute);
    expect(execute).not.toHaveBeenCalled();
    expect(request).toMatchObject({ id: 'toolu_1', name: 'hold_seat', label: 'Hold seat: QP 1129', args: { flight: 'QP 1129' }, message: 'Hold 1 seat on QP 1129?' });
    expect(request.resumeToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(textOf(chunks)).toBe('I can hold it for 15 minutes.');
    expect(provider.bodies[0].tools).toEqual([
      { name: 'hold_seat', description: 'Hold a seat', input_schema: { type: 'object', properties: { flight: { type: 'string' } } } },
    ]);
  });

  it('runs the tool once approved and continues with the thinking block intact', async () => {
    const { request } = await pause(() => {});
    const execute = vi.fn(() => ({ held: true, until: '18:45' }));
    const provider = fakeProvider([step2]);
    const chunks = await post(options(provider, execute), {
      messages: [
        user,
        {
          role: 'assistant',
          content: 'I can hold it for 15 minutes.',
          toolCalls: [{ id: 'toolu_1', name: 'hold_seat', approval: 'approved', resumeToken: request.resumeToken }],
        },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ flight: 'QP 1129' });
    expect(chunks[0]).toEqual({ type: 'tool-call-end', id: 'toolu_1', result: { held: true, until: '18:45' } });
    expect(textOf(chunks)).toBe('Held until 18:45.');

    const messages = provider.bodies[0].messages;
    // The client's copy of the paused reply is replaced by the server's exact turn.
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hold the Akasa seat' });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Holding a seat needs consent.', signature: 'sig-abc' },
        { type: 'text', text: 'I can hold it for 15 minutes.' },
        { type: 'tool_use', id: 'toolu_1', name: 'hold_seat', input: { flight: 'QP 1129' } },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"held":true,"until":"18:45"}' }],
    });
  });

  it('tells the model when the user denies, without running the tool', async () => {
    const { request } = await pause(() => {});
    const execute = vi.fn();
    const provider = fakeProvider([step2]);
    await post(options(provider, execute), {
      messages: [user, { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'hold_seat', approval: 'denied', resumeToken: request.resumeToken }] }],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(provider.bodies[0].messages[2].content[0].content).toMatch(/declined/);
  });

  it('rejects a tampered token', async () => {
    const { request } = await pause(() => {});
    const [payload, signature] = request.resumeToken!.split('.');
    const state = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    state.pending[0].args = { flight: 'XX 999' };
    const forged = `${Buffer.from(JSON.stringify(state)).toString('base64url')}.${signature}`;
    const execute = vi.fn();
    const provider = fakeProvider([step2]);
    const chunks = await post(options(provider, execute), {
      messages: [user, { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'hold_seat', approval: 'approved', resumeToken: forged }] }],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
    expect(chunks).toEqual([{ type: 'error', message: 'This approval has expired. Ask again to continue.' }]);
  });

  it('decides per call with a needsApproval function', async () => {
    const provider = fakeProvider([step1, step2]);
    const execute = vi.fn(() => 'ok');
    const chunks = await post(
      { ...options(provider, execute), tools: { hold_seat: { description: 'Hold', needsApproval: (args: { flight: string }) => args.flight !== 'QP 1129', execute } } },
      { messages: [user] },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(chunks.some((c) => c.type === 'tool-approval-request')).toBe(false);
    expect(textOf(chunks)).toContain('Held until 18:45.');
  });
});

describe('server tools: Gemini', () => {
  it('keeps the thought signature on the function call it sends back', async () => {
    const provider = fakeProvider([
      sse([
        {
          candidates: [
            {
              content: { role: 'model', parts: [{ functionCall: { name: 'find_hotels', args: { city: 'Goa' } }, thoughtSignature: 'ts-1' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ]),
      sse([{ candidates: [{ content: { parts: [{ text: 'Try Casa Baga.' }] }, finishReason: 'STOP' }] }]),
    ]);
    const chunks = await post(
      {
        provider: 'gemini',
        apiKey: 'g',
        model: 'gemini-test',
        fetch: provider.fetch,
        tools: {
          find_hotels: {
            description: 'Find hotels',
            parameters: { type: 'object', properties: { city: { type: 'string' } }, additionalProperties: false },
            execute: () => [{ name: 'Casa Baga' }],
          },
        },
      },
      { messages: [{ role: 'user', content: 'Hotels in Goa' }] },
    );
    expect(provider.bodies[0].tools).toEqual([
      { functionDeclarations: [{ name: 'find_hotels', description: 'Find hotels', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] },
    ]);
    const contents = provider.bodies[1].contents;
    expect(contents.at(-2)).toEqual({ role: 'model', parts: [{ functionCall: { name: 'find_hotels', args: { city: 'Goa' } }, thoughtSignature: 'ts-1' }] });
    expect(contents.at(-1)).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'find_hotels', response: { result: [{ name: 'Casa Baga' }] } } }] });
    expect(textOf(chunks)).toBe('Try Casa Baga.');
  });
});

describe('server without tools', () => {
  it('ignores tool calls in the history and keeps the plain proxy', async () => {
    const provider = fakeProvider([sse([{ choices: [{ delta: { content: 'Hi!' }, finish_reason: 'stop' }] }])]);
    const chunks = await post(
      { provider: 'openai', apiKey: 'k', model: 'm', fetch: provider.fetch },
      { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b', toolCalls: [{ id: 'x', name: 'y', approval: 'approved', resumeToken: 'z.z' }] }, { role: 'user', content: 'c' }] },
    );
    expect(textOf(chunks)).toBe('Hi!');
    expect(chunks).toContainEqual({ type: 'finish', reason: 'stop' });
    expect(provider.bodies[0].tools).toBeUndefined();
  });
});
