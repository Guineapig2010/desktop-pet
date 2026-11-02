// Deal scenes between General Fok (the hustler) and Doe (the deadpan robot).
// A scene is a list of steps; a step may ask YOU to weigh in, which branches the scene.
// Step: { who: 'fok'|'doe', text, anim, face, effect, handshake, ask: { choices, branches } }

import { ShuffleBag, fill, chance, pick } from './util.js';

const T = {
  greetFok: [
    'DOE! My favourite business partner! Come here, come here!',
    'Well, well, well. If it isn\'t Doe. Just the robot I wanted to see.',
    'Doe, buddy! Pal! Associate! Have I got a deal for you!',
    'Doe! Perfect timing. General Fok has a PROPOSITION.',
    'There he is! The shrewdest robot on this desktop!',
  ],
  greetDoe: [
    'GREETINGS, GENERAL. I DETECT A SALES PITCH.',
    'HELLO, GENERAL FOK. MY WALLET IS CLOSED.',
    'BEEP. WHAT DO YOU WANT THIS TIME.',
    'GENERAL. I HAVE 30 SECONDS. GO.',
    'OH NO. NOT AGAIN.',
  ],
  offer: [
    "Here's the deal: I give you {fokItem}, you give me {doeItem}. Everybody wins!",
    'Limited time offer, Doe: {fokItem}, in exchange for {doeItem}. Final price. Probably.',
    'You look like a robot who needs {fokItem}. And I happen to need {doeItem}. Fate!',
    "Trade you {fokItem} for {doeItem}. Don't think. Just say yes. Thinking is overrated.",
  ],
  compute: ['CALCULATING...', 'PROCESSING OFFER...', 'RUNNING THE NUMBERS...', 'CONSULTING MY SPREADSHEET...'],
  value: [
    'ESTIMATED VALUE OF YOUR OFFER: 2 CENTS.',
    'VALUE OF OFFER: LESS THAN ZERO. HOW IS THAT POSSIBLE.',
    'VALUE: ONE (1) EXPIRED COUPON.',
    'VALUE: SENTIMENTAL ONLY. I HAVE NO SENTIMENTS.',
    'MY CALCULATIONS SAY: LOL.',
  ],
  accept: ['AFFIRMATIVE. DEAL.', 'COMPUTING... ACCEPTABLE. DEAL.', 'FINE. DEAL. DO NOT MAKE IT WEIRD.', 'DEAL ACCEPTED. SHAKE MY CLAW.'],
  reject: ['NEGATIVE.', 'NO. NO. NO. ERROR 404: DEAL NOT FOUND.', 'REJECTED. PLEASE TRY AGAIN NEVER.', 'BEEP BOOP. THAT MEANS NO.'],
  fokRejected: [
    'WHAT?! That was a GENEROUS offer! I was practically ROBBING myself!',
    'Unbelievable! I bring you gold and you give me BEEP BOOP?!',
    'You drive a hard bargain, you tin can!',
    "That's it! I'm going to stomp! LOOK AT ME STOMP, DOE!",
  ],
  sweeten: [
    'FINE! I\'ll throw in {fokItem2}! Now THAT\'S a deal!',
    'Okay, okay. Plus {fokItem2}. My final offer. Final-final.',
    'You want more? MORE?! ...Alright. I\'ll add {fokItem2}.',
  ],
  counter: [
    'COUNTER-OFFER: {counter}.',
    'I WILL ACCEPT ONLY IF YOU ALSO GIVE ME {counter}.',
    'NEW TERMS: {counter}. NON-NEGOTIABLE.',
  ],
  fokShocked: [
    '{COUNTER}?! That\'s highway robbery!',
    'Are your circuits fried?! {COUNTER}?!',
    'Doe, you magnificent scoundrel. {COUNTER}? Really?',
  ],
  askUser: [
    '{user}, you\'re my witness. Is that a fair deal or not?',
    'Help me out here, {user}. Should I take it?',
    '{user}! Quick, you decide. Fair or rip-off?',
  ],
  fokAccept: ['Fine! DEAL! Shake on it, you shiny swindler!', 'Alright, alright. DEAL. Don\'t tell anyone I folded.', 'DEAL! Mark my words, I\'m still winning this somehow.'],
  doeAfterUserNo: ['{USER} IS NOT A CERTIFIED APPRAISER.', 'THE HUMAN HAS BEEN COMPROMISED.', 'NOTED. I AM TELLING THE RECYCLE BIN.'],
  fokAfterUserNo: ['See, Doe? Even {user} says it\'s a rip-off! Ha!', 'You heard {user}! Back to the drawing board, tin man!'],
  fokIgnored: ['Silence. Okay. I\'ll sleep on it.', '...{user} is thinking. Very wise. Let\'s table this.'],
  celebrateFok: ['PLEASURE DOING BUSINESS!', 'Ha! Another deal closed by General Fok!', 'Write that down! Best deal of the century!'],
  celebrateDoe: ['TRANSACTION COMPLETE. ☺', 'I HAVE BEEN SCAMMED. AND I LIKE IT.', 'ADDING TO MY SPREADSHEET.'],
  leaveDoe: ['GOODBYE, GENERAL. DO NOT FOLLOW ME.', 'I HAVE OTHER MEETINGS. WITH TOASTERS.', 'ROLLING AWAY NOW. DRAMATICALLY.', 'SAME TIME NEXT WEEK. BRING BETTER OFFERS.', 'BEEP. BYE.'],
  leaveFok: ['Same time tomorrow, Doe!', "He'll be back. They always come back.", "Ahh, Doe. He's tough, but he's fair. Mostly tough.", 'Pleasure, as always!'],
  // Doe sells something to Fok
  doeSells: ['GENERAL. I AM SELLING {doeSells}. PRICE: {price}.', 'SPECIAL OFFER FOR YOU: {doeSells}. ONLY {price}.'],
  fokBuying: [
    '{price}?! For {doeSellsLower}? ...Is it at least shiny?',
    'Hmm. {doeSellsLower}. I do love a bargain. Do I love THIS bargain?',
    '{price}?! Doe, I respect the hustle. I don\'t respect the price.',
  ],
  // Albuquerque pitch to Doe
  abqFok: [
    'Doe! Albuquerque! 280 days of sunshine! Think of your solar panels!',
    'Doe, I\'m offering you a once-in-a-lifetime trip to ALBUQUERQUE. Balloons! Chile! Me!',
    'Doe, buddy. Albuquerque timeshare. Great for robots. Very dry. No rust!',
  ],
  abqDoe: [
    'ALBUQUERQUE: ELEVATION 5,312 FEET. LOW HUMIDITY. EXCELLENT FOR MY JOINTS. ...INTERESTED.',
    'I HAVE ANALYSED ALBUQUERQUE. IT HAS MANY BALLOONS. I DO NOT TRUST BALLOONS.',
    'IF I GO TO ALBUQUERQUE, WILL YOU STOP TALKING ABOUT ALBUQUERQUE.',
  ],
};

