import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bean, Users, MapPin, Wrench } from "lucide-react";
import HomePage from "./HomePage";
import RoastersPage from "./RoastersPage";

const TABS = [
  { key: "beans", label: "Beans", icon: Bean },
  { key: "roasters", label: "Roasters", icon: Users },
  // Future tabs:
  // { key: "apparatus", label: "Apparatus", icon: Wrench },
  // { key: "spots", label: "Coffee Spots", icon: MapPin },
];

export default function BrowsePage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "beans");

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-card-front)" }}>
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 flex items-center gap-1">
          {TABS.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium cursor-pointer transition-colors"
                style={{
                  color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}

          {/* Greyed-out future tabs */}
          <span className="flex items-center gap-1.5 px-4 py-2.5 text-sm opacity-30 cursor-not-allowed">
            <Wrench size={15} /> Apparatus
          </span>
          <span className="flex items-center gap-1.5 px-4 py-2.5 text-sm opacity-30 cursor-not-allowed">
            <MapPin size={15} /> Coffee Spots
          </span>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "beans" && <HomePage />}
      {activeTab === "roasters" && <RoastersPage />}
    </div>
  );
}
