import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMath, offlineReply, toApiMessages, personaPrompt } from '../../src/main/ai.js';

test('offline calculator', () => {
  assert.equal(safeMath('12*7'), 84);
  assert.equal(safeMath('(2+3)^2 - 1'), 24);
  assert.equal(safeMath('process.exit()'), null);
  assert.equal(safeMath('7'), null);
  assert.match(offlineReply('what is 12 * 7?'), /84/);
});

test('offline replies are honest about being offline when they cannot answer', () => {
  assert.match(offlineReply('explain quantum entanglement'), /offline|scripted|Settings/i);
  assert.match(offlineReply('help'), /OFFLINE/);
  assert.match(offlineReply('tell me about albuquerque'), /\?/);
});

test('history becomes valid alternating messages starting with the user', () => {
  const m = toApiMessages([
    { role: 'assistant', text: 'pitch' },
    { role: 'user', text: 'a' },
    { role: 'user', text: 'b' },
    { role: 'system', text: 'error' },
    { role: 'assistant', text: 'c' },
  ]);
  assert.deepEqual(m, [
    { role: 'user', content: 'a\nb' },
    { role: 'assistant', content: 'c' },
  ]);
});

test('persona keeps him helpful and in character', () => {
  const p = personaPrompt({ petName: 'Gary', userName: 'Sam' });
  assert.match(p, /Gary/);
  assert.match(p, /Sam/);
  assert.match(p, /Always genuinely answer/);
  assert.match(p, /Albuquerque/);
});
