import { useEffect, useState } from "react";
import { getDevices } from "./api";
import { config } from "./config";
import type { Device } from "./types";

export default function App() {
  // Temporary one-time load to check the data layer; polling and the real
  // components replace this in the next steps.
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getDevices(controller.signal)
      .then(setDevices)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>Fleet Health Dashboard</h1>
        <span className="mode-badge">
          {config.useMockData ? "Mock data" : `Live: ${config.apiBaseUrl}`}
        </span>
      </header>

      {error && <p>Error: {error}</p>}
      {!error && !devices && <p>Loading…</p>}
      {devices && (
        <ul>
          {devices.map((d) => (
            <li key={d.deviceId}>
              {d.deviceId}: {d.batteryLevel}% · {d.alertStatus}
              {d.alertReason ? ` (${d.alertReason})` : ""} · last update {d.lastUpdated}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
