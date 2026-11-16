// Which release file of each built-in engine to download for this computer (pure, tested).
//
//   llama.cpp             ggml-org/llama.cpp           chat (llama-server)
//   stable-diffusion.cpp  leejet/stable-diffusion.cpp  images (sd-cli)
//   sherpa-onnx           k2-fsa/sherpa-onnx           speech: Kokoro and Piper voices, Whisper dictation
//
// Names seen on the releases pages on 16 Nov 2026 (llama.cpp b11669, sd.cpp master-995-fd21ecf,
// sherpa-onnx v1.13.7). whisper.cpp stopped publishing binaries (v1.9.5 has only source), which is why
// speech uses sherpa-onnx, which runs the same Whisper models plus Kokoro and Piper voices.

export type BuiltinId = 'llama' | 'sd' | 'sherpa';
export type Os = 'windows' | 'macos' | 'linux';
export type Arch = 'x64' | 'arm64';
export type Gpu = 'nvidia' | 'amd' | 'intel' | 'apple' | 'none';

export interface Platform { os: Os; arch: Arch; gpu: Gpu }
export interface Asset { name: string; url: string; size: number }
export interface Release { tag: string; assets: Asset[] }

export interface RuntimeSpec {
  id: BuiltinId;
  name: string;
  repo: string;
  role: string;
  licence: string;
  /** Executables Lotus needs inside the unpacked release (first found wins per entry). */
  exes: string[][];
}

export const RUNTIMES: Record<BuiltinId, RuntimeSpec> = {
  llama: { id: 'llama', name: 'llama.cpp', repo: 'ggml-org/llama.cpp', role: 'Chat', licence: 'MIT', exes: [['llama-server']] },
  sd: { id: 'sd', name: 'stable-diffusion.cpp', repo: 'leejet/stable-diffusion.cpp', role: 'Images', licence: 'MIT', exes: [['sd-cli', 'sd']] },
  sherpa: { id: 'sherpa', name: 'sherpa-onnx', repo: 'k2-fsa/sherpa-onnx', role: 'Voice and dictation', licence: 'Apache-2.0', exes: [['sherpa-onnx-offline-tts'], ['sherpa-onnx-offline']] },
};
export const BUILTIN_ORDER: BuiltinId[] = ['llama', 'sd', 'sherpa'];

/** What to download: the engine itself, plus CUDA runtime libraries for NVIDIA builds on Windows. */
export interface Pick { main: Asset; extra: Asset[]; flavour: string }

const find = (assets: Asset[], re: RegExp, not?: RegExp) => assets.find((a) => re.test(a.name) && !(not && not.test(a.name)));

