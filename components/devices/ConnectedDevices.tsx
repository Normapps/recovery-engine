"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Check, Link2, Link2Off, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useStore } from "@/lib/store";
import type { DeviceProvider, DeviceConnection, DeviceDataType } from "@/lib/types";
import {
  PROVIDER_DATA_TYPES,
  fetchDeviceConnections,
  disconnectDevice,
} from "@/lib/api/deviceConnections";
import { resolveCurrentUserId } from "@/lib/api/uploadAvatar";

// ─── Device catalogue ─────────────────────────────────────────────────────────

interface DeviceDef {
  provider: DeviceProvider;
  name:     string;
  color:    string;
  initials: string;
}

const WEARABLES: DeviceDef[] = [
  { provider: "whoop",       name: "WHOOP",       color: "#00D4AA", initials: "W"  },
  { provider: "garmin",      name: "Garmin",      color: "#007CC2", initials: "G"  },
  { provider: "apple_watch", name: "Apple Watch", color: "#3A3A3C", initials: "AW" },
  { provider: "fitbit",      name: "Fitbit",      color: "#4CC2C4", initials: "Fb" },
  { provider: "oura",        name: "Oura Ring",   color: "#B09070", initials: "O"  },
];

const HEALTH_PLATFORMS: DeviceDef[] = [
  { provider: "apple_health", name: "Apple Health", color: "#FF2D55", initials: "AH" },
  { provider: "google_fit",   name: "Google Fit",   color: "#4285F4", initials: "GF" },
];

const TRAINING_APPS: DeviceDef[] = [
  { provider: "strava",         name: "Strava",        color: "#FC4C02", initials: "St" },
  { provider: "training_peaks", name: "TrainingPeaks", color: "#3AAFA9", initials: "TP" },
  { provider: "nike_run_club",  name: "Nike Run Club", color: "#111111", initials: "NR" },
];

const NUTRITION_APPS: DeviceDef[] = [
  { provider: "myfitnesspal", name: "MyFitnessPal", color: "#00B3FF", initials: "MF" },
  { provider: "cronometer",   name: "Cronometer",   color: "#4CAF50", initials: "Cr" },
];

// ─── Data-type pill colours ───────────────────────────────────────────────────

const DT_COLOR: Record<DeviceDataType, string> = {
  Sleep:           "bg-violet-500/20 text-violet-300",
  HRV:             "bg-pink-500/20 text-pink-300",
  "Heart Rate":    "bg-red-500/20 text-red-300",
  "Training Load": "bg-amber-500/20 text-amber-300",
  Nutrition:       "bg-emerald-500/20 text-emerald-300",
  Steps:           "bg-indigo-500/20 text-indigo-300",
};

// ─── Single device card ───────────────────────────────────────────────────────

