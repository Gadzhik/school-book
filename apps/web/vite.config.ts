import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { foliateVendorDir } from '@reader/reader-engine/vendor-path';

const require = createRequire(import.meta.url);
const norm = (p: string) => p.replace(/\\/g, '/');

// Путь к вендорённому foliate-js (нормализуем слэши для fast-glob на Windows).
const foliateSrc = norm(foliateVendorDir);

// Ассеты Tesseract.js (worker + core-wasm) копируем из node_modules в /tesseract,
// чтобы OCR работал офлайн. Языковые данные — в public/tesseract/lang.
const tessDistDir = norm(dirname(require.resolve('tesseract.js/package.json')));
const tessCoreDir = norm(dirname(require.resolve('tesseract.js-core/package.json')));

// Ассеты KaTeX (CSS + шрифты) копируем в /katex — рендер формул офлайн.
// CSS подключается внутрь iframe книги, шрифты грузятся по относит. пути fonts/.
const katexDir = norm(dirname(require.resolve('katex/package.json')));

// OpenCV.js (~10МБ, wasm встроен) для авто-обрезки страниц сканера (Stage B).
// Копируем в /opencv, грузим лениво script-тегом, кэшируем по запросу (не precache).
const opencvDir = norm(dirname(require.resolve('@techstark/opencv-js/package.json')));

export default defineConfig({
  plugins: [
    svelte(),
    // foliate-js отдаётся как статический ESM по адресу /foliate-js/*
    // (он сам грузит свои модули и ассеты pdf.js через import.meta.url).
    viteStaticCopy({
      targets: [
        { src: foliateSrc, dest: '.' },
        { src: `${tessDistDir}/dist/worker.min.js`, dest: 'tesseract' },
        // Core-варианты (SIMD/LSTM): tesseract.js сам выберет подходящий.
        { src: `${tessCoreDir}/*.{wasm,js}`, dest: 'tesseract' },
        { src: `${katexDir}/dist/katex.min.css`, dest: 'katex' },
        { src: `${katexDir}/dist/fonts`, dest: 'katex' },
        { src: `${opencvDir}/dist/opencv.js`, dest: 'opencv' },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Читалка для школьников',
        short_name: 'Читалка',
        description:
          'Офлайн-первая приватная читалка: EPUB, FB2, PDF и другие форматы.',
        lang: 'ru',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2,ttf,wasm}'],
        // Tesseract (core-wasm ~30МБ + языки ~20МБ) не пихаем в precache —
        // кэшируем по запросу при первом использовании OCR.
        globIgnores: ['**/tesseract/**', '**/katex/**', '**/opencv/**', '**/mupdf-wasm-*.wasm', '**/pandoc-*.wasm'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // Ассеты foliate-js / pdf.js (cmaps, шрифты) — по запросу.
            urlPattern: ({ url }) => url.pathname.startsWith('/foliate-js/'),
            handler: 'CacheFirst',
            options: { cacheName: 'foliate-assets' },
          },
          {
            // OCR: worker, core-wasm, языковые данные — по запросу (офлайн после).
            urlPattern: ({ url }) => url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-assets',
              expiration: { maxEntries: 40 },
            },
          },
          {
            // KaTeX: CSS и шрифты формул — по запросу (офлайн после первого раза).
            urlPattern: ({ url }) => url.pathname.startsWith('/katex/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'katex-assets',
              expiration: { maxEntries: 80 },
            },
          },
          {
            // mupdf-wasm (~10МБ) — не в precache; кэшируем по запросу (PDF→текст mupdf).
            urlPattern: ({ url }) => /mupdf-wasm-.*\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mupdf-assets',
              expiration: { maxEntries: 4 },
            },
          },
          {
            // pandoc-wasm (~58МБ) — не в precache; кэшируем по запросу (конвертер документов).
            urlPattern: ({ url }) => /pandoc-.*\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pandoc-assets',
              expiration: { maxEntries: 2 },
            },
          },
          {
            // OpenCV.js (~10МБ) — не в precache; кэшируем по запросу (авто-обрезка сканера).
            urlPattern: ({ url }) => url.pathname.startsWith('/opencv/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv-assets',
              expiration: { maxEntries: 2 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // pandoc-wasm грузит свой .wasm как URL-ассет (import('./pandoc.wasm').default →
  // fetch). Помечаем .wasm как статический ассет, иначе Vite вернёт init-функцию.
  assetsInclude: ['**/pandoc.wasm'],
  // mupdf-wasm и pandoc-wasm используют top-level await — нужен target es2022+
  // (иначе esbuild падает «Top-level await is not available»). Совр. браузеры ОК.
  build: {
    target: 'es2022',
  },
  // Workspace-пакеты не пребандлим — Vite компилирует их исходники напрямую.
  optimizeDeps: {
    exclude: ['@reader/core', '@reader/reader-engine', '@reader/ui'],
    esbuildOptions: { target: 'es2022' },
  },
  resolve: {
    dedupe: ['svelte'],
  },
  server: { port: 5173 },
});
