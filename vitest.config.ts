import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/api/**/*.test.ts','tests/**/*.test.ts'],exclude:['**/node_modules/**','**/e2e/**'],testTimeout:30000,env:{QLOO_API_KEY:'',TASTE_SOURCE:'',QLOO_PRECONFIRMED_MAPPINGS:''}}});
