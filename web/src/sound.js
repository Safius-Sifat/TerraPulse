// Tiny synthesized soundscape: no audio assets.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(ctx.destination);
    // echo bus
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(wet); wet.connect(this.master);
    // ambient drone
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const dg = this.droneGain = ctx.createGain(); dg.gain.value = 0.0; dg.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 4);
    [55, 82.41, 110.3].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 1 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1) * 6;
      o.connect(lp); o.start();
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = ctx.createGain(); lg.gain.value = 160;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    lp.connect(dg); dg.connect(this.master);
  }
  duck(on) { if (this.droneGain) this.droneGain.gain.setTargetAtTime(on ? 0.025 : 0.07, this.ctx.currentTime, 0.4); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.1); }
  ping() {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.7);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g); g.connect(this.master); g.connect(this.delay); o.start(t); o.stop(t + 0.85);
  }
  chime(notes = [523.25, 659.25, 783.99]) {
    if (!this.ctx) return; const ctx = this.ctx;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.11, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); g.connect(this.master); g.connect(this.delay); o.start(t); o.stop(t + 1.3);
    });
  }
  tick(f = 900) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.07);
  }
}
