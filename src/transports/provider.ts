import { buildProviderRequest, providerParser, validateProviderConfig, type ProviderConfig } from '../providers';
import type { ChatTransport } from '../types';
import { createStreamTransport, toSimpleMessages } from './stream';

declare const __DEV__: boolean | undefined;

export type ProviderTransportOptions = ProviderConfig & {
  /**
   * The API key ships inside your app, where anyone can extract it and run up
   * your bill. That's fine while prototyping, so this transport refuses to run
   * in production builds unless you set this to true. For production, deploy
   * the server handler from 'react-native-ai-chat-kit/server' instead.
   */
  dangerouslyAllowApiKeyInApp?: boolean;
};

const isProductionBuild = () => typeof __DEV__ !== 'undefined' && __DEV__ === false;
let warned = false;

/**
 * Talk to OpenAI, Anthropic (Claude) or Google Gemini directly from the app.
 * Fastest way to prototype: just a provider, an API key and a model.
 *
 * ```ts
 * const transport = createProviderTransport({
 *   provider: 'anthropic',
 *   apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_KEY!,
 *   model: 'claude-sonnet-5-5',
 *   system: 'You are a friendly travel assistant.',
 * });
 * ```
 */
export function createProviderTransport(options: ProviderTransportOptions): ChatTransport {
  validateProviderConfig(options);
  const { dangerouslyAllowApiKeyInApp, ...config } = options;

  if (isProductionBuild() && !dangerouslyAllowApiKeyInApp) {
    throw new Error(
      '[react-native-ai-chat-kit] createProviderTransport puts your API key inside the app, where it can be extracted. ' +
        "It's disabled in production builds. Deploy the server from 'react-native-ai-chat-kit/server' and use " +
        'createStreamTransport({ url }), or pass dangerouslyAllowApiKeyInApp: true if you accept the risk.',
    );
  }
  if (!isProductionBuild() && !warned) {
    warned = true;
    console.warn(
      '[react-native-ai-chat-kit] createProviderTransport is for prototyping: your API key is bundled into the app. ' +
        "Use the server handler ('react-native-ai-chat-kit/server') before you ship.",
    );
  }

  // The model picker can switch models per chat; the request is rebuilt for whichever model is active.
  const withModel = (model?: string) => (model ? { ...config, model } : config);
  return createStreamTransport({
    url: ({ model }) => buildProviderRequest(withModel(model), []).url,
    headers: buildProviderRequest(config, []).headers,
    body: (messages, { model }) => buildProviderRequest(withModel(model), toSimpleMessages(messages)).body,
    parser: providerParser(config.provider),
  });
}
