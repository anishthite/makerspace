export const COMPLETION_CHIME_KEY = 'spannerCompletionChime';
export const DEFAULT_COMPLETION_CHIME = 'spark';

export const COMPLETION_CHIMES = [
  {
    id: 'spark',
    label: 'spark',
    summary: 'quick bright confirmation',
    steps: [
      { at: 0, frequency: 783.99, duration: 0.11, gain: 0.075, type: 'triangle' },
      { at: 0.09, frequency: 1174.66, duration: 0.13, gain: 0.06, type: 'triangle' },
      { at: 0.18, frequency: 1567.98, duration: 0.16, gain: 0.045, type: 'sine' },
    ],
  },
];

let audioContext = null;
let lastPlaybackAt = 0;

export function readCompletionChime() {
  try {
    const value = String(localStorage.getItem(COMPLETION_CHIME_KEY) || '').trim();
    return COMPLETION_CHIMES.some((chime) => chime.id === value) ? value : DEFAULT_COMPLETION_CHIME;
  } catch {
    return DEFAULT_COMPLETION_CHIME;
  }
}

export function writeCompletionChime(id) {
  const value = COMPLETION_CHIMES.some((chime) => chime.id === id) ? id : DEFAULT_COMPLETION_CHIME;
  try {
    localStorage.setItem(COMPLETION_CHIME_KEY, value);
  } catch {}
  return value;
}

export function selectedCompletionChime() {
  const id = readCompletionChime();
  return COMPLETION_CHIMES.find((chime) => chime.id === id) || COMPLETION_CHIMES[0];
}

function audioCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext;
}

function getAudioContext() {
  const AudioContextCtor = audioCtor();
  if (!AudioContextCtor) return null;
  audioContext ||= new AudioContextCtor();
  return audioContext;
}

function errorSteps() {
  return [
    { at: 0, frequency: 392, duration: 0.15, gain: 0.07, type: 'triangle' },
    { at: 0.12, frequency: 293.66, duration: 0.24, gain: 0.065, type: 'sine' },
  ];
}

function playStep(context, master, step, baseTime) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = baseTime + step.at;
  const end = start + step.duration;
  const peakAt = start + Math.min(0.025, step.duration / 3);
  oscillator.type = step.type || 'sine';
  oscillator.frequency.setValueAtTime(step.frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(step.gain, 0.0001), peakAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

export async function playCompletionChime({ outcome = 'success', id = readCompletionChime() } = {}) {
  const now = Date.now();
  if (now - lastPlaybackAt < 450) return false;
  const chime = COMPLETION_CHIMES.find((item) => item.id === id) || selectedCompletionChime();
  const steps = outcome === 'error' ? errorSteps() : chime.steps;
  if (!steps.length) return false;
  const context = getAudioContext();
  if (!context) return false;
  lastPlaybackAt = now;
  try {
    if (context.state === 'suspended') await context.resume();
    const master = context.createGain();
    master.gain.value = 0.82;
    master.connect(context.destination);
    const baseTime = context.currentTime + 0.015;
    for (const step of steps) playStep(context, master, step, baseTime);
    const lastStep = steps.reduce((last, step) => Math.max(last, step.at + step.duration), 0);
    setTimeout(() => master.disconnect(), Math.ceil((lastStep + 0.2) * 1000));
    return true;
  } catch {
    return false;
  }
}
