// Next.js (App Router) / Vercel: save as app/api/chat/route.ts
// Set AI_PROVIDER, AI_API_KEY and AI_MODEL in your Vercel project settings.
// App: createStreamTransport({ url: 'https://your-app.vercel.app/api/chat' })
import { createChatHandlerFromEnv } from 'react-native-ai-chat-kit/server';

const handler = createChatHandlerFromEnv(process.env);

export const POST = handler;
export const OPTIONS = handler; // CORS preflight for Expo web
export const runtime = 'edge'; // optional: faster cold starts, streams well
