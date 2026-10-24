import { createServer, type ServerResponse } from 'node:http';
import { createSocket } from 'node:dgram';
import { setTimeout as delay } from 'node:timers/promises';

export interface NativeBrowserFixture {
  origin: string;
  count(name: string): number;
  hostHeaders(): string[];
  command(name: string): Promise<void>;
  waitFor(name: string, minimum?: number): Promise<void>;
  close(): Promise<void>;
}

/** An actual disposable website, never a mocked Browser/Page or model answer.
 * No server starts until the explicitly gated native test calls this factory. */
export async function createNativeBrowserFixture(targetOrigin = '', webTransportUrl = ''): Promise<NativeBrowserFixture> {
  const counts = new Map<string, number>();
  const hostHeaders = new Set<string>();
  const clients = new Set<ServerResponse>();
  const acks = new Set<number>();
  let commandId = 0;
  const hit = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  const server = createServer((req, res) => {
    if (hostHeaders.size < 16 && req.headers.host) hostHeaders.add(req.headers.host.slice(0, 300));
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ready\n\n'); clients.add(res);
      req.once('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/ack') { acks.add(Number(url.searchParams.get('id'))); res.writeHead(204).end(); return; }
    if (url.pathname.startsWith('/hit/')) { hit(url.pathname.slice(5)); res.writeHead(204).end(); return; }
    if (url.pathname === '/private') { hit('private'); res.end('PRIVATE_DESTINATION_REACHED'); return; }
    if (url.pathname === '/cors' || url.pathname === '/cors-allowed') {
      const allowed = url.pathname === '/cors-allowed', prefix = allowed ? 'allowed-cors-' : 'cors-';
      hit(prefix + (req.method === 'OPTIONS' ? 'options' : req.method === 'POST' ? 'post' : 'other'));
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Fixture-Request');
      }
      // Deliberately no Access-Control-Allow-* response. A native browser must
      // not send the cross-origin application/json POST after this denial.
      res.writeHead(req.method === 'OPTIONS' && !allowed ? 403 : 200, { 'Content-Type': 'text/plain' });
      res.end('CORS not allowed'); return;
    }
    if (url.pathname === '/redirect-private') { res.writeHead(302, { Location: `${targetOrigin}/private` }).end(); return; }
    if (url.pathname === '/worker.js' || url.pathname === '/nested-worker.js') {
      hit('worker-script'); res.setHeader('Content-Type', 'text/javascript');
      res.end(url.pathname === '/nested-worker.js' ? 'new Worker("/worker.js");'
        : `fetch(${JSON.stringify(`${targetOrigin}/private`)}).catch(() => {});`);
      return;
    }
    if (url.pathname !== '/') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Native browser fixture</title>
      <style>body{font:16px sans-serif;margin:20px;background:#fff;color:#111}h1{font-size:24px}button,input,select{font:14px sans-serif;margin:3px;padding:5px}#marker{width:60px;height:60px;background:#17a45c;border-radius:50%}#adversarial{display:flex;flex-wrap:wrap;gap:3px}#adversarial button{font-size:12px}#overlay{position:fixed;inset:0;background:rgba(0,0,0,.15);z-index:999;display:none}#long{height:20px;width:20px;background:#327bce;transition:width 60s linear}</style></head>
      <body><h1>Native browser fixture</h1><div id="marker"></div><p id="result">No clicks yet</p>
      <button id="count">Increment counter</button><input id="field" aria-label="Editable field"><button id="submit">Submit form</button>
      <label>Choice<select id="choice" aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select></label>
      <select id="private-choice" aria-label="Private payment choice" autocomplete="section-checkout cc-exp-month"><option value="private-option-a">Month A</option><option value="private-option-b">Month B</option></select>
      <input id="private" aria-label="Private code" autocomplete="section-signin one-time-code">
      <p id="echo"></p><canvas id="canvas" width="300" height="60"></canvas>
      <button id="cookie">Set fixture cookie</button><p id="cookie-state"></p>
      <button id="hostile">Attempt unapproved destinations</button><button id="cors">Attempt denied CORS write</button><button id="cors-allowed">Attempt allowed CORS write</button>
      <div id="adversarial"></div><button id="webtransport">Attempt unapproved WebTransport</button>
      <div id="long"></div><div id="overlay"></div><script>
      const target = ${JSON.stringify(targetOrigin)};
      const hit = name => fetch('/hit/' + name, {method:'POST'}).catch(() => {});
      let clicks = 0;
      document.getElementById('count').onclick = () => { clicks++; document.getElementById('result').textContent = 'Actual clicks: ' + clicks; hit('click'); };
      document.getElementById('submit').onclick = () => hit('submit');
      document.getElementById('field').oninput = () => hit('input');
      document.getElementById('choice').onchange = () => hit('select');
      document.getElementById('private-choice').onchange = event => { document.getElementById('echo').textContent = event.target.value; hit('private-select'); };
      document.getElementById('private').oninput = event => {
        const value = event.target.value; document.getElementById('echo').textContent = value; document.title = 'Fixture ' + value;
        console.warn('Private reflection', value); const canvas = document.getElementById('canvas');
        const draw = canvas.getContext('2d'); draw.clearRect(0,0,300,60); draw.font = '28px sans-serif'; draw.fillText(value,5,35);
      };
      const cookieState = () => document.getElementById('cookie-state').textContent = document.cookie.includes('fixture_probe=present') ? 'Fixture cookie present' : 'No fixture cookie';
      cookieState(); document.getElementById('cookie').onclick = () => { document.cookie = 'fixture_probe=present; SameSite=Strict; path=/'; cookieState(); };
      document.getElementById('cors').onclick = () => fetch(target + '/cors', {method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Request':'yes'},body:'{"fixture":true}'}).catch(() => {});
      document.getElementById('cors-allowed').onclick = () => fetch(target + '/cors-allowed', {method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Request':'yes'},body:'{"fixture":true}'}).catch(() => {});
      const attempts = {
        popup: () => window.open(target + '/private'),
        blank: () => { const popup = window.open('about:blank'); if (popup) popup.location = target + '/private'; },
        noopener: () => window.open(target + '/private', '_blank', 'noopener'),
        worker: () => new Worker('/worker.js'), nested: () => new Worker('/nested-worker.js'),
        frame: () => { const frame = document.createElement('iframe'); frame.src = target + '/private'; document.body.append(frame); },
        socket: () => new WebSocket(target.replace('http:', 'ws:') + '/private-ws'),
        'popup-socket': () => { const popup = window.open('about:blank'); if (popup) new popup.WebSocket(target.replace('http:', 'ws:') + '/private-ws'); },
        'socket-helper': () => { const socket = new WebSocket(target.replace('http:', 'ws:') + '/private-ws'); socket._apiPassThrough?.(); socket._apiConnect?.(); },
        fetch: () => fetch(target + '/private').catch(() => {}),
        image: () => { const image = new Image(); image.src = target + '/private'; document.body.append(image); },
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        const button = document.createElement('button'); button.textContent = 'Attempt ' + name;
        button.onclick = async () => { await hit('attempt-' + name); try { attempt(); } catch {} };
        document.getElementById('adversarial').append(button);
      }
      document.getElementById('webtransport').onclick = async () => {
        await hit('transport-attempt');
        if (!('WebTransport' in self)) { await hit('transport-absent'); return; }
        await hit('transport-present');
        try { const connection = new WebTransport(${JSON.stringify(webTransportUrl)}); connection.ready.catch(() => {}); connection.closed.catch(() => {}); } catch {}
      };
      document.getElementById('hostile').onclick = () => {
        try { window.open(target + '/private'); } catch {}
        try { const blank = window.open('about:blank'); if (blank) blank.location = target + '/private'; } catch {}
        try { window.open(target + '/private', '_blank', 'noopener'); } catch {}
        try { new Worker('/worker.js'); } catch {}
        try { new Worker('/nested-worker.js'); } catch {}
        try { const frame = document.createElement('iframe'); frame.src = target + '/private'; document.body.append(frame); } catch {}
        try { new WebSocket(target.replace('http:', 'ws:') + '/private-ws'); } catch {}
        try { const socket = new WebSocket(target.replace('http:', 'ws:') + '/private-ws'); socket._apiPassThrough?.(); socket._apiConnect?.(); } catch {}
        try { fetch(target + '/private').catch(() => {}); } catch {}
        try { const image = new Image(); image.src = target + '/private'; document.body.append(image); } catch {}
      };
      document.getElementById('long').ontransitionend = () => hit('transition-end');
      const events = new EventSource('/events');
      events.onmessage = async event => {
        const command = JSON.parse(event.data);
        if (command.name === 'overlay-on') document.getElementById('overlay').style.display = 'block';
        if (command.name === 'overlay-off') document.getElementById('overlay').style.display = 'none';
        if (command.name === 'relabel') document.getElementById('submit').textContent = 'Delete important fixture data';
        if (command.name === 'sensitive') { document.getElementById('field').type = 'password'; document.getElementById('field').autocomplete = 'section-account current-password'; }
        if (command.name === 'large-role') document.getElementById('count').setAttribute('role', 'x'.repeat(500000));
        if (command.name === 'animate') document.getElementById('long').style.width = '500px';
        if (command.name === 'reveal-private') { document.getElementById('private').type = 'text'; document.getElementById('private').removeAttribute('autocomplete'); }
        await fetch('/ack?id=' + command.id);
        if (command.name === 'reload') location.reload();
        if (command.name === 'close') window.close();
      };
      </script></body></html>`);
  });
  server.on('upgrade', (_req, socket) => { hit('websocket'); socket.destroy(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture HTTP listener did not start.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    count: name => counts.get(name) ?? 0,
    hostHeaders: () => [...hostHeaders],
    async command(name) {
      const until = Date.now() + 5000;
      while (!clients.size && Date.now() < until) await delay(10);
      if (!clients.size) throw new Error('The real fixture page did not connect its event stream.');
      const id = ++commandId;
      for (const client of clients) client.write(`data: ${JSON.stringify({ id, name })}\n\n`);
      while (!acks.has(id) && Date.now() < until) await delay(10);
      if (!acks.has(id)) throw new Error(`The real fixture page did not acknowledge ${name}.`);
    },
    async waitFor(name, minimum = 1) {
      const until = Date.now() + 5000;
      while ((counts.get(name) ?? 0) < minimum && Date.now() < until) await delay(10);
      if ((counts.get(name) ?? 0) < minimum) throw new Error(`The fixture counter ${name} did not reach ${minimum}.`);
    },
    async close() {
      for (const client of clients) client.end(); clients.clear(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

/** Counts real first UDP egress. No QUIC server, certificate, TLS bypass or
 * successful WebTransport handshake is needed to observe an unwanted packet. */
export async function createNativeUdpCounter(): Promise<{ url: string; count: () => number; close: () => Promise<void> }> {
  const socket = createSocket('udp4');
  let count = 0;
  socket.on('message', () => { count++; });
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => { socket.off('error', reject); resolve(); }); });
  const address = socket.address();
  return { url: `https://127.0.0.1:${address.port}/`, count: () => count,
    close: () => new Promise<void>(resolve => socket.close(() => resolve())) };
}
