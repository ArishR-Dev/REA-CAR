
import 'dotenv/config'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default {
    root: 'sources/',
    envDir: '../',
    publicDir: '../static/',
    base: './',
    server: {
        host: true,
        open: false,
        hmr: { overlay: false }
    },
    resolve: {
        preserveSymlinks: true,
        alias: [
            { find: 'normalize-wheel', replacement: '/vendor/normalize-wheel.js' },
            { find: 'seedrandom', replacement: '/vendor/seedrandom.js' },
            { find: 'msgpack-lite', replacement: '/vendor/msgpack-offline.js' },
            { find: 'emoji-regex', replacement: '/vendor/emoji-regex.js' },
            { find: 'howler', replacement: '/vendor/howler.js' }
        ]
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: false,
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: false
    },
    plugins: [
        wasm(),
        topLevelAwait(),
        nodePolyfills()
        // basicSsl() remains disabled
    ]
}
