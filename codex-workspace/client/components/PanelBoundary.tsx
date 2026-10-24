import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

export default class PanelBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`Could not open ${this.props.label}`, error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="panel-failure" role="alert"><span><CircleAlert size={24} /></span><h2>This panel needs a fresh start.</h2><p>Your other open panels are still available. Reload the workspace to try again.</p><button className="button" onClick={() => window.location.reload()}><RefreshCw size={14} />Reload workspace</button></div>;
  }
}
