import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Two entry pages: the studio (index.html) and the floating island (island.html).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  clearScreen: false,
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  server: { port: 3000, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'chrome105', // WebView2 is evergreen Chromium
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), island: path.resolve(__dirname, 'island.html') } },
  },
});
