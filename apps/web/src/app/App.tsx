import { ErrorBoundary } from "./ErrorBoundary";
import { AppShell } from "./AppShell";

export const App = () => (
  <ErrorBoundary>
    <AppShell />
  </ErrorBoundary>
);
