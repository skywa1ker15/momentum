import type { LabEnvironment } from "./Environment";
import { TestChamber } from "./TestChamber";
import { GravityLab } from "./GravityLab";
import { DestructionArena } from "./DestructionArena";

export const ENVIRONMENTS: ReadonlyArray<{ id: string; name: string; create: () => LabEnvironment }> = [
  { id: "test-chamber", name: "Test Chamber 01", create: () => new TestChamber() },
  { id: "gravity-lab", name: "Gravity Laboratory", create: () => new GravityLab() },
  { id: "destruction-arena", name: "Destruction Arena", create: () => new DestructionArena() },
];
