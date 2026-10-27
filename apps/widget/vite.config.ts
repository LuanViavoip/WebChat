import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/widget/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
