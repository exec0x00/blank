import type { Readable } from 'node:stream';

const QUEUED_RESPONSE_BYTES = 64 * 1024;

/** An owned, bounded bridge for one native HTTP(S) response. Node 22's
 * Readable.toWeb leaves its data listener live during cancellation; a queued
 * native resume can then enqueue into a closed Web controller. Detach native
 * delivery before destroy and guard already-dispatched listener snapshots.
 * Retain error handling through close so a late native AbortError is consumed.
 * Never remove another component's listeners from the underlying response. */
export function createNativeResponseBody(incoming: Readable): ReadableStream<Uint8Array> {
  let state: 'open' | 'ended' | 'failed' | 'cancelled' = 'open';
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stopDelivery = () => {
    incoming.pause();
    incoming.off('data', onData);
    incoming.off('end', onEnd);
    incoming.off('aborted', onAborted);
  };
  const cleanup = () => {
    stopDelivery();
    incoming.off('error', onError);
    incoming.off('close', onClose);
  };
  const fail = (error: Error) => {
    if (state !== 'open') return;
    state = 'failed';
    stopDelivery();
    controller.error(error);
    if (!incoming.destroyed) incoming.destroy();
    if (incoming.closed) cleanup();
  };
  function onData(chunk: unknown) {
    if (state !== 'open') return;
    if (!(chunk instanceof Uint8Array)) {
      fail(new Error('The native HTTP response delivered a non-byte chunk.')); return;
    }
    // Copy rather than retain a pooled Buffer after parsing this response.
    controller.enqueue(new Uint8Array(chunk));
    if (controller.desiredSize !== null && controller.desiredSize <= 0) incoming.pause();
  }
  function onEnd() {
    if (state !== 'open') return;
    state = 'ended';
    stopDelivery();
    controller.close();
    if (incoming.closed) cleanup();
  }
  function onError(error: Error) { fail(error); }
  function onAborted() { fail(new Error('The native HTTP response was aborted.')); }
  function onClose() {
    if (state === 'open') {
      state = 'failed';
      stopDelivery();
      controller.error(new Error('The native HTTP response closed before completing.'));
    }
    cleanup();
  }

  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      incoming.pause();
      incoming.on('data', onData);
      incoming.once('end', onEnd);
      incoming.on('error', onError);
      incoming.once('aborted', onAborted);
      incoming.once('close', onClose);
      if (incoming.readableEnded) onEnd();
      else if (incoming.destroyed || !incoming.readable) fail(new Error('The native HTTP response is unavailable.'));
    },
    pull() { if (state === 'open') incoming.resume(); },
    cancel() {
      // This state transition must precede destroy: native close/error events
      // and an already-queued data callback can run during its cleanup.
      if (state === 'open') state = 'cancelled';
      stopDelivery();
      if (!incoming.destroyed) incoming.destroy();
      if (incoming.closed) cleanup();
    },
  }, { highWaterMark: QUEUED_RESPONSE_BYTES, size: chunk => chunk.byteLength });
}
