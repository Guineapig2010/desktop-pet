// Comic speech bubble that follows his head, types text out, and can offer answer buttons.

export class Bubble {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'bubble hidden';
    this.el.innerHTML = '<div class="bubble-text"></div><div class="bubble-choices"></div><div class="bubble-timer"></div><div class="bubble-tail"></div>';
    root.appendChild(this.el);
    this.textEl = this.el.querySelector('.bubble-text');
    this.choicesEl = this.el.querySelector('.bubble-choices');
    this.timerEl = this.el.querySelector('.bubble-timer');
    this.tailEl = this.el.querySelector('.bubble-tail');
    this.visible = false;
    this.typing = null;
    this.choices = null;
    this.anchor = [0, 0];
    this.onChar = null;
  }

  get interactive() {
    return this.visible && !!this.choices;
  }

  /** Show text (typed out). Resolves when fully typed. */
  say(text, { mood = 'normal', speed = 42, onChar } = {}) {
    this.cancelTyping();
    this.clearChoices();
    this.el.className = `bubble mood-${mood}`;
    this.visible = true;
    this.textEl.textContent = '';
    this.fullText = text;
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (!this.visible || this.fullText !== text) return resolve(false);
        i = Math.min(text.length, i + 1);
        this.textEl.textContent = text.slice(0, i);
        const ch = text[i - 1];
        if (onChar && ch && /[a-z0-9]/i.test(ch) && i % 2 === 0) onChar(ch, i);
        if (i >= text.length) {
          this.typing = null;
          return resolve(true);
        }
        const pause = /[.!?]/.test(ch) ? 7 : /[,;:]/.test(ch) ? 3 : 1;
        this.typing = setTimeout(step, (1000 / speed) * pause);
      };
      step();
    });
  }

  /** Show answer buttons; resolves with the chosen id, or 'ignore' after `timeout` seconds. */
  ask(choices, timeout = 15) {
    this.clearChoices();
    this.choices = choices;
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      for (const c of choices) {
        const b = document.createElement('button');
        b.textContent = c.label;
        b.dataset.id = c.id;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pick(c.id);
        });
        this.choicesEl.appendChild(b);
      }
      if (timeout > 0) {
        this.timerEl.style.transition = 'none';
        this.timerEl.style.transform = 'scaleX(1)';
        this.timerEl.style.display = 'block';
        requestAnimationFrame(() => {
          this.timerEl.style.transition = `transform ${timeout}s linear`;
          this.timerEl.style.transform = 'scaleX(0)';
        });
        this.choiceTimer = setTimeout(() => this.pick('ignore'), timeout * 1000);
      }
    });
  }

  /** Programmatic answer (button click, chat text, or timeout). */
  pick(id) {
    if (!this.resolveChoice) return false;
    const r = this.resolveChoice;
    this.resolveChoice = null;
    this.clearChoices();
    r(id);
    return true;
  }

  get pendingChoiceIds() {
    return this.choices ? this.choices.map((c) => c.id) : [];
  }

  clearChoices() {
    clearTimeout(this.choiceTimer);
    this.choicesEl.innerHTML = '';
    this.timerEl.style.display = 'none';
    this.choices = null;
  }

  cancelTyping() {
    clearTimeout(this.typing);
    this.typing = null;
  }

  hide() {
    this.cancelTyping();
    if (this.resolveChoice) this.pick('ignore');
    this.clearChoices();
    this.visible = false;
    this.fullText = null;
    this.el.classList.add('hidden');
  }

  /** Keep the bubble above his head and on screen. */
  position(ax, ay, screenW) {
    if (!this.visible) return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let left = ax - w / 2;
    left = Math.max(8, Math.min(screenW - w - 8, left));
    let top = ay - h - 16;
    let below = false;
    if (top < 6) {
      top = ay + 40;
      below = true;
    }
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.el.classList.toggle('below', below);
    this.tailEl.style.left = `${Math.max(14, Math.min(w - 26, ax - left - 6))}px`;
  }

  rect() {
    return this.el.getBoundingClientRect();
  }
}
