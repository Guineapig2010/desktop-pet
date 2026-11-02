// The Albuquerque campaign: a small state machine that turns your answers (or silence) into
// escalating, then de-escalating, comedy — always building towards "So, do we have a deal?"

import { LINES, CHOICE_LABELS } from './dialogue.js';
import { LinePicker, ShuffleBag, chance } from './util.js';

export const DEFAULT_STORY_STATE = {
  refusals: 0,
  ignores: 0,
  maybes: 0,
  dealStatus: 'none', // none | accepted | refused
  episodes: 0,
  meltdowns: 0,
  deals: 0,
  askDealNext: false,
  bargainItem: null,
};

export const STAGES = ['friendly', 'persuasive', 'dramatic', 'impatient', 'meltdown'];
const STAGE_ANIM = { friendly: 'pitch', persuasive: 'pitch', dramatic: 'dramatic', impatient: 'fume' };
const STAGE_MOOD = { friendly: 'happy', persuasive: 'happy', dramatic: 'dramatic', impatient: 'annoyed' };

export function pressure(s) {
  return s.refusals + 0.6 * s.ignores + 0.3 * s.maybes;
}

export function stageOf(s) {
  if (s.dealStatus === 'accepted') return 'planning';
  const p = pressure(s);
  if (p < 1) return 'friendly';
  if (p < 2.5) return 'persuasive';
  if (p < 4) return 'dramatic';
  if (p < 5.5) return 'impatient';
  return 'meltdown';
}

