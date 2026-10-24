import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import UploadProgress from '../../../client/components/UploadProgress';
import { isWorkspaceUploadActive, type WorkspaceUploadProgress } from '../../../client/uploads';
import { installScrollActivity } from '../../../client/scroll-activity';
import '../../../client/styles.css';
import '../../../client/scrollbars.css';

export interface UploadProgressFixture {
  replace(files: readonly WorkspaceUploadProgress[]): void;
  patch(id: string, patch: Partial<WorkspaceUploadProgress>): void;
  setVisible(visible: boolean): void;
  state(): {
    total: number;
    immutable: boolean;
    cancelled: number;
    ready: number;
    cancelEvents: Array<{ batch: string; total: number; active: number }>;
    dismissEvents: number;
  };
}
type FixtureWindow = Window & {
  uploadProgressInitialFiles?: readonly WorkspaceUploadProgress[];
  uploadProgressFixture?: UploadProgressFixture;
};
const fixtureWindow = window as FixtureWindow;
const immutable = (files: readonly WorkspaceUploadProgress[]) => Object.freeze(files.map(file => Object.freeze({ ...file })));

// The fixture controls transfer events explicitly. The production component
// receives immutable progress records and never generates a successful transfer.
function Harness() {
  const [files, setFiles] = useState(() => immutable(fixtureWindow.uploadProgressInitialFiles ?? []));
  const [visible, setVisible] = useState(true);
  const latest = useRef(files);
  latest.current = files;
  const cancelEvents = useRef<Array<{ batch: string; total: number; active: number }>>([]);
  const dismissEvents = useRef(0);
  useEffect(() => installScrollActivity(), []);
  useLayoutEffect(() => {
    const controls: UploadProgressFixture = {
      replace: next => setFiles(immutable(next)),
      patch: (id, patch) => setFiles(previous => immutable(previous.map(file => file.id === id ? { ...file, ...patch } : file))),
      setVisible,
      state: () => ({ total: latest.current.length, immutable: Object.isFrozen(latest.current) && latest.current.every(Object.isFrozen),
        cancelled: latest.current.filter(file => file.stage === 'cancelled').length,
        ready: latest.current.filter(file => file.stage === 'ready').length,
        cancelEvents: [...cancelEvents.current], dismissEvents: dismissEvents.current }),
    };
    fixtureWindow.uploadProgressFixture = controls;
    return () => { if (fixtureWindow.uploadProgressFixture === controls) delete fixtureWindow.uploadProgressFixture; };
  }, []);
  return <main className="upload-window-fixture">
    <p>Upload progress browser fixture</p>
    <div hidden={!visible}><UploadProgress files={files} onCancel={() => {
      cancelEvents.current.push({ batch: files[0]?.id ?? '', total: files.length, active: files.filter(isWorkspaceUploadActive).length });
    }} onDismiss={() => { dismissEvents.current++; setFiles(immutable([])); }} /></div>
    <button className="fixture-focus-target">Fixture focus target</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
