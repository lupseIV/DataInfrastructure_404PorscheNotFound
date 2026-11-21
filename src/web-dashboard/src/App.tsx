import { useState } from "react";
import { TopBar } from "./components/TopBar";
import { config } from "./config";
import { useNow } from "./hooks/useNow";

export default function App() {
  const now = useNow();
  const [, setSidebarOpen] = useState(false);

  return (
    <div className="h-full w-full flex flex-col">
      <TopBar
        onlineCount={0}
        lastUpdatedAt={null}
        now={now}
        isMock={config.useMockData}
        hasError={false}
        onRefresh={() => {}}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />

      <div className="flex-1 min-h-0 w-full flex relative overflow-hidden">
        <aside className="hidden lg:flex w-[240px] h-full border-r border-line/70 bg-surface-panel shrink-0" />
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden bg-map">
          <section className="h-14 px-3 py-2 border-b border-line/70 bg-surface/90 shrink-0" />
          <div className="flex-1 relative" />
        </main>
      </div>
    </div>
  );
}
