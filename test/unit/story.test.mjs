import test from 'node:test';
import assert from 'node:assert/strict';
import { Story, stageOf, classifyReply, DEFAULT_STORY_STATE } from '../../src/renderer/shared/story.js';

test('stages escalate with refusals and ignores', () => {
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE }), 'friendly');
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE, refusals: 1 }), 'persuasive');
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE, refusals: 3 }), 'dramatic');
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE, refusals: 4, ignores: 1 }), 'impatient');
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE, refusals: 6 }), 'meltdown');
  assert.equal(stageOf({ ...DEFAULT_STORY_STATE, dealStatus: 'accepted', refusals: 9 }), 'planning');
});

test('a fresh campaign starts friendly with yes/no/maybe buttons', () => {
  const s = new Story({}, { user: 'Sam' });
  const b = s.start();
  assert.equal(b.stage, 'friendly');
  assert.deepEqual(b.choices.map((c) => c.id), ['yes', 'no', 'maybe']);
  assert.ok(b.timeout > 0);
  assert.ok(!b.lines.join(' ').includes('{user}'));
});

test('refusing over and over leads to a meltdown, calming down, then the deal question', () => {
  const s = new Story({});
  let sawMeltdown = false, sawCalm = false, deal = null;
  for (let ep = 0; ep < 20 && !deal; ep++) {
    let b = s.start();
    while (b) {
      if (b.anim === 'tantrum') sawMeltdown = true;
      if (b.anim === 'calm') sawCalm = true;
      if (b.isDeal && b.lines.at(-1) === 'So, do we have a deal?') {
        deal = b;
        break;
      }
      if (b.end) break;
      b = s.respond(b.auto ? 'continue' : 'no');
    }
  }
  assert.ok(sawMeltdown && sawCalm && deal, 'expected meltdown → calm → deal');
  assert.deepEqual(deal.choices.map((c) => c.id), ['accept', 'refuse', 'bargain']);
});

test('accept / refuse / bargain / ignore at the deal give different outcomes', () => {
  const mk = () => {
    const s = new Story({ askDealNext: true });
    const b = s.start();
    assert.ok(b.isDeal);
    return s;
  };
  let s = mk();
  let r = s.respond('accept');
  assert.equal(s.state.dealStatus, 'accepted');
  assert.equal(r.anim, 'celebrate');
  assert.equal(r.effect, 'confetti');

  s = mk();
  r = s.respond('refuse');
  assert.equal(s.state.dealStatus, 'refused');
  assert.ok(['tantrum', 'sulk'].includes(r.anim));
  assert.equal(stageOf(s.state), 'dramatic', 'he never gives up: restarts dramatic');

  s = mk();
  r = s.respond('bargain');
  assert.ok(r.isDeal && r.choices.some((c) => c.id === 'bargain'));
  r = s.respond('bargain');
  r = s.respond('bargain');
  assert.deepEqual(r.choices.map((c) => c.id), ['accept', 'refuse'], 'final offer');
  r = s.respond('accept');
  assert.equal(s.state.dealStatus, 'accepted');

  s = mk();
  r = s.respond('ignore');
  assert.equal(r.anim, 'knock');
  assert.equal(s.state.askDealNext, true);
});

test('after a deal he plans the trip, and backing out is a betrayal', () => {
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const s = new Story({ dealStatus: 'accepted' });
    const b = s.start();
    if (b.choices) {
      const r = s.respond('backOut');
      assert.equal(r.anim, 'tantrum');
      assert.equal(s.state.dealStatus, 'none');
      found = true;
    } else assert.equal(b.end, true);
  }
  assert.ok(found);
});

test('lines do not repeat back-to-back', () => {
  const s = new Story({});
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const l = s.line('friendly');
    assert.notEqual(l, prev);
    prev = l;
  }
});

test('typed chat replies map onto the offered answers', () => {
  assert.equal(classifyReply('ok deal!', ['accept', 'refuse', 'bargain']), 'accept');
  assert.equal(classifyReply('No deal.', ['accept', 'refuse', 'bargain']), 'refuse');
  assert.equal(classifyReply('what if we just go for a weekend', ['accept', 'refuse', 'bargain']), 'bargain');
  assert.equal(classifyReply('maybe later', ['yes', 'no', 'maybe']), 'maybe');
  assert.equal(classifyReply('sure, sounds fun', ['yes', 'no', 'maybe']), 'yes');
  assert.equal(classifyReply('what is the capital of France?', ['yes', 'no', 'maybe']), null);
});
