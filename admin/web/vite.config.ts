import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 개발 중에는 화면(5173)이 /api 요청을 로컬 BFF(8080)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
