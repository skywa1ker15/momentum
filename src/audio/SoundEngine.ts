/**
 * Synthesised sound effects (Web Audio, no audio files). Audio is feedback only and has
 * no effect on the simulation. The context is created on the first user gesture, as
 * browsers require.
 */

/** Limits how many sounds may start within a sliding time window. */
export class RateLimiter {
  private readonly times: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True when a sound may start at time `now` (ms); records it if so. */
  allow(now: number): boolean {
    while (this.times.length && now - this.times[0] > this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}

/** Gain for a source `distance` metres from the listener. */
export function distanceGain(distance: number): number {
  return 1 / (1 + distance / 7);
}

export class SoundEngine {
  /** Sounds started since creation, for diagnostics. */
  played = 0;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  private readonly impacts = new RateLimiter(5, 120);
  private readonly breaks = new RateLimiter(4, 150);

  /** Call from a user gesture (click / key). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio: stay silent
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Thud of a collision. `strength` 0..1 from the impact's velocity change, `hardness` on the Mohs scale, `mass` in kg. */
  impact(strength: number, hardness: number, mass: number, distance: number): void {
    if (!this.ready || strength < 0.05 || !this.impacts.allow(performance.now())) return;
    const gain = Math.min(1, strength) * distanceGain(distance) * 0.5;
    const cutoff = 250 + hardness * 520; // harder materials ring brighter
    this.burst(gain, 0.05 + Math.min(0.2, mass / 8000), "lowpass", cutoff);
    if (mass > 150) this.tone(55 + 4000 / (mass + 60), 30, gain * 0.9, 0.16);
  }

  /** Crack of a fracture; fragile, hard materials sound glassy. */
  fracture(hardness: number, distance: number): void {
    if (!this.ready || !this.breaks.allow(performance.now())) return;
    const gain = distanceGain(distance) * 0.55;
    this.burst(gain, 0.22, "bandpass", 900 + hardness * 700);
    for (let i = 0; i < 3; i++) this.burst(gain * 0.5, 0.03, "highpass", 2500 + hardness * 500, 0.02 + i * 0.035 + Math.random() * 0.02);
  }

  explosion(size: number, distance: number): void {
    if (!this.ready) return;
    const gain = Math.min(1, 0.5 + size * 0.25) * distanceGain(distance * 0.5);
    this.tone(95, 28, gain, 0.7);
    this.burst(gain * 0.9, 1.1, "lowpass", 480);
    this.burst(gain * 0.4, 0.12, "highpass", 1800);
  }

  splash(strength: number, distance: number): void {
    if (!this.ready || !this.impacts.allow(performance.now())) return;
    this.burst(Math.min(1, strength) * distanceGain(distance) * 0.4, 0.35, "bandpass", 1400);
  }

  /** Short interface blip. */
  click(pitch = 880): void {
    if (!this.ready) return;
    this.tone(pitch, pitch * 0.9, 0.08, 0.05);
  }

  private burst(gain: number, duration: number, type: BiquadFilterType, frequency: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || gain <= 0.002) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random() * 0.5, duration + 0.05);
    this.played++;
  }

  private tone(from: number, to: number, gain: number, duration: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || gain <= 0.002) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    this.played++;
  }
}
