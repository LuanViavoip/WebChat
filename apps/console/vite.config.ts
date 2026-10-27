import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
