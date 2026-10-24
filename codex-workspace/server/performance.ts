import { performance } from 'node:perf_hooks';
import type { OutgoingHttpHeaders, OutgoingHttpHeader } from 'node:http';
import type { RequestHandler, Response } from 'express';

type WriteHeadArguments = [statusCode: number, statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[], headers?: OutgoingHttpHeaders | OutgoingHttpHeader[]];

/**
 * Browser devtools can separate application work from transit time. The metric
 * ends when headers are sent, so an SSE connection never waits for the stream
 * to finish and no user paths, account names, or credentials enter the header.
 */
export const measureApiTime: RequestHandler = (_req, res, next) => {
  const started = performance.now();
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: WriteHeadArguments) {
    if (!this.headersSent) {
      const metric = `app;dur=${Math.max(0, performance.now() - started).toFixed(3)}`;
      let previous = this.getHeader('Server-Timing');
      const headerIndex = typeof args[1] === 'string' ? 2 : 1;
      const headers = args[headerIndex];
      // Explicit writeHead headers take precedence over setHeader in Node.
      // Preserve their metrics without allowing that precedence to erase ours.
      if (Array.isArray(headers)) {
        const retained: OutgoingHttpHeader[] = [];
        const metrics: string[] = [];
        for (let index = 0; index < headers.length; index += 2) {
          const name = headers[index];
          if (typeof name === 'string' && name.toLowerCase() === 'server-timing' && index + 1 < headers.length) metrics.push(String(headers[index + 1]));
          else retained.push(...headers.slice(index, index + 2));
        }
        if (metrics.length) { previous = metrics.join(', '); args[headerIndex] = retained; }
      } else if (headers && typeof headers === 'object') {
        const names = Object.keys(headers).filter(name => name.toLowerCase() === 'server-timing');
        if (names.length) {
          const retained = { ...headers };
          for (const name of names) { previous = retained[name]; delete retained[name]; }
          args[headerIndex] = retained;
        }
      }
      this.setHeader('Server-Timing', previous ? `${Array.isArray(previous) ? previous.join(', ') : previous}, ${metric}` : metric);
    }
    return Reflect.apply(writeHead, this, args) as Response;
  };
  next();
};
