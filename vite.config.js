import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    rollupOptions: {
      input: {
        avatar: resolve(process.cwd(), 'index.html'),
        referenceLab: resolve(process.cwd(), 'reference-lab.html')
      }
    }
  }
});
