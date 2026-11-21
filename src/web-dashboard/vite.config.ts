import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // CloudFront serves the dashboard under /dashboard/ (see .github/workflows/frontend-deploy.yml).
  base: "/dashboard/",
  plugins: [react()],
});
