/**
 * Physical material presets. Densities are real-world values (kg/m^3); friction and
 * restitution are representative coefficients for the material against a hard floor.
 * Hardness (Mohs scale) and durability (relative impact resistance, 0..1) are shown in
 * the inspector now and drive the destruction system in Phase 4.
 */
export type MaterialId = "steel" | "wood" | "concrete" | "glass" | "rubber" | "plastic" | "ice" | "elastic";

export interface MaterialDef {
  id: MaterialId;
  name: string;
  /** kg/m^3 */
  density: number;
  friction: number;
  restitution: number;
  /** Mohs hardness. */
  hardness: number;
  /** Relative resistance to breaking on impact, 0 (fragile) .. 1 (very tough). */
  durability: number;
  /** Rendering only. */
  look: { color: [number, number, number]; metallic: number; roughness: number; alpha?: number };
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  steel: { id: "steel", name: "Steel", density: 7850, friction: 0.5, restitution: 0.55, hardness: 5, durability: 0.95, look: { color: [0.56, 0.58, 0.62], metallic: 1, roughness: 0.32 } },
  wood: { id: "wood", name: "Wood", density: 600, friction: 0.45, restitution: 0.4, hardness: 2, durability: 0.45, look: { color: [0.62, 0.42, 0.24], metallic: 0, roughness: 0.7 } },
  concrete: { id: "concrete", name: "Concrete", density: 2400, friction: 0.7, restitution: 0.2, hardness: 4, durability: 0.6, look: { color: [0.4, 0.4, 0.39], metallic: 0, roughness: 0.9 } },
  glass: { id: "glass", name: "Glass", density: 2500, friction: 0.35, restitution: 0.6, hardness: 5.5, durability: 0.1, look: { color: [0.62, 0.86, 0.95], metallic: 0, roughness: 0.05, alpha: 0.38 } },
  rubber: { id: "rubber", name: "Rubber", density: 1100, friction: 1.0, restitution: 0.8, hardness: 1, durability: 0.9, look: { color: [0.09, 0.09, 0.1], metallic: 0, roughness: 0.85 } },
  plastic: { id: "plastic", name: "Plastic", density: 1050, friction: 0.35, restitution: 0.5, hardness: 2.5, durability: 0.5, look: { color: [0.86, 0.5, 0.12], metallic: 0, roughness: 0.4 } },
  ice: { id: "ice", name: "Ice", density: 917, friction: 0.03, restitution: 0.2, hardness: 1.5, durability: 0.15, look: { color: [0.8, 0.92, 1.0], metallic: 0, roughness: 0.12, alpha: 0.72 } },
  elastic: { id: "elastic", name: "Elastic", density: 950, friction: 0.8, restitution: 0.95, hardness: 0.5, durability: 1, look: { color: [0.45, 0.3, 0.85], metallic: 0, roughness: 0.5 } },
};

export const MATERIAL_ORDER: readonly MaterialId[] = ["wood", "steel", "concrete", "glass", "rubber", "plastic", "ice", "elastic"];
export const DEFAULT_MATERIAL: MaterialId = "wood";
