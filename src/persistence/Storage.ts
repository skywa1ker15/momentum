import type { ExperimentData } from "./Experiment";

export const SLOT_COUNT = 3;
const slotKey = (slot: number) => `momentum.save.${slot}`;

export interface SlotInfo {
  slot: number;
  /** Null when the slot is empty or unreadable. */
  summary: { environment: string; objects: number; joints: number; savedAt: string } | null;
}

/** Writes an experiment to a browser-storage slot. Returns false when storage is unavailable or full. */
export function writeSlot(slot: number, data: ExperimentData): boolean {
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Raw parsed contents of a slot (unvalidated), or null. */
export function readSlot(slot: number): unknown {
  try {
    const text = localStorage.getItem(slotKey(slot));
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function clearSlot(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
  } catch {
    /* nothing to clear */
  }
}

export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const raw = readSlot(slot) as Partial<ExperimentData> | null;
    out.push({
      slot,
      summary:
        raw && typeof raw.environment === "string" && Array.isArray(raw.objects)
          ? { environment: raw.environment, objects: raw.objects.length, joints: Array.isArray(raw.joints) ? raw.joints.length : 0, savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "" }
          : null,
    });
  }
  return out;
}

/** Offers the experiment as a .json download. */
export function downloadExperiment(data: ExperimentData): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `momentum-${data.environment}-${data.savedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads and parses a file the user picked. Rejects with a readable message. */
export async function readExperimentFile(file: File): Promise<unknown> {
  if (file.size > 5_000_000) throw new Error("That file is too large to be a MOMENTUM experiment.");
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
}