/** Map free text typed in the chat panel onto one of the currently offered choices. */
export function classifyReply(text, choiceIds) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z' ]+/g, ' ')} `;
  const has = (words) => words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}`));
  const want = (id) => choiceIds.includes(id);
  if (want('bargain') && has(['negotiate', 'counter', 'what if', 'how about', 'offer', 'sweeter', 'in it for me', 'bargain', 'compromise'])) return 'bargain';
  if (want('backOut') && has(['changed my mind', 'not going', 'cancel', 'back out'])) return 'backOut';
  const no = has(['no', 'nope', 'nah', 'never', "don't", 'not', 'pass', 'refuse']);
  const yes = has(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'deal', 'fine', "i'm in", 'lets go', "let's go", 'absolutely', 'of course', 'alright']);
  const maybe = has(['maybe', 'later', 'perhaps', 'think about', 'not sure', 'possibly']);
  if (maybe && !yes) {
    for (const id of ['maybe', 'later']) if (want(id)) return id;
  }
  if (no) {
    for (const id of ['no', 'refuse', 'backOut']) if (want(id)) return id;
  }
  if (yes) {
    for (const id of ['yes', 'accept', 'stillIn']) if (want(id)) return id;
  }
  if (maybe) {
    for (const id of ['maybe', 'later']) if (want(id)) return id;
  }
  return null;
}

export class Story {
  constructor(state = {}, vars = {}) {
    this.state = { ...DEFAULT_STORY_STATE, ...state };
    this.vars = { user: 'pal', ...vars };
    this.lines = new LinePicker(LINES);
    this.labelBags = {};
    this.phase = null; // which question is pending
    this.followUps = 0;
    this.bargainRound = 0;
  }

  line(key) {
    return this.lines.next(key, this.vars);
  }

  label(id) {
    if (!this.labelBags[id]) this.labelBags[id] = new ShuffleBag(CHOICE_LABELS[id]);
    return this.labelBags[id].next();
  }

  choices(ids) {
    return ids.map((id) => ({ id, label: this.label(id) }));
  }

  get stage() {
    return stageOf(this.state);
  }

  /** Begin a new conversation. Returns the first beat. */
  start() {
    this.state.episodes++;
    this.followUps = 0;
    this.bargainRound = 0;
    const st = this.state;
    if (st.dealStatus === 'accepted') {
      if (chance(0.35)) {
        this.phase = 'planningCheck';
        return this.beat({ lines: [this.line('planningCheck')], anim: 'plead', mood: 'hopeful', choices: this.choices(['stillIn', 'backOut', 'later']), timeout: 14 });
      }
      this.phase = null;
      return this.beat({ lines: [this.line('planning')], anim: 'talk', mood: 'happy', end: true });
    }
    if (st.askDealNext) {
      st.askDealNext = false;
      return this.dealBeat([this.line('calm')], 'calm');
    }
    if (this.stage === 'meltdown') return this.meltdownBeat();
    return this.pitchBeat();
  }

  pitchBeat() {
    const stage = this.stage;
    this.phase = 'pitch';
    return this.beat({
      lines: [this.line(stage)],
      anim: STAGE_ANIM[stage] || 'talk',
      mood: STAGE_MOOD[stage] || 'happy',
      stage,
      choices: this.choices(['yes', 'no', 'maybe']),
      timeout: 16,
    });
  }

  meltdownBeat() {
    this.state.meltdowns++;
    this.phase = 'meltdown';
    return this.beat({ lines: [this.line('meltdown')], anim: 'tantrum', mood: 'furious', effect: 'steam', stage: 'meltdown', auto: true, hop: true });
  }

  dealBeat(prefixLines = [], anim = 'plead') {
    this.phase = 'deal';
    return this.beat({ lines: [...prefixLines, this.line('deal')], anim, mood: 'hopeful', choices: this.choices(['accept', 'refuse', 'bargain']), timeout: 18, isDeal: true });
  }

  beat(b) {
    return { choices: null, timeout: 0, auto: false, end: false, effect: null, ...b, stage: b.stage || this.stage };
  }

  /** Your answer to the pending question ('ignore' when you let it time out). */
  respond(choice) {
    const st = this.state;
    switch (this.phase) {
      case 'pitch':
        return this.onPitch(choice);
      case 'meltdown':
        this.phase = 'meltdown2';
        return this.beat({ lines: [this.line('meltdown2')], anim: 'angry', mood: 'furious', effect: 'steam', auto: true });
      case 'meltdown2':
        this.phase = 'calm';
        return this.beat({ lines: [this.line('calm')], anim: 'calm', mood: 'calm', auto: true });
      case 'calm':
        return this.dealBeat([], 'plead');
      case 'deal':
      case 'bargain':
        return this.onDeal(choice);
      case 'planningCheck':
        if (choice === 'stillIn') {
          this.phase = null;
          return this.beat({ lines: [this.line('planning')], anim: 'celebrate', mood: 'happy', effect: 'confetti', end: true });
        }
        if (choice === 'backOut') {
          st.dealStatus = 'none';
          st.refusals = 3;
          this.phase = null;
          return this.beat({ lines: [this.line('betrayal')], anim: 'tantrum', mood: 'furious', effect: 'steam', end: true, hop: true });
        }
        this.phase = null;
        return this.beat({ lines: ['Later it is! But not TOO later.'], anim: 'wave', mood: 'happy', end: true });
      default:
        this.phase = null;
        return null;
    }
  }

  onPitch(choice) {
    const st = this.state;
    if (choice === 'yes') {
      return this.dealBeat([this.line('yesMid')].concat(chance(0.5) ? [this.line('acceptEarly').replace(/\s*So, do we have a deal\?|Do we have a deal\?/g, '')] : []), 'celebrate');
    }
    if (choice === 'maybe') {
      st.maybes++;
      this.phase = null;
      return this.beat({ lines: [this.line('maybe')], anim: 'shrug', mood: 'hopeful', end: true });
    }
    if (choice === 'no') {
      st.refusals++;
      if (this.stage === 'meltdown') return this.meltdownBeat();
      const strong = ['dramatic', 'impatient'].includes(this.stage);
      if (this.followUps < 1 && this.stage !== 'friendly' && chance(0.4)) {
        // he immediately tries again, one notch more intense
        this.followUps++;
        const react = this.line(strong ? 'refuseStrong' : 'refuseMild');
        const next = this.pitchBeat();
        next.lines.unshift(react);
        return next;
      }
      this.phase = null;
      return this.beat({
        lines: [this.line(strong ? 'refuseStrong' : 'refuseMild')],
        anim: strong ? 'frustrated' : 'shrug',
        mood: strong ? 'annoyed' : 'hopeful',
        end: true,
      });
    }
    // ignored
    st.ignores++;
    this.phase = null;
    return this.beat({ lines: [this.line('ignored')], anim: chance(0.5) ? 'knock' : 'sulk', mood: 'sad', end: true, quiet: true });
  }

  onDeal(choice) {
    const st = this.state;
    if (choice === 'accept') {
      const bargained = this.phase === 'bargain';
      st.dealStatus = 'accepted';
      st.deals++;
      st.refusals = st.ignores = st.maybes = 0;
      this.phase = null;
      return this.beat({ lines: [this.line(bargained ? 'bargainAccepted' : 'acceptDeal')], anim: 'celebrate', mood: 'ecstatic', effect: 'confetti', end: true, hop: true });
    }
    if (choice === 'refuse') {
      st.dealStatus = 'refused';
      // he never gives up: next time he starts again from "dramatic"
      st.refusals = 2.5;
      st.ignores = 0;
      st.maybes = 0;
      this.phase = null;
      return this.beat({ lines: [this.line('refuseDeal')], anim: chance(0.5) ? 'tantrum' : 'sulk', mood: 'heartbroken', end: true, flop: true });
    }
    if (choice === 'bargain') {
      this.bargainRound++;
      this.phase = 'bargain';
      if (this.bargainRound >= 3) {
        return this.beat({ lines: [this.line('bargainFinal')], anim: 'plead', mood: 'hopeful', choices: this.choices(['accept', 'refuse']), timeout: 18, isDeal: true });
      }
      return this.beat({ lines: [this.line('bargain')], anim: 'pitch', mood: 'hopeful', choices: this.choices(['accept', 'refuse', 'bargain']), timeout: 18, isDeal: true });
    }
    // ignored the deal
    st.ignores++;
    st.askDealNext = true;
    this.phase = null;
    return this.beat({ lines: [this.line('ignoreDeal')], anim: 'knock', mood: 'sad', end: true });
  }

  /** One-line summary handed to the AI so chat stays consistent with the campaign. */
  summary() {
    const s = this.state;
    const deal = s.dealStatus === 'accepted' ? 'The user AGREED to come to Albuquerque (a deal is on!).' : s.dealStatus === 'refused' ? 'The user refused the last deal; you are wounded but undeterred.' : 'No deal yet.';
    return `Albuquerque campaign: stage "${this.stage}", refusals ${Math.round(s.refusals)}, ignored ${s.ignores}, maybes ${s.maybes}, meltdowns ${s.meltdowns}. ${deal}`;
  }
}
