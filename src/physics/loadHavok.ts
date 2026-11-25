import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

/** Browser loader: fetches the Havok WASM binary bundled by Vite. */
export async function loadHavok(): Promise<unknown> {
  return HavokPhysics({ locateFile: () => havokWasmUrl });
}
