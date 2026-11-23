import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 路径可能包含非 ASCII 字符（如中文目录名），需要解码百分号转义
      "@": decodeURIComponent(new URL("./src", import.meta.url).pathname),
    },
  },
});
