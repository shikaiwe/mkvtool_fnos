import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './'：前端可能挂在网关前缀 /app/<appname>/ 之下，必须使用相对资源路径
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8321', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8321', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2048,
  },
})
