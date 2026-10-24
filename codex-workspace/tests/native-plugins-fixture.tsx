import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import NativePluginsPanel from '../client/components/native/NativePluginsPanel';
import '../client/styles.css';

function Fixture() {
  const [workspaceId, setWorkspaceId] = useState('workspace-one'), [changes, setChanges] = useState(0);
  const [threadId, setThreadId] = useState('01990000-0000-7000-8000-000000000001');
  return <main style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px 24px', height: 'calc(100dvh - 48px)', overflowY: 'auto' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}><button type="button" className="button" onClick={() => setWorkspaceId('workspace-two')}>Switch workspace</button><button type="button" className="button" onClick={() => setThreadId('01990000-0000-7000-8000-000000000002')}>Switch conversation</button><output data-changes={changes}>{changes} changes</output></div>
    <NativePluginsPanel workspaceId={workspaceId} threadId={threadId} onChanged={() => setChanges(value => value + 1)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
