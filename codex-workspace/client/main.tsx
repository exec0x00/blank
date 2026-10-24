import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Logo from './components/Logo';
import { installScrollActivity } from './scroll-activity';
import { installInputMotion } from './input-motion';
import { installTooltips } from './tooltips';
import { applyDarkTheme } from './theme';
import './styles.css';
import './scrollbars.css';
import './input-motion.css';
import './tooltips.css';

applyDarkTheme();
const disposeScrollActivity = installScrollActivity();
if (import.meta.hot) import.meta.hot.dispose(disposeScrollActivity);
const disposeInputMotion = installInputMotion();
if (import.meta.hot) import.meta.hot.dispose(disposeInputMotion);
const disposeTooltips = installTooltips();
if (import.meta.hot) import.meta.hot.dispose(disposeTooltips);

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Workspace interface error', error, info.componentStack); }
  render() {
    if (this.state.failed) return <main className="loading-screen"><Logo size={40} /><h1>The interface needs a fresh start.</h1><p>Your saved workspace files are still on the server.</p><button className="button primary" onClick={() => window.location.reload()}>Reload workspace</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
