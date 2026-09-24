import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface BackendInfo {
  version: string;
  backend: string;
  /** Betriebssystem des Backends ("windows", "android", …). */
  platform?: string;
  /** "play-store", "sideload" oder "desktop". */
  distribution?: string;
}

export interface EngineInfo {
  available: boolean;
  name: string;
  path: string;
}

export type BackendState = { mode: "desktop" | "web" | "pending"; info?: BackendInfo };

// Die Erkennung gilt für die gesamte App. Ein Modul-Snapshot verhindert, dass
// jede neu geöffnete Seite erneut bei "pending" beginnt und app_info aufruft.
let backendState: BackendState = { mode: "pending" };
let backendRequest: Promise<void> | null = null;
const backendListeners = new Set<(state: BackendState) => void>();

function detectBackend() {
  if (backendRequest) return;
  backendRequest = invoke<BackendInfo>("app_info")
    .then((info) => {
      backendState = { mode: "desktop", info };
    })
    .catch(() => {
      backendState = { mode: "web" };
    })
    .then(() => {
      backendListeners.forEach((listener) => listener(backendState));
    });
}

/** Erkennt, ob die App in der Tauri-Shell (Desktop/Mobile) oder im Browser läuft. */
export function useBackendInfo(): BackendState {
  const [state, setState] = useState<BackendState>(() => backendState);

  useEffect(() => {
    backendListeners.add(setState);
    // Zwischen Render und Effect kann ein anderer Consumer fertig geworden
    // sein. Den aktuellen Snapshot deshalb unmittelbar übernehmen.
    setState(backendState);
    detectBackend();
    return () => {
      backendListeners.delete(setState);
    };
  }, []);

  return state;
}

/** Fragt die gebündelte Stockfish-Engine ab (nur Desktop). */
export function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}

/** Die mitgelieferte Engine · auch wenn für die Analyse eine andere eingestellt ist. */
export function bundledEngineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("bundled_engine_info");
}
