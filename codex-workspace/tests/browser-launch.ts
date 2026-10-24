import type { LaunchOptions } from '@playwright/test';

// Test-only resource controls for hosts with little process/thread capacity.
// These flags do not replace browser contexts or change CSP, CORS, TLS,
// permissions, devices, or viewport settings. Normal launches stay unchanged.
const lowThreadArguments = [
  '--single-process',
  '--no-zygote',
  '--in-process-gpu',
  '--disable-gpu',
  '--num-raster-threads=1',
  '--renderer-process-limit=1',
  '--js-flags=--single-threaded',
  '--disable-software-rasterizer',
  '--use-gl=disabled',
  '--enable-features=CDPScreenshotNewSurface,NetworkServiceInProcess2',
] as const;

export function browserLaunchOptions(): LaunchOptions {
  if (process.env.CODEX_BROWSER_LOW_THREADS !== '1') return {};
  // Match the successful standalone browser proof's environment. App fixture
  // secrets, proxy settings and unrelated graphics overrides stay in Node.
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'LD_LIBRARY_PATH']
      .filter(name => process.env[name] !== undefined)
      .map(name => [name, process.env[name]!]),
  );
  return { args: [...lowThreadArguments], env };
}
