import type { LabEnvironment } from "./Environment";
import { TestChamber } from "./TestChamber";
import { GravityLab } from "./GravityLab";
import { DestructionArena } from "./DestructionArena";
import { ConstructionZone } from "./ConstructionZone";

export interface EnvironmentEntry {
  id: string;
  name: string;
  description: string;
  create: () => LabEnvironment;
}

export const ENVIRONMENTS: readonly EnvironmentEntry[] = [
  { id: "test-chamber", name: "Test Chamber 01", description: "General-purpose chamber: incline, crate pyramid, water tank and a soft spring lattice.", create: () => new TestChamber() },
  { id: "gravity-lab", name: "Gravity Laboratory", description: "A central emitter that lifts nearby objects and a column of upward gravity.", create: () => new GravityLab() },
  { id: "destruction-arena", name: "Destruction Arena", description: "A bonded brick wall, glass panes and a wrecking ball released as you arrive.", create: () => new DestructionArena() },
  { id: "construction-zone", name: "Construction Zone", description: "Working machines to study and a depot of beams, planks and wheels to build with.", create: () => new ConstructionZone() },
];
