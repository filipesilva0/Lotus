// Playback the microphone can ignore (0.15.0), so a call can be interrupted by voice on speakers.
//
// The window's echo cancellation (getUserMedia echoCancellation: true) only removes sound that the
// web engine plays through WebRTC; a plain <audio> element isn't removed, so Lotus heard itself and
// "interrupted" its own answer. Lotus therefore sends its voice through a WebRTC connection to itself
// (two RTCPeerConnections inside the window, nothing leaves the computer) and plays what comes out.
// That is what WebRTC calls do, so echo cancellation treats Lotus's voice like the other side of a call.
//
// If the loop can't be set up, or no sound comes out of it, Lotus plays directly (as before) and the
// call raises its interrupt threshold instead (see call.ts).

let ctx: AudioContext | null = null;
let loop: { dest: MediaStreamAudioDestinationNode; el: HTMLAudioElement; a: RTCPeerConnection; b: RTCPeerConnection; out: AnalyserNode } | null = null;
let loopOk: boolean | null = null; // null = not tried yet
let playLevel = 0;

const audioCtx = () => { if (!ctx || ctx.state === 'closed') ctx = new AudioContext(); void ctx.resume().catch(() => undefined); return ctx; };

async function makeLoop(c: AudioContext) {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('no WebRTC');
  const dest = c.createMediaStreamDestination();
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => { if (e.candidate) void b.addIceCandidate(e.candidate).catch(() => undefined); };
  b.onicecandidate = (e) => { if (e.candidate) void a.addIceCandidate(e.candidate).catch(() => undefined); };
  const remote = new Promise<MediaStream>((r) => { b.ontrack = (e) => r(e.streams[0] ?? new MediaStream([e.track])); });
  dest.stream.getTracks().forEach((t) => a.addTrack(t, dest.stream));
  // WebRTC sends voice at phone-call quality by default; ask Opus for full quality (it never leaves the computer).
  const hq = (d: RTCSessionDescriptionInit): RTCSessionDescriptionInit => ({ type: d.type, sdp: d.sdp?.replace(/(a=fmtp:\d+ [^\r\n]*useinbandfec=1)/g, '$1;maxaveragebitrate=256000;maxplaybackrate=48000;usedtx=0') });
  const offer = hq(await a.createOffer());
  await a.setLocalDescription(offer); await b.setRemoteDescription(offer);
  const answer = hq(await b.createAnswer());
  await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
  const stream = await Promise.race([remote, new Promise<never>((_, j) => setTimeout(() => j(new Error('loop timeout')), 3000))]);
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  await el.play().catch(() => undefined);
  // What comes out of the loop, to check that sound really arrives.
  const out = c.createAnalyser(); out.fftSize = 512;
  c.createMediaStreamSource(stream).connect(out);
  return { dest, el, a, b, out };
}

const peak = (an: AnalyserNode, buf: Uint8Array<ArrayBuffer>) => { an.getByteTimeDomainData(buf); let p = 0; for (const s of buf) p = Math.max(p, Math.abs(s - 128) / 128); return p; };

/** Whether Lotus's voice currently goes through echo cancellation (null before the first answer). */
export const echoSafe = () => loopOk;
/** How loud Lotus is playing right now (0…1), for the interrupt threshold. */
export const playbackLevel = () => playLevel;

let stopCurrent: (() => void) | null = null;

/** Stops what is playing. */
export function stopPlayback() { stopCurrent?.(); stopCurrent = null; playLevel = 0; }

/** Plays a WAV/MP3 blob; resolves when it ends or is stopped. */
export async function playThroughLoop(blob: Blob): Promise<void> {
  const c = audioCtx();
  const audio = await c.decodeAudioData(await blob.arrayBuffer());
  if (loopOk !== false && !loop) {
    try { loop = await makeLoop(c); }
    catch (e) { console.warn('[lotus] voice loop unavailable, playing directly', e); loopOk = false; }
  }
  stopPlayback();
  const src = c.createBufferSource();
  src.buffer = audio;
  const meter = c.createAnalyser(); meter.fftSize = 512;
  src.connect(meter);
  const viaLoop = !!loop && loopOk !== false;
  if (viaLoop) meter.connect(loop!.dest); else meter.connect(c.destination);
  const buf = new Uint8Array(new ArrayBuffer(512));
  const outBuf = new Uint8Array(new ArrayBuffer(512));
  let raf = 0, sent = 0, arrived = 0, ended = false;
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (ended) return; ended = true;
      cancelAnimationFrame(raf); clearInterval(timer);
      try { src.stop(); } catch { /* not started */ }
      try { src.disconnect(); meter.disconnect(); } catch { /* */ }
      playLevel = 0;
      if (stopCurrent === stop) stopCurrent = null;
      resolve();
    };
    const stop = () => finish();
    stopCurrent = stop;
    src.onended = finish;
    const tick = () => {
      playLevel = peak(meter, buf);
      if (viaLoop && loopOk === null) {
        if (playLevel > 0.05) sent++;
        if (peak(loop!.out, outBuf) > 0.02) arrived++;
        // Sound went in for ~20 frames and nothing came out: the loop is silent here, play directly.
        if (arrived > 3) loopOk = true;
        else if (sent > 20) {
          loopOk = false;
          console.warn('[lotus] voice loop is silent, playing directly');
          try { meter.disconnect(); meter.connect(c.destination); } catch { /* */ }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    // Animation frames stop in a hidden window; the timer keeps the level (and the check) going.
    const timer = setInterval(() => { if (!ended) { cancelAnimationFrame(raf); tick(); } }, 60);
    src.start();
    tick();
  });
}
