import React from 'react';
import lotusIcon from '../../assets/lotus-petals.png';

/**
 * The Lotus mark: the user's own five-petal artwork (blue, red, orange, yellow, green), unchanged.
 * Until 0.21 each petal was also one page's accent colour; the app now uses one accent everywhere.
 * Never redraw it; the user owns the art.
 */
export const LotusMark: React.FC<{ size?: number; className?: string; label?: string }> = ({ size = 30, className, label }) => (
  <img src={lotusIcon} alt={label ?? ''} width={size} height={size} draggable={false}
    className={`object-contain shrink-0 ${className ?? ''}`} style={{ width: size, height: size }} />
);
