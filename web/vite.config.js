import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import path from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    // Vant 组件按需自动引入，无需在每个页面手动 import
    Components({ resolvers: [VantResolver()], dts: false }),
  ],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    host: true,
    port: 5173,
    // 开发时把 /api 代理到后端，前后端分离开发不跨域
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
})
