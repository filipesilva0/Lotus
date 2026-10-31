import React from 'react';
import lotusIcon from '../../assets/lotus-petals.png';

/**
 * The Lotus mark: the user's own five-petal artwork (blue, red, orange, yellow, green), unchanged.
 * Each petal stands for one page and its accent colour: Chat, Images, Voice, App Builder, Tasks
 * (styles/theme.ts PAGE_PALETTE / PETAL_ORDER). Never redraw it; the user owns the art.
 */
export const LotusMark: React.FC<{ size?: number; className?: string; label?: string }> = ({ size = 30, className, label }) => (
  <img src={lotusIcon} alt={label ?? ''} width={size} height={size} draggable={false}
    className={`object-contain shrink-0 ${className ?? ''}`} style={{ width: size, height: size }} />
);
