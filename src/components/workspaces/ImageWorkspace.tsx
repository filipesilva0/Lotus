import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Download,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  ChevronDown,
  ImageIcon,
  Square,
} from 'lucide-react';
import { GeneratedImage } from '../../types/lotus';
import { PillSlider } from '../common/PillSlider';
import { Banner, Btn, Empty } from '../common/ui';
import { engineUrl } from '../../services/engineConfig';

interface ImageWorkspaceProps {
  images: GeneratedImage[];
  onGenerate: (params: {
    prompt: string;
    negativePrompt?: string;
    steps: number;
    cfg: number;
    checkpoint: string;
    aspectRatio: string;
  }) => void;
  isGenerating: boolean;
  checkpoints: string[];
  comfyUp: boolean | null;
  error: string | null;
  elapsedSec: number;
  onCancel: () => void;
  onOpenEngines: () => void;
}

export const ImageWorkspace: React.FC<ImageWorkspaceProps> = ({
  images,
  onGenerate,
  isGenerating,
  checkpoints,
  comfyUp,
  error,
  elapsedSec,
  onCancel,
  onOpenEngines,
}) => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('lowres, blurry, distorted, text, watermark');
  const [steps, setSteps] = useState(28);
  const [cfg, setCfg] = useState(7.0);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(() => localStorage.getItem('lotus.image.checkpoint') || '');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeImage, setActiveImage] = useState<GeneratedImage | undefined>(images[0]);

  // The newest generation becomes the one on show.
  useEffect(() => { setActiveImage(images[0]); }, [images[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Default to the first installed checkpoint (or the remembered one if it still exists).
  useEffect(() => {
    if (checkpoints.length && !checkpoints.includes(selectedCheckpoint)) setSelectedCheckpoint(checkpoints[0]);
  }, [checkpoints]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating || !selectedCheckpoint) return;
    localStorage.setItem('lotus.image.checkpoint', selectedCheckpoint);
    onGenerate({
      prompt,
      negativePrompt,
      steps,
      cfg,
      checkpoint: selectedCheckpoint,
      aspectRatio,
    });
  };

  const handleCopyPrompt = (p: string, id: string) => {
    navigator.clipboard.writeText(p);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full min-h-[580px] bg-[var(--color-bg-panel)] rounded-[24px] overflow-hidden select-none border border-black/5 dark:border-[var(--color-border-subtle)]">
      {/* Parameters Panel */}
      <div className="w-full lg:w-96 border-b lg:border-b-0 lg:border-r border-[var(--color-border-subtle)] p-5 flex flex-col justify-between bg-[var(--color-bg-sidebar)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${comfyUp ? 'bg-emerald-500' : comfyUp === null ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`} />
              <h3 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                {comfyUp ? 'ComfyUI running' : comfyUp === null ? 'Connecting…' : 'ComfyUI stopped'}
              </h3>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--color-badge-bg)] text-[var(--color-badge-text)]">
              {engineUrl('comfyui').replace('http://', '')}
            </span>
          </div>

          {/* Model Checkpoint Picker */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1.5">
              Checkpoint
            </label>
            <div className="relative">
              <select
                value={selectedCheckpoint}
                onChange={(e) => setSelectedCheckpoint(e.target.value)}
                className="w-full h-9 bg-[var(--color-bg-panel)] rounded-xl px-3 text-xs font-semibold text-[var(--color-text-main)] border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-vibrant)] appearance-none cursor-pointer"
              >
                {checkpoints.length === 0 && <option value="">{comfyUp ? 'No checkpoints found' : 'Start ComfyUI to list checkpoints'}</option>}
                {checkpoints.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)] absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>

          {/* Prompt Area */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1.5">
              Positive Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the image you want"
              className="w-full p-3 bg-[var(--color-bg-panel)] rounded-xl text-xs text-[var(--color-text-main)] border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-vibrant)] resize-none leading-relaxed"
            />
          </div>

          {/* Aspect Ratio Pills */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1.5">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {['1:1', '16:9', '9:16', '4:3', '3:4'].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-1.5 text-xs font-semibold rounded-xl transition-all ${
                    aspectRatio === ratio
                      ? 'bg-[var(--color-accent-vibrant)] text-white shadow-xs'
                      : 'bg-[var(--color-bg-panel)] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvanced ? 'Hide Advanced' : 'Show Advanced'}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-3 pt-2 border-t border-[var(--color-border-subtle)]">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1.5">
                  Negative Prompt
                </label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 bg-[var(--color-bg-panel)] rounded-xl text-xs text-[var(--color-text-main)] border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] focus:outline-none resize-none"
                />
              </div>

              {/* Steps Slider */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-[var(--color-text-muted)] mb-1">
                  <span>Inference Steps</span>
                  <span className="text-[var(--color-accent-vibrant)] font-bold tabular-nums">{steps}</span>
                </div>
                <PillSlider
                  value={steps}
                  onChange={setSteps}
                  min={4}
                  max={50}
                  unit=" steps"
                />
              </div>

              {/* CFG Slider */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-[var(--color-text-muted)] mb-1">
                  <span>CFG Guidance</span>
                  <span className="text-[var(--color-accent-vibrant)] font-bold tabular-nums">{cfg.toFixed(1)}</span>
                </div>
                <PillSlider
                  value={Math.round(cfg * 10)}
                  onChange={(val) => setCfg(val / 10)}
                  min={10}
                  max={150}
                  unit=""
                />
              </div>
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={isGenerating || !prompt.trim() || !selectedCheckpoint || !comfyUp}
            className="w-full h-11 rounded-full bg-[var(--color-accent-vibrant)] text-white font-bold text-xs tracking-wider flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] disabled:opacity-40 transition-all shadow-xs"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>GENERATING · {Math.floor(elapsedSec)}s</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>GENERATE IMAGE</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-4 space-y-2">
          {isGenerating && (
            <Btn variant="secondary" className="w-full" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={onCancel}>Cancel</Btn>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          {comfyUp === false && (
            <Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>ComfyUI isn't running. Start it to generate images.</Banner>
          )}
        </div>
      </div>

      {/* Main Preview & Gallery */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-[var(--color-bg-panel)]">
        {!activeImage && !isGenerating && (
          <Empty icon={<ImageIcon className="w-5 h-5" />} title="Nothing generated yet"
            body="Write a prompt on the left and press Generate. Images are made by ComfyUI on your own GPU." className="flex-1" />
        )}
        {/* Large Active Image Showcase */}
        {activeImage && (
          <div className="relative rounded-[22px] overflow-hidden bg-[var(--color-accent-pastel)] dark:bg-[#202228] border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] mb-6 flex items-center justify-center max-h-[380px]">
            <img
              src={activeImage.url}
              alt={activeImage.prompt}
              className="w-full h-full object-contain max-h-[380px]"
            />

            {/* Floating Info Overlay */}
            <div className="absolute bottom-3 left-3 right-3 bg-white/95 dark:bg-[#18191E]/95 backdrop-blur-md p-3 rounded-2xl flex items-center justify-between shadow-xs border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
              <div className="min-w-0 pr-3">
                <p className="text-xs font-semibold text-[var(--color-text-main)] truncate">
                  {activeImage.prompt}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] font-medium mt-0.5">
                  {activeImage.dimensions} · Seed: {activeImage.seed} · Steps: {activeImage.steps} · {activeImage.checkpoint}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopyPrompt(activeImage.prompt, activeImage.id)}
                  className="p-2 rounded-xl hover:bg-[var(--color-accent-pastel)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] transition-colors"
                  title="Copy Prompt"
                >
                  {copiedId === activeImage.id ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <a
                  href={activeImage.url}
                  download={`lotus-${activeImage.id}.png`}
                  className="p-2 rounded-xl bg-[var(--color-accent-vibrant)] text-white hover:brightness-110 transition-all shadow-xs"
                  title="Download Image"
                >
                  <Download className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Generated Images Grid */}
        <div>
          <h4 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-3">
            Output History & Cache
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                onClick={() => setActiveImage(img)}
                className={`relative group rounded-[18px] overflow-hidden cursor-pointer border-2 transition-all aspect-square bg-[var(--color-bg-sidebar)] ${
                  activeImage?.id === img.id
                    ? 'border-[var(--color-accent-vibrant)] shadow-sm scale-102'
                    : 'border-transparent hover:border-[var(--color-accent-pastel-border)]'
                }`}
              >
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2 text-xs text-white">
                  <span className="truncate">{img.prompt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
