import { config } from "./config";

export default function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>Fleet Health Dashboard</h1>
        <span className="mode-badge">
          {config.useMockData ? "Mock data" : `Live: ${config.apiBaseUrl}`}
        </span>
      </header>
      <p>Setup complete. Device list, KPIs, chart and history come next.</p>
    </main>
  );
}
