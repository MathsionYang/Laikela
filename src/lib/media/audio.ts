/**
 * 本地音轨合成。
 * 未接入 TTS 供应商时，按文案字数与语速合成一条真实可播放的 WAV：
 * 语音段用带包络的共振峰模拟说话节奏，BGM 段按情绪给和弦铺底。
 * 输出的时长、分段、波形都是真实的，可直接在 WaveSurfer 里播放与校对。
 */

const SAMPLE_RATE = 22050;

interface Chord {
  /** 基频与泛音权重 */
  freqs: number[];
  gains: number[];
}

const CHORDS: Record<string, Chord> = {
  轻快: { freqs: [261.63, 329.63, 392.0, 523.25], gains: [0.5, 0.42, 0.34, 0.2] },
  温暖: { freqs: [174.61, 220.0, 261.63, 349.23], gains: [0.55, 0.4, 0.32, 0.22] },
  悬疑: { freqs: [110.0, 155.56, 233.08], gains: [0.5, 0.34, 0.26] },
  "无 BGM": { freqs: [], gains: [] },
};

export interface AudioSynthInput {
  text: string;
  speed: number;
  bgm: string;
  voice: string;
}

export interface AudioSegment {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface AudioSynthResult {
  buffer: Buffer;
  durationMs: number;
  segments: AudioSegment[];
  peak: number;
}

/** 按标点切句，用于生成分段与停顿 */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** 每个字的时长（毫秒），语速 1.0 约 210ms/字 */
const CHAR_MS = 210;

export function synthAudio(input: AudioSynthInput): AudioSynthResult {
  const speed = Math.min(1.5, Math.max(0.8, input.speed || 1));
  const sentences = splitSentences(input.text);
  const chars = input.text.replace(/\s/g, "").length;

  // 句间停顿 260ms，整体再留 700ms 尾巴
  const speakMs = Math.round((chars * CHAR_MS) / speed);
  const pauseMs = Math.max(0, sentences.length - 1) * 260;
  const durationMs = Math.max(1200, speakMs + pauseMs + 700);
  const total = Math.round((durationMs / 1000) * SAMPLE_RATE);

  const samples = new Float32Array(total);

  // ---- 语音段：按句子分配时间，句内做音节包络 ----
  const segments: AudioSegment[] = [];
  let cursor = 0.12; // 起始留白（秒）
  const msPerChar = CHAR_MS / speed / 1000;

  for (const [i, s] of sentences.entries()) {
    const len = Math.max(1, s.replace(/\s/g, "").length);
    const dur = len * msPerChar;
    const startMs = Math.round(cursor * 1000);
    segments.push({ index: i + 1, text: s, startMs, endMs: Math.round((cursor + dur) * 1000) });

    // 基频按音色给不同音高，元音位置做共振峰
    const base =
      input.voice.includes("男") ? 118 : input.voice.includes("童") ? 268 : input.voice.includes("元气") ? 232 : 196;
    const from = Math.round(cursor * SAMPLE_RATE);
    const to = Math.min(total, Math.round((cursor + dur) * SAMPLE_RATE));

    for (let n = from; n < to; n++) {
      const t = (n - from) / SAMPLE_RATE;
      // 音节包络：约 4.2 个音节/秒
      const syl = Math.sin(2 * Math.PI * 4.2 * t);
      const env = Math.pow(Math.max(0, syl * 0.5 + 0.55), 1.6);
      // 音高微微起伏，避免机械感
      const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 5.1 * t);
      const v =
        Math.sin(2 * Math.PI * base * vibrato * t) * 0.55 +
        Math.sin(2 * Math.PI * base * 2.02 * vibrato * t) * 0.26 +
        Math.sin(2 * Math.PI * base * 3.05 * vibrato * t) * 0.12 +
        Math.sin(2 * Math.PI * base * 4.2 * vibrato * t) * 0.07;
      // 句首句尾淡入淡出
      const fade = Math.min(1, t / 0.05, (dur - t) / 0.08);
      samples[n] += v * env * Math.max(0, fade) * 0.30;
    }

    cursor += dur + 0.26;
  }

  // ---- BGM：整段铺和弦，音量低，句间也不断 ----
  const chord = CHORDS[input.bgm] ?? CHORDS["无 BGM"];
  if (chord.freqs.length) {
    for (let n = 0; n < total; n++) {
      const t = n / SAMPLE_RATE;
      let v = 0;
      for (let k = 0; k < chord.freqs.length; k++) {
        v += Math.sin(2 * Math.PI * chord.freqs[k] * t) * chord.gains[k];
      }
      // 缓慢呼吸感
      const breathe = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.16 * t);
      const fade = Math.min(1, t / 0.8, (total / SAMPLE_RATE - t) / 1.4);
      samples[n] += v * 0.055 * breathe * Math.max(0, fade);
    }
  }

  // ---- 归一化到 -3dB，写 WAV ----
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 ? 0.7 / peak : 1;
  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }

  return { buffer: wavFile(pcm, SAMPLE_RATE), durationMs, segments, peak: Number(peak.toFixed(3)) };
}

function wavFile(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
