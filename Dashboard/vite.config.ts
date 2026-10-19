import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this repo at https://synv3x.github.io/AdaptiveDesk/
// Override with VITE_BASE (e.g. VITE_BASE=/ for a custom domain).
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/AdaptiveDesk/' : '/'),
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
}))
