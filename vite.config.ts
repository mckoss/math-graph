import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

function currentBranch(): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

const branch = currentBranch()
const branchSuffix = branch && branch !== 'main' ? `-${branch.replace(/[^a-zA-Z0-9.-]+/g, '-')}` : ''
const displayVersion = `${pkg.version}${branchSuffix}`

// Base path matches the GitHub Pages project-site URL:
// https://mckoss.github.io/math-graph/
export default defineConfig({
  base: '/math-graph/',
  plugins: [svelte()],
  define: {
    // Feature builds identify their review worktree without consuming a release version.
    __APP_VERSION__: JSON.stringify(displayVersion),
  },
})
