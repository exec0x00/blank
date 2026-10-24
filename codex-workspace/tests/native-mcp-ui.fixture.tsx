import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import NativeMcpPanel from '../client/components/native/NativeMcpPanel';
import { NativeElicitationRequests } from '../client/components/native/NativeElicitationRequests';
import '../client/styles.css';

/** Isolated browser presentation fixture; it has no native runtime or model. */
function Fixture() {
  const [active, setActive] = useState(true);
  const [threadId, setThreadId] = useState('01990000-0000-7000-8000-000000000001');
  const requestsOnly = new URLSearchParams(window.location.search).get('view') === 'requests';
  return <form style={{ maxWidth: 800, margin: '0 auto', padding: 16 }} onSubmit={event => {
    event.preventDefault(); document.body.dataset.outerSubmits = String(Number(document.body.dataset.outerSubmits || 0) + 1);
  }}><button type="button" id="fixture-toggle" className="button" onClick={() => setActive(value => !value)}>Toggle MCP</button>
    {requestsOnly ? <><button type="button" className="button" onClick={() => setThreadId('01990000-0000-7000-8000-000000000002')}>Change conversation</button><NativeElicitationRequests workspaceId="owned-workspace" threadId={threadId} active={active} /></>
      : <NativeMcpPanel workspaceId="owned-workspace" threadId={threadId} active={active} />}
  </form>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