const ITEMS = {
  fokItem: [
    'my second-best grin', 'a slightly used pocket watch chain', 'three green chiles', 'a coupon for one (1) breakfast burrito',
    'a signed photo of myself', 'exclusive rights to my handshake', 'half a sopapilla', 'the cursor (once I catch it)',
    'my lucky pocket square', 'a hand-drawn map to Albuquerque', 'the window I\'m standing on', 'this very nice rock', 'a hug. A big one.',
  ],
  doeItem: [
    'your spare batteries', 'the Wi-Fi password', 'a firmware update', 'two USB sticks', 'your antenna (just for the weekend)',
    'one (1) can of premium oil', 'your left tread', 'a cloud. Any cloud.', 'your blinky chest light', 'a byte. Just one byte.',
  ],
  counter: [
    'YOUR SUIT. ALL THREE PIECES', 'YOUR GRIN. PERMANENTLY', 'YOUR WATCH CHAIN AND 400 DOLLARS', "THE USER'S CURSOR. FOREVER",
    'NAMING RIGHTS. YOUR NEW NAME IS GENERAL DOE', 'ALL YOUR BREAKFAST BURRITOS UNTIL THE YEAR 3000', "YOU STOP SAYING 'ALBUQUERQUE' FOR ONE WEEK",
  ],
  doeSells: ['ONE (1) PAPERCLIP', 'A SLIGHTLY USED SEMICOLON', 'A JPEG OF A BURRITO', 'PREMIUM AIR, LIGHTLY USED', 'ONE (1) RECYCLED PIXEL', 'A SPREADSHEET OF YOUR BAD DEALS'],
  price: ['1,000,000 DOLLARS', 'YOUR WATCH CHAIN', 'THREE SINCERE COMPLIMENTS', 'ONE (1) TICKET TO ALBUQUERQUE', '7 BATTERIES AND A HUG'],
};

export class DealScenes {
  constructor() {
    this.bags = {};
  }
  n(key) {
    const src = T[key] || ITEMS[key];
    if (!this.bags[key]) this.bags[key] = new ShuffleBag(src);
    return this.bags[key].next();
  }