function DeviceCard({ def }: { def: DeviceDef }) {
  const connections         = useStore((s) => s.deviceConnections);
  const setDeviceConnection = useStore((s) => s.setDeviceConnection);
  const removeDeviceConn    = useStore((s) => s.removeDeviceConnection);

  const stored      = connections[def.provider] as DeviceConnection | undefined;
  const isConnected = stored?.isConnected ?? false;
  const lastSync    = stored?.lastSync ?? null;
  const dataTypes   = PROVIDER_DATA_TYPES[def.provider];

  type BtnState = "idle" | "connecting" | "syncing" | "done" | "error";
  const [btnState, setBtnState] = useState<BtnState>("idle");

  // ── Connect ──────────────────────────────────────────────────────────────
  // Redirects to /api/oauth/[provider] which handles OAuth or mock connect.
  // On return, the page URL will contain ?synced=[provider] — handled in parent.
  const handleConnect = useCallback(async () => {
    setBtnState("connecting");
    const userId = await resolveCurrentUserId();
    const params = new URLSearchParams({ returnUrl: "/log" });
    if (userId) params.set("user_id", userId);
    window.location.href = `/api/oauth/${def.provider}?${params.toString()}`;
  }, [def.provider]);

  // ── Sync ─────────────────────────────────────────────────────────────────
  // Calls POST /api/sync/[provider] → updates daily_entries → recalculates score.
  // Falls back to optimistic local update when Supabase not configured.
  const handleSync = useCallback(async () => {
    setBtnState("syncing");
    const now    = new Date().toISOString();
    const userId = await resolveCurrentUserId();

    // Optimistic UI update
    setDeviceConnection({ provider: def.provider, isConnected: true, lastSync: now, dataTypes });

    try {
      if (userId) {
        const resp = await fetch(`/api/sync/${def.provider}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ user_id: userId }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Sync failed (${resp.status})`);
        }
        // Update lastSync from response
        const data = await resp.json() as { date?: string };
        setDeviceConnection({
          provider:    def.provider,
          isConnected: true,
          lastSync:    data.date ? new Date(data.date).toISOString() : now,
          dataTypes,
        });
      }
      setBtnState("done");
    } catch (err) {
      console.error(`[ConnectedDevices] sync failed for ${def.provider}:`, err);
      setBtnState("error");
    } finally {
      setTimeout(() => setBtnState("idle"), 2000);
    }
  }, [def.provider, dataTypes, setDeviceConnection]);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    removeDeviceConn(def.provider);
    await disconnectDevice(def.provider);
  }, [def.provider, removeDeviceConn]);

  return (
    <div
      className={`flex flex-col gap-3 p-4 rounded-2xl border transition-colors ${
        isConnected ? "bg-bg-card border-[#2a3a2e]" : "bg-bg-elevated border-bg-border"
      }`}
    >
      {/* Icon + name */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs text-white"
          style={{ backgroundColor: def.color }}
        >
          {def.initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary leading-tight truncate">{def.name}</p>
          <p className={`text-[10px] font-medium uppercase tracking-wide mt-0.5 ${
            isConnected ? "text-emerald-400" : "text-text-muted"
          }`}>
            {isConnected ? "Connected" : "Not Connected"}
          </p>
        </div>
      </div>

      {/* Data type pills */}
      {isConnected && (
        <div className="flex flex-wrap gap-1">
          {dataTypes.map((dt) => (
            <span key={dt} className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${DT_COLOR[dt]}`}>
              {dt}
            </span>
          ))}
        </div>
      )}

      {/* Last sync time */}
      {isConnected && lastSync && (
        <p className="text-[10px] text-text-muted">
          Synced {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
        </p>
      )}

      {/* Action buttons */}
      {!isConnected ? (
        <button
          onClick={handleConnect}
          disabled={btnState === "connecting"}
          className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-gold text-bg-primary hover:bg-gold-light active:scale-98 transition-all disabled:opacity-60"
        >
          <span className="flex items-center justify-center gap-1.5">
            {btnState === "connecting"
              ? <><RefreshCw size={11} className="animate-spin" /> Connecting…</>
              : <><Link2 size={11} /> Connect</>
            }
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={handleSync}
            disabled={btnState !== "idle"}
            className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-wider border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-60"
          >
            <span className="flex items-center justify-center gap-1.5">
              {btnState === "syncing" ? <><RefreshCw size={11} className="animate-spin" /> Syncing…</>
               : btnState === "done"  ? <><Check size={11} /> Synced</>
               : btnState === "error" ? <span className="text-red-400">Sync failed</span>
               : <><RefreshCw size={11} /> Sync</>}
            </span>
          </button>
          <button
            onClick={handleDisconnect}
            className="w-full py-1 text-[10px] text-text-muted hover:text-red-400 transition-colors flex items-center justify-center gap-1"
          >
            <Link2Off size={9} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Category section (collapsible) ──────────────────────────────────────────

function CategorySection({ title, devices }: { title: string; devices: DeviceDef[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{title}</span>
        {open ? <ChevronUp size={13} className="text-text-muted" /> : <ChevronDown size={13} className="text-text-muted" />}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3">
          {devices.map((d) => <DeviceCard key={d.provider} def={d} />)}
        </div>
      )}
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function ConnectedDevices() {
  const connections         = useStore((s) => s.deviceConnections);
  const setDeviceConnection = useStore((s) => s.setDeviceConnection);
  const searchParams        = useSearchParams();

  // Handle post-OAuth redirect: ?synced=provider marks that provider as connected
  useEffect(() => {
    const synced = searchParams.get("synced") as DeviceProvider | null;
    if (synced && PROVIDER_DATA_TYPES[synced]) {
      setDeviceConnection({
        provider:    synced,
        isConnected: true,
        lastSync:    new Date().toISOString(),
        dataTypes:   PROVIDER_DATA_TYPES[synced],
      });
      // Clean up the query param without adding a history entry
      const url = new URL(window.location.href);
      url.searchParams.delete("synced");
      window.history.replaceState(null, "", url.toString());
    }
  }, [searchParams, setDeviceConnection]);

  // Hydrate from Supabase on mount (best-effort)
  useEffect(() => {
    fetchDeviceConnections().then((rows) => {
      rows.forEach((conn) => {
        const local = connections[conn.provider] as DeviceConnection | undefined;
        if (!local || conn.isConnected !== local.isConnected || conn.lastSync !== local.lastSync) {
          setDeviceConnection(conn);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedCount = Object.values(connections).filter(
    (c) => (c as DeviceConnection).isConnected,
  ).length;

  return (
    <section className="bg-bg-card border border-bg-border rounded-2xl p-5 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">
            Connected Devices & Apps
          </h2>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
            Automatically import your health and training data
          </p>
        </div>
        {connectedCount > 0 && (
          <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            {connectedCount} active
          </span>
        )}
      </div>

      {/* Wearables — always expanded */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Wearables</span>
        <div className="grid grid-cols-2 gap-3">
          {WEARABLES.map((d) => <DeviceCard key={d.provider} def={d} />)}
        </div>
      </div>

      <div className="border-t border-bg-border" />

      {/* Other categories — collapsible */}
      <div className="flex flex-col gap-4">
        <CategorySection title="Health Platforms" devices={HEALTH_PLATFORMS} />
        <CategorySection title="Training Apps"    devices={TRAINING_APPS} />
        <CategorySection title="Nutrition"        devices={NUTRITION_APPS} />
      </div>
    </section>
  );
}
