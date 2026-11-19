import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; resetKey?: string; fullScreen?: boolean }
interface State { error: Error | null }

/** Shows a readable error card instead of a blank screen when a page crashes. Resets on navigation. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SquadSync] page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunkError = /Loading chunk|dynamically imported module|Failed to fetch/i.test(this.state.error.message);
    return (
      <div className={this.props.fullScreen ? 'grid min-h-screen place-items-center p-4' : 'py-10'}>
        <div className="glass mx-auto max-w-md p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-ember-400" aria-hidden />
          <h2 className="mt-3 text-2xl font-bold text-white">{chunkError ? 'App was updated' : 'Something broke on this page'}</h2>
          <p className="mt-2 text-sm text-zinc-400">
            {chunkError ? 'A newer version is available. Reload to get it.' : 'The rest of the app still works. Try reloading, or go back home.'}
          </p>
          {!chunkError && <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-black/40 p-2 text-left text-xs text-red-300">{this.state.error.message}</pre>}
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}><RotateCcw className="h-4 w-4" aria-hidden />Reload</button>
            <a href="/" className="btn-ghost">Home</a>
          </div>
        </div>
      </div>
    );
  }
}