/** The ordered list of builds to try for a computer: [label, main pattern, extra pattern?]. */
function wishes(id: BuiltinId, p: Platform): [string, RegExp, RegExp?][] {
  const { os, arch, gpu } = p;
  if (id === 'llama') {
    if (os === 'windows') {
      const a = arch === 'arm64' ? 'arm64' : 'x64';
      const out: [string, RegExp, RegExp?][] = [];
      // CUDA 12.4 works with older NVIDIA drivers than the 13.x builds do.
      if (gpu === 'nvidia') out.push(['NVIDIA (CUDA 12)', new RegExp(`^llama-.*-bin-win-cuda-12[.\\d]*-${a}\\.zip$`), new RegExp(`^cudart-llama-bin-win-cuda-12[.\\d]*-${a}\\.zip$`)],
        ['NVIDIA (CUDA 13)', new RegExp(`^llama-.*-bin-win-cuda-13[.\\d]*-${a}\\.zip$`), new RegExp(`^cudart-llama-bin-win-cuda-13[.\\d]*-${a}\\.zip$`)]);
      if (gpu !== 'none') out.push(['Vulkan', new RegExp(`^llama-.*-bin-win-vulkan-${a}\\.zip$`)]);
      out.push(['Processor', new RegExp(`^llama-.*-bin-win-cpu-${a}\\.zip$`)]);
      return out;
    }
    if (os === 'macos') return [['Metal', new RegExp(`^llama-.*-bin-macos-${arch}\\.(tar\\.gz|zip)$`)]];
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    const out: [string, RegExp, RegExp?][] = [];
    // The Linux CUDA builds expect the CUDA libraries the cudart archive carries.
    if (gpu === 'nvidia') out.push(['NVIDIA (CUDA 12)', new RegExp(`^llama-.*-bin-ubuntu-cuda-12[.\\d]*-${a}\\.(tar\\.gz|zip)$`), new RegExp(`^cudart-llama-.*-bin-ubuntu-cuda-12[.\\d]*-${a}\\.(tar\\.gz|zip)$`)]);
    if (gpu === 'nvidia' || gpu === 'amd' || gpu === 'intel') out.push(['Vulkan', new RegExp(`^llama-.*-bin-ubuntu-vulkan-${a}\\.(tar\\.gz|zip)$`)]);
    out.push(['Processor', new RegExp(`^llama-.*-bin-ubuntu-${a}\\.(tar\\.gz|zip)$`)]);
    return out;
  }
  if (id === 'sd') {
    if (os === 'windows') {
      if (arch !== 'x64') return [];
      const out: [string, RegExp, RegExp?][] = [];
      if (gpu === 'nvidia') out.push(['NVIDIA (CUDA 12)', /^sd-.*-bin-win-cuda12-x64\.zip$/, /^cudart-sd-bin-win-cu12-x64\.zip$/]);
      if (gpu === 'amd') out.push(['AMD (ROCm)', /^sd-.*-bin-win-rocm-[\d.]+-x64\.zip$/]);
      if (gpu !== 'none') out.push(['Vulkan', /^sd-.*-bin-win-vulkan-x64\.zip$/]);
      out.push(['Processor', /^sd-.*-bin-win-cpu-x64\.zip$/], ['Processor', /^sd-.*-bin-win-avx2-x64\.zip$/]);
      return out;
    }
    if (os === 'macos') return arch === 'arm64' ? [['Metal', /^sd-.*-bin-Darwin-macOS-[\d.]+-arm64\.zip$/]] : [];
    if (arch !== 'x64') return [];
    const out: [string, RegExp, RegExp?][] = [];
    if (gpu !== 'none') out.push(['Vulkan', /^sd-.*-bin-Linux-Ubuntu-[\d.]+-x86_64-vulkan\.zip$/]);
    out.push(['Processor', /^sd-.*-bin-Linux-Ubuntu-[\d.]+-x86_64\.zip$/]);
    return out;
  }
  // sherpa-onnx: static Release builds carry no extra libraries; speech runs fine on the processor.
  if (os === 'windows') return arch === 'x64' ? [['Processor', /^sherpa-onnx-v[\d.]+-win-x64-static-MT-Release\.tar\.bz2$/]] : [['Processor', /^sherpa-onnx-v[\d.]+-win-arm64-static-MT-Release\.tar\.bz2$/]];
  if (os === 'macos') return [['Processor', /^sherpa-onnx-v[\d.]+-osx-universal2-static\.tar\.bz2$/], ['Processor', new RegExp(`^sherpa-onnx-v[\\d.]+-osx-${arch === 'arm64' ? 'arm64' : 'x64'}-static\\.tar\\.bz2$`)]];
  return [['Processor', new RegExp(`^sherpa-onnx-v[\\d.]+-linux-${arch === 'arm64' ? 'aarch64' : 'x64'}-static\\.tar\\.bz2$`)]];
}

/** The build to download from one release, or null if this release has none for the computer. */
export function pickAssets(id: BuiltinId, assets: Asset[], p: Platform): Pick | null {
  for (const [flavour, main, extra] of wishes(id, p)) {
    const m = find(assets, main, /-lib\.|no-tts|Debug|RelWithDebInfo|MinSizeRel|-ui\./);
    if (!m) continue;
    const x = extra ? find(assets, extra) : undefined;
    if (extra && !x) continue; // a CUDA build without its runtime would not start
    return { main: m, extra: x ? [x] : [], flavour };
  }
  return null;
}

/**
 * Newest release that has a build for this computer. llama.cpp's "latest" release is not always a
 * binary release, and sd.cpp tags every commit, so Lotus looks through the most recent few.
 */
export function pickRelease(id: BuiltinId, releases: Release[], p: Platform): { release: Release; pick: Pick } | null {
  for (const r of releases) { const pk = pickAssets(id, r.assets, p); if (pk) return { release: r, pick: pk }; }
  return null;
}

/** GitHub's releases API → Release[] (ignores drafts). */
export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) return [];
  return json.filter((r) => r && typeof r === 'object' && !(r as { draft?: boolean }).draft).map((r) => {
    const o = r as { tag_name?: string; assets?: { name?: string; browser_download_url?: string; size?: number }[] };
    return { tag: String(o.tag_name ?? ''), assets: (o.assets ?? []).filter((a) => a.name && a.browser_download_url).map((a) => ({ name: String(a.name), url: String(a.browser_download_url), size: Number(a.size) || 0 })) };
  });
}

export const exeName = (base: string, os: Os) => (os === 'windows' ? `${base}.exe` : base);
