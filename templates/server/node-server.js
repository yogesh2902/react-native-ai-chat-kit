// Plain Node.js (18+), no framework: copy env.example to .env, then `node --env-file=.env node-server.js`
// Express instead? app.post('/chat', toNodeHandler(handler)) and app.options('/chat', toNodeHandler(handler))
// App: createStreamTransport({ url: 'http://<your-computer-ip>:3000/chat' })
const http = require('node:http');
const { createChatHandlerFromEnv, toNodeHandler } = require('react-native-ai-chat-kit/server');

const handler = toNodeHandler(createChatHandlerFromEnv(process.env));
const port = Number(process.env.PORT || 3000);

http
  .createServer((req, res) => {
    if (req.url !== '/chat') {
      res.statusCode = 404;
      return res.end('Not found');
    }
    handler(req, res);
  })
  .listen(port, () => console.log(`AI chat server on http://localhost:${port}/chat (provider: ${process.env.AI_PROVIDER})`));
