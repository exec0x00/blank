import { createRoot } from 'react-dom/client';
import GithubPanel from '../../../client/components/GithubPanel';
import '../../../client/styles.css';
import '../../../client/scrollbars.css';

const root = createRoot(document.getElementById('root')!);
const events: Array<{ kind: string; value: unknown }> = [];
const signals: AbortSignal[] = [];
const browserFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  if (input === '/api/github/imports/recovery' && options?.signal) signals.push(options.signal);
  return browserFetch(input, options);
};

function mounted(show: boolean) {
  root.render(show ? <GithubPanel
    onImported={workspace => events.push({ kind: 'imported', value: workspace })}
    onNotify={value => events.push({ kind: 'notice', value })}
    onAccountsChanged={() => events.push({ kind: 'accounts', value: true })}
  /> : null);
}

Object.assign(window, {
  githubRecoveryFixture: {
    mounted,
    lock() { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); },
    unlock() { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); },
    state: () => ({ events, aborted: signals.map(signal => signal.aborted) }),
  },
});
mounted(true);
