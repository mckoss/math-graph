import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Base path matches the GitHub Pages project-site URL:
// https://mckoss.github.io/math-graph/
export default defineConfig({
  base: '/math-graph/',
  plugins: [svelte()],
  define: {
    // Site version shown under the title; source of truth is package.json.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
