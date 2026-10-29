// A small, hand-picked list of well-known models from the Ollama library. Names and size tags come from
// ollama.com/library; nothing here is a live listing, so anything else can be pulled with “Import / Download”.

export type ModelTag = 'Coding' | 'Reasoning' | 'Vision' | 'General' | 'Small';
export interface CatalogModel {
  id: string; title: string; maker: string; blurb: string; tags: ModelTag[];
  /** Parameter counts (billions) that exist as `name:<size>` tags. */
  sizes: number[];
  /** Builds the tag for a non-default quantisation, when the library publishes them under a predictable name. */
  quantTag?: (size: number, quant: Quant) => string;
}

export const QUANTS = [
  { id: 'default', label: 'Default (≈Q4_K_M)', bpw: 4.85 },
  { id: 'q8_0', label: 'Q8_0', bpw: 8.5 },
  { id: 'fp16', label: 'FP16', bpw: 16 },
] as const;
export type Quant = (typeof QUANTS)[number]['id'];

const instruct = (id: string) => (s: number, q: Quant) => `${id}:${s}b-instruct-${q}`;

export const CATALOG: CatalogModel[] = [
  { id: 'llama3.3', title: 'Llama 3.3', maker: 'Meta', blurb: 'Large general-purpose model with strong instruction following.', tags: ['General'], sizes: [70], quantTag: instruct('llama3.3') },
  { id: 'llama3.2', title: 'Llama 3.2', maker: 'Meta', blurb: 'Compact models that run on modest hardware.', tags: ['General', 'Small'], sizes: [1, 3], quantTag: instruct('llama3.2') },
  { id: 'llama3.2-vision', title: 'Llama 3.2 Vision', maker: 'Meta', blurb: 'Understands images as well as text.', tags: ['Vision'], sizes: [11] },
  { id: 'qwen2.5', title: 'Qwen 2.5', maker: 'Alibaba', blurb: 'Multilingual, good at structured output.', tags: ['General'], sizes: [0.5, 1.5, 3, 7, 14, 32, 72], quantTag: instruct('qwen2.5') },
  { id: 'qwen2.5-coder', title: 'Qwen 2.5 Coder', maker: 'Alibaba', blurb: 'Tuned for writing and reviewing code.', tags: ['Coding'], sizes: [1.5, 7, 14, 32], quantTag: instruct('qwen2.5-coder') },
  { id: 'qwen3', title: 'Qwen 3', maker: 'Alibaba', blurb: 'Switchable thinking mode for harder problems.', tags: ['General', 'Reasoning'], sizes: [0.6, 1.7, 4, 8, 14, 32] },
  { id: 'mistral', title: 'Mistral 7B', maker: 'Mistral AI', blurb: 'A fast, dependable 7B all-rounder.', tags: ['General', 'Small'], sizes: [7] },
  { id: 'deepseek-r1', title: 'DeepSeek-R1', maker: 'DeepSeek', blurb: 'Shows its reasoning before answering.', tags: ['Reasoning'], sizes: [1.5, 7, 8, 14, 32, 70] },
  { id: 'gemma3', title: 'Gemma 3', maker: 'Google', blurb: 'Efficient models; the larger sizes read images.', tags: ['General', 'Vision'], sizes: [1, 4, 12, 27] },
  { id: 'phi4', title: 'Phi-4', maker: 'Microsoft', blurb: 'Strong reasoning for its size.', tags: ['Reasoning', 'Small'], sizes: [14] },
];

/** Rough VRAM need in GB: weights plus ~15% working memory and ~0.5 GB for the context cache. */
export const estimateVram = (billions: number, bpw: number) => Math.round((billions * bpw / 8 * 1.15 + 0.5) * 10) / 10;

export const paramsOf = (sizeStr?: string) => { const m = /([\d.]+)\s*([BM])/i.exec(sizeStr ?? ''); return m ? parseFloat(m[1]) * (m[2].toUpperCase() === 'M' ? 0.001 : 1) : 0; };
export const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
