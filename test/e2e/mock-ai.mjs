// Minimal mock of the Anthropic Messages API (streaming) and an OpenAI-compatible endpoint.
import http from 'node:http';

/** Width/height of a base64 PNG (from its IHDR chunk). */
export function pngSize(b64) {
  const buf = Buffer.from(b64.slice(0, 64), 'base64');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function startMockAI() {
  const requests = [];
  const mock = { helper: null, problems: [] };
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
        if (Array.isArray(json.tools) && json.tools.some((t) => t.type === 'computer_toolset_20260801')) {
          // validate the agent loop's tool results
          const last = json.messages.at(-1);
          if (Array.isArray(last.content)) {
            for (const r of last.content.filter((c) => c.type === 'tool_result')) {
              const tu = json.messages.at(-2).content.find((c) => c.id === r.tool_use_id);
              if (!tu) mock.problems.push(`tool_result for unknown id ${r.tool_use_id}`);
              else if (tu.toolset_name && r.toolset_name !== tu.toolset_name) mock.problems.push(`missing toolset_name on ${tu.name} result`);
            }
          }
          const content = mock.helper ? mock.helper(json) : [{ type: 'text', text: 'Looks like a screen!' }];
          const stop = content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn';
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: json.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }));
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(Object.assign(mock, { server, port: server.address().port, requests }))));
}
