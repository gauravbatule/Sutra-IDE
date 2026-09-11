import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import http from 'http';

function workspaceAssetProxyPlugin(): Plugin {
  return {
    name: 'workspace-asset-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '';
        const url = rawUrl.split('?')[0];

        // Skip Vite internal paths, client code, and routes already proxied
        if (
          !url ||
          url === '/' ||
          url.startsWith('/src') ||
          url.startsWith('/@') ||
          url.startsWith('/node_modules') ||
          url.startsWith('/api') ||
          url.startsWith('/preview') ||
          url.startsWith('/workspace') ||
          url.startsWith('/ws') ||
          url.includes('vite.svg')
        ) {
          return next();
        }

        const referer = (req.headers['referer'] as string) || '';
        const isFromWorkspace = referer.includes('/workspace') || referer.includes('/preview');
        const isStaticAsset = /\.(css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp3|wav|ogg|mp4|webm|json)$/i.test(url);
        const isCommonAssetDir = /^\/(css|js|styles|assets|images|img|fonts|media)\//i.test(url);

        // If request originates from inside a workspace preview OR targets workspace static files:
        if (isFromWorkspace || (isStaticAsset && !url.startsWith('/@fs')) || isCommonAssetDir) {
          const proxyReq = http.request(
            {
              hostname: '127.0.0.1',
              port: 3001,
              path: req.url,
              method: req.method,
              headers: {
                ...req.headers,
                host: 'localhost:3001',
              },
            },
            (proxyRes) => {
              if (proxyRes.statusCode !== 404 || url.endsWith('.css')) {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(res);
                return;
              }
              next();
            }
          );
          proxyReq.on('error', () => {
            next();
          });
          req.pipe(proxyReq);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), workspaceAssetProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // Allow LAN access for multi-device preview and phone companion
    watch: {
      ignored: [
        '**/omnicraft.db*',
        '**/sutra.db*',
        '**/database.sqlite*',
        '**/.sutra/**',
        '**/.sandbox/**',
        '**/project-*/**',
        '**/workspace/**',
        '**/downloads/**',
        '**/dist/**',
        '**/dist-server/**',
        '**/dist-exe/**',
        '**/.git/**',
        '**/server/**',
        '**/scripts/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/preview': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/workspace': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'vendor-monaco';
          if (id.includes('@xterm')) return 'vendor-xterm';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/zustand/')
          ) {
            return 'vendor-react-core';
          }
          if (id.includes('node_modules/diff/')) return 'vendor-diff';
        },
      },
    },
  },
});
