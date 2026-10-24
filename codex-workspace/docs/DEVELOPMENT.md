# Development on the native app server

Run `npm run dev` from the source checkout on temporary local disk. `npm run dev:web` is an alias for the same command. Both set `CODEX_VITE_DEV=1` and start the Node application; open `/work` on its normal `PORT` (7860 by default). `/work/` also loads the workspace, while `/` always returns only the plain text `status: ok`. HTTP assets, authenticated API requests, terminal WebSockets and authenticated Vite HMR all use that listener. No requests are forwarded to a second local server.

Development serving is explicit. Without `CODEX_VITE_DEV=1`, the server continues to serve the built `dist/client` files. Production continues to use built files. Vite's React refresh preamble receives a fresh script nonce in the existing Content Security Policy; development does not enable arbitrary inline scripts.

The middleware allows the browser's `client`, `shared` and `public` files, installed dependencies, and its own disposable dependency cache under `RUNTIME_DIR/cache/vite`. It rejects traversal, double encoding, dotfiles, escaping symlinks, backend source, durable storage, arbitrary `/@fs` and `/@id` paths, and the editor-launch helper. It does not read project environment files. Neither source for development nor its cache may live under `/data` or `DATA_DIR`.

HMR uses `/__codex_dev_hmr` on the app listener, including reconnection. It requires the existing session and same-origin checks, closes on Lock, and accepts browser invalidation messages only. Vite's remote module-runner RPC is unavailable. When development mode is enabled, pass `{ devHmrPath: DEV_WEB_HMR_PATH }` as the terminal handler's authorization options. This reserves only the exact path with Vite's HMR or reconnect-ping protocol; ordinary terminal authentication and unknown-route rejection remain in place.

The helper's integration contract is `attachDevWeb(app, server, { rootDir?, runtimeDir, dataDir, authenticateUpgrade, events })`. Mount it after API authentication, API routes and the API 404 handler, replacing the built static handler only in development mode. Await the returned asynchronous close function before waiting for the HTTP server to finish shutting down.

`tests/dev-web.test.ts` covers actual source transformation, optimized dependency delivery, nonce generation, API authentication, filesystem denial, authenticated HMR updates, native terminal execution, blocked module-runner requests and logout. Run it through the coordinator's supervised validation slot when host resource admission permits.
