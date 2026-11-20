// AudioWorklet of the voice channel's microphone (bundled to client/dist/voice-worklet.js, loaded by ./voice.ts with
// `audioWorklet.addModule('/voice-worklet.js?v=<hash>')`: a same-origin file, since the app's CSP `script-src 'self'`
// governs addModule and refuses a blob URL). Resamples the context rate to VOICE_RATE, converts to int16 and posts
// each VOICE_CHUNK_SAMPLES chunk (an ArrayBuffer, transferred) to the main thread, which sends it on the data channel.
import { Chunker, Resampler, toInt16 } from './voicedsp.ts';

export type WorkletEntry = true; // lets a test `import type` this file so `tsc -p .` checks it

// AudioWorkletGlobalScope (the project compiles against the DOM lib, which lacks it).
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class MicChunks extends AudioWorkletProcessor {
  private rs = new Resampler(sampleRate);
  private ch = new Chunker();
  process(inputs: Float32Array[][]): boolean {
    const x = inputs[0]?.[0];
    if (x?.length) for (const c of this.ch.push(toInt16(this.rs.push(x)))) this.port.postMessage(c.buffer, [c.buffer]);
    return true;
  }
}
registerProcessor('briefling-mic', MicChunks);