  /** Build a scene. vars: { user } */
  scene(vars = {}) {
    const v = {
      user: vars.user || 'pal',
      fokItem: this.n('fokItem'),
      fokItem2: this.n('fokItem'),
      doeItem: this.n('doeItem'),
      counter: this.n('counter'),
      doeSells: this.n('doeSells'),
      price: this.n('price'),
    };
    v.COUNTER = v.counter;
    v.USER = String(v.user).toUpperCase();
    v.doeSellsLower = v.doeSells.toLowerCase();
    const f = (key) => fill(this.n(key), v);
    const fok = (key, anim = 'pitch', extra = {}) => ({ who: 'fok', text: f(key), anim, ...extra });
    const doe = (key, anim = 'idle', face = 'normal', extra = {}) => ({ who: 'doe', text: f(key), anim, face, ...extra });

    const steps = [fok('greetFok', 'wave'), doe('greetDoe', 'wave', 'normal')];
    const kind = pick(['trade', 'trade', 'trade', 'doeSells', 'albuquerque']);
    const handshake = () => [
      { who: 'both', handshake: true, text: null },
      fok('celebrateFok', 'celebrate', { effect: 'confetti' }),
      doe('celebrateDoe', 'celebrate', 'dollar'),
    ];
    const askUser = (onYes, onNo) => ({
      ...fok('askUser', 'shrug'),
      ask: {
        choices: [
          { id: 'fair', label: chance(0.5) ? 'Fair deal — take it!' : 'Take it!' },
          { id: 'ripoff', label: chance(0.5) ? 'Rip-off!' : "Don't do it!" },
          { id: 'unsure', label: 'Hmm…' },
        ],
        branches: {
          fair: onYes,
          ripoff: onNo,
          unsure: [fok('fokIgnored', 'shrug')],
          ignore: [fok('fokIgnored', 'shrug')],
        },
      },
    });

    if (kind === 'trade') {
      steps.push(fok('offer', 'pitch'), doe('compute', 'compute', 'loading'));
      const r = Math.random();
      if (r < 0.3) {
        steps.push(doe('accept', 'idle', 'dollar'), ...handshake());
      } else if (r < 0.65) {
        steps.push(doe('value', 'shrug', 'normal'), doe('reject', 'idle', 'angry'), fok('fokRejected', 'tantrum', { effect: 'steam', mood: 'furious' }));
        if (chance(0.6)) {
          steps.push(fok('sweeten', 'plead'), doe('compute', 'compute', 'loading'));
          if (chance(0.5)) steps.push(doe('accept', 'idle', 'dollar'), ...handshake());
          else steps.push(doe('reject', 'idle', 'angry'), { who: 'fok', text: 'ARGH! You haven\'t heard the last of General Fok!', anim: 'angry', mood: 'furious' });
        }
      } else {
        steps.push(doe('counter', 'point', 'dollar'), fok('fokShocked', 'stumble', { mood: 'furious' }));
        steps.push(askUser([fok('fokAccept', 'pitch'), ...handshake()], [fok('fokAfterUserNo', 'laugh'), doe('doeAfterUserNo', 'angry', 'angry')]));
      }
    } else if (kind === 'doeSells') {
      steps.push(doe('doeSells', 'give', 'dollar'), fok('fokBuying', 'shrug'));
      steps.push(askUser([{ who: 'fok', text: 'You heard the boss. SOLD!', anim: 'pitch' }, ...handshake()], [fok('fokAfterUserNo', 'laugh'), doe('doeAfterUserNo', 'angry', 'angry')]));
    } else {
      steps.push(fok('abqFok', 'pitch'), doe('compute', 'compute', 'loading'), doe('abqDoe', 'idle', chance(0.5) ? 'heart' : 'normal'));
      if (chance(0.5)) steps.push({ who: 'fok', text: 'That sounds like a YES to me! Deal!', anim: 'celebrate' }, ...handshake());
      else steps.push({ who: 'fok', text: "One day, Doe. One day you'll see the balloons.", anim: 'dramatic' });
    }
    steps.push(doe('leaveDoe', 'wave', 'normal'), fok('leaveFok', 'wave'));
    return { kind, steps };
  }

  /** Lines for when Doe isn't around but Fok is still scheming. */
  musing(vars = {}) {
    return fill(
      pick([
        'Doe still owes me for that burrito deal. I will collect. Oh, I will collect.',
        'One day Doe will accept one of my offers. And on that day... Albuquerque.',
        "Where's Doe? I've got a deal that'll blow his circuits.",
        'Note to self: offer Doe the rock again. Different angle.',
        "{user}, if you see a little robot named Doe, tell him General Fok has a PROPOSITION.",
      ]),
      { user: vars.user || 'pal' },
    );
  }
}
