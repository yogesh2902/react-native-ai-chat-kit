// Cloudflare Workers: `npm create cloudflare@latest`, then replace src/index.ts with this.
// Secrets: `npx wrangler secret put AI_API_KEY`; set AI_PROVIDER and AI_MODEL under [vars] in wrangler.toml.
// App: createStreamTransport({ url: 'https://your-worker.your-name.workers.dev' })
import { createChatHandlerFromEnv } from 'react-native-ai-chat-kit/server';

export default {
  fetch(request: Request, env: Record<string, string>) {
    return createChatHandlerFromEnv(env)(request);
  },
};
