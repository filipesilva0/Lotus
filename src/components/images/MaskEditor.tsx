import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Btn } from '../common/ui';
import { Slider } from '../common/ui';

/** Paint over the area to repaint. The exported PNG has those pixels transparent (ComfyUI reads transparency as the mask). */
export const MaskEditor: React.FC<{ open: boolean; src: string; onClose: () => void; onDone: (png: Blob) => void }> = ({ open, src, onClose, onDone }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const mask = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(40);
  const [erase, setErase] = useState(false);
  const [dirty, setDirty] = useState(false);
  const down = useRef(false);

  useEffect(() => { if (open) setDirty(false); }, [open, src]);

  const size = () => {
    const im = imgRef.current, c = mask.current;
    if (!im || !c) return;
    c.width = im.naturalWidth; c.height = im.naturalHeight;
  };

  const dab = (e: React.PointerEvent) => {
    const c = mask.current!, r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(255,40,90,1)';
    ctx.beginPath(); ctx.arc(x, y, (brush * k) / 2, 0, Math.PI * 2); ctx.fill();
    setDirty(true);
  };

  const finish = async () => {
    const im = imgRef.current!, m = mask.current!;
    const out = document.createElement('canvas');
    out.width = im.naturalWidth; out.height = im.naturalHeight;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(im, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(m, 0, 0);
    out.toBlob((b) => b && onDone(b), 'image/png');
  };

  return (
    <Modal open={open} onClose={onClose} title="Inpaint: paint the area to change" wide
      footer={<>
        <Btn variant="ghost" onClick={() => { const c = mask.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); setDirty(false); }}>Clear</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={!dirty} onClick={() => void finish()}>Repaint area</Btn>
      </>}>
      <div className="flex items-center gap-3 mb-3 text-[12px]">
        <span>Brush</span><div className="w-40"><Slider value={brush} min={8} max={160} step={1} onChange={setBrush} label="Brush size" /></div>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />Eraser</label>
      </div>
      <div className="relative inline-block max-w-full select-none touch-none" style={{ cursor: 'crosshair' }}>
        <img ref={imgRef} src={src} alt="Image to edit" onLoad={size} className="block max-w-full max-h-[56vh] rounded-[8px]" draggable={false} />
        <canvas ref={mask} aria-label="Mask painting area" className="absolute inset-0 w-full h-full opacity-60 rounded-[8px]"
          onPointerDown={(e) => { down.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); dab(e); }}
          onPointerMove={(e) => { if (down.current) dab(e); }}
          onPointerUp={() => { down.current = false; }} />
      </div>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Describe what should appear in the prompt box, then press Repaint. Uses the checkpoint this image was made with.</p>
    </Modal>
  );
};
