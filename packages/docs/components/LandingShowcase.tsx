import React, { useState } from "react";
import { Landing } from "./Landing";
import { LandingV1 } from "./LandingV1";
import { LandingV2 } from "./LandingV2";
import { LandingV3 } from "./LandingV3";
import { LandingV4 } from "./LandingV4";
import { LandingV5 } from "./LandingV5";

const VARIANTS = [
  { id: "current", label: "Current", component: Landing },
  { id: "cathode", label: "Cathode", component: LandingV1 },
  { id: "broadsheet", label: "Broadsheet", component: LandingV2 },
  { id: "prism", label: "Prism", component: LandingV3 },
  { id: "blueprint", label: "Blueprint", component: LandingV4 },
  { id: "noir", label: "Noir", component: LandingV5 },
] as const;

export function LandingShowcase() {
  const [active, setActive] = useState("current");
  const ActiveComponent =
    VARIANTS.find((v) => v.id === active)?.component ?? Landing;

  return (
    <div className="relative">
      {/* floating variant picker — fixed bottom center */}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 6px",
          borderRadius: 100,
          background: "rgba(10,10,14,0.92)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: active === v.id ? 600 : 400,
              fontFamily: "system-ui, -apple-system, sans-serif",
              borderRadius: 100,
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
              background:
                active === v.id ? "rgba(255,255,255,0.15)" : "transparent",
              color: active === v.id ? "#fff" : "#666",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}
