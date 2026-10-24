import { createRoot } from 'react-dom/client';
import NativeProcessesPanel from '../client/components/native/NativeProcessesPanel';
import Modal from '../client/components/Modal';
import '../client/styles.css';

const root = createRoot(document.getElementById('root')!);
let workspaceId = 'one', threadId: string | undefined = '01990000-0000-7000-8000-000000000001', visible = true, active = true;
const changed: string[] = [], signals: AbortSignal[] = [];
const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  if (String(input).includes('/native/') && options?.signal) signals.push(options.signal);
  return originalFetch(input, options);
};
function render() {
  root.render(<Modal open={visible} title="Tasks" titleId="fixture-task-title" onClose={() => { visible = false; render(); }}>
    <div className="fixture-native-task-body" style={{ display: active ? undefined : 'none' }}><NativeProcessesPanel active={active} workspaceId={workspaceId} threadId={threadId} onChanged={() => changed.push(workspaceId)} /></div>
  </Modal>);
}
Object.assign(window, { nativeTasksFixture: {
  scope(workspace: string, thread?: string) { workspaceId = workspace; threadId = thread; render(); },
  active(value: boolean) { active = value; render(); },
  lock() { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); },
  unlock() { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); },
  state: () => ({ changed, aborted: signals.map(signal => signal.aborted) }),
} });
render();
