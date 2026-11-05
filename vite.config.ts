import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022' }
})
