import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error?: Error;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Web V2 boundary captured an error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-fallback" role="alert">
          <h1>Something went wrong</h1>
          <p>The web client hit a rendering error. Runtime contracts were not changed.</p>
          <pre>{this.state.error.message}</pre>
        </main>
      );
    }

    return this.props.children;
  }
}
