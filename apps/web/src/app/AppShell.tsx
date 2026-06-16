import { useEffect, useState } from "react";
import { normalizeRoute, routes, type AppRoute } from "./routes";

export const AppShell = () => {
  const [route, setRoute] = useState<AppRoute>(() => normalizeRoute(window.location.pathname));

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/rp");
    }
    const onPopState = () => setRoute(normalizeRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    if (nextRoute === route) return;
    window.history.pushState(null, "", nextRoute);
    setRoute(nextRoute);
  };

  const active = routes.find((item) => item.path === route) ?? routes[0]!;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <strong>Agent Workflow Platform</strong>
          <span>Web V2</span>
        </div>
        <nav className="top-nav" aria-label="Primary">
          {routes.map((item) => (
            <button
              key={item.path}
              type="button"
              className={item.path === route ? "active" : ""}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="route-surface">{active.element}</div>
    </div>
  );
};
