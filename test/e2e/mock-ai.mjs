// Minimal mock of the Anthropic Messages API (streaming) and an OpenAI-compatible endpoint.
import http from 'node:http';

export function startMockAI() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: json });
      if (req.url.startsWith('/v1/messages')) {
        const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (key !== 'sk-ant-test-key') {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        for (const piece of ['Paris is the capital ', 'of France. ', 'But have you seen Albuquerque?']) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } });
        ev('message_stop', {});
        return res.end();
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const piece of ['Four ', 'plus four ', 'is eight.']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests })));
}
