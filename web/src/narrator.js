// Narration: recorded MP3s (scripts/make_voice.py) when present, browser speech otherwise,
// with captions always available. speak(key) resolves when the lines finish or are interrupted.

const MALE_HINTS = ['Daniel', 'Arthur', 'Oliver', 'Aaron', 'Rishi', 'Alex', 'Fred', 'Google UK English Male', 'Microsoft Guy', 'Microsoft Ryan', 'Microsoft David', 'Male'];

export class Narrator {
  constructor(captionEl, sound) {
    this.cap = captionEl; this.sound = sound;
    this.lines = {}; this.files = {}; this.base = '';
    this.voiceOn = true; this.ccOn = true; this.token = 0; this.speaking = false;
    this.audio = new Audio(); this.audio.preload = 'auto';
    this.synthVoice = null;
    const pick = () => {
      const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.startsWith('en'));
      this.synthVoice = MALE_HINTS.map((h) => vs.find((v) => v.name.includes(h))).find(Boolean) || vs[0] || null;
    };
    pick(); window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }
  async load(site) {
    try { this.lines = (await (await fetch(`data/narration/${site}.json`)).json()).lines || {}; } catch { this.lines = {}; }
    try {
      const r = await fetch(`audio/${site}/index.json`);
      if (r.ok) { this.files = (await r.json()).files || {}; this.base = `audio/${site}/`; }
    } catch { /* no recorded audio yet */ }
  }
  get recorded() { return Object.keys(this.files).length > 0; }
  has(key) { return !!this.lines[key]?.length; }
  text(key) { return this.lines[key] || []; }
  stop() {
    this.token++; this.audio.pause(); window.speechSynthesis?.cancel();
    this.speaking = false; this.sound?.duck(false); this.cap.classList.remove('show');
  }
  setVoice(on) { this.voiceOn = on; if (!on) { this.audio.pause(); window.speechSynthesis?.cancel(); } }
  setCC(on) { this.ccOn = on; this.cap.classList.toggle('off', !on); }
  async speak(key) {
    const lines = this.lines[key]; if (!lines?.length) return;
    this.stop(); const my = this.token; this.speaking = true; this.sound?.duck(true);
    for (let i = 0; i < lines.length; i++) {
      if (my !== this.token) return;
      this.cap.querySelector('p').textContent = lines[i];
      this.cap.classList.add('show');
      await this.#say(key, i, lines[i], my);
    }
    if (my !== this.token) return;
    this.speaking = false; this.sound?.duck(false);
    setTimeout(() => { if (my === this.token) this.cap.classList.remove('show'); }, 900);
  }
  #say(key, i, text, my) {
    const reading = () => new Promise((r) => setTimeout(r, 900 + text.length * 58));
    if (!this.voiceOn) return reading();
    const file = this.files[key]?.[i];
    if (file) {
      return new Promise((resolve) => {
        const done = () => { this.audio.onended = this.audio.onerror = null; resolve(); };
        this.audio.onended = done; this.audio.onerror = () => { done(); };
        this.audio.src = this.base + file;
        this.audio.play().catch(() => reading().then(done));
        const guard = setInterval(() => { if (my !== this.token) { clearInterval(guard); done(); } }, 200);
        this.audio.addEventListener('ended', () => clearInterval(guard), { once: true });
      });
    }
    if (!window.speechSynthesis) return reading();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this.synthVoice) u.voice = this.synthVoice;
      u.rate = 0.94; u.pitch = 0.8;
      let finished = false;
      const fin = () => { if (!finished) { finished = true; resolve(); } };
      u.onend = fin; u.onerror = fin;
      window.speechSynthesis.speak(u);
      setTimeout(fin, 2500 + text.length * 90); // safety net if the engine never fires onend
    });
  }
}
