import { CONFIG } from "./config";
import { TOOLS, type App } from "./App";
import { PRIMITIVE_KINDS } from "../objects/ObjectFactory";

/** Maps this frame's key and mouse input to actions. Called only while the pointer is locked (play mode). */
export function handleControls(app: App): void {
const input = app.input;
  const eye = app.player.eyePosition;
  const dir = app.player.viewDirection;

  PRIMITIVE_KINDS.forEach((kind, i) => {
    if (input.wasPressed(`Digit${i + 1}`)) app.selectKind(kind);
  });
  if (input.wasPressed("KeyF") && app.spawnSelected()) app.hud.onboarding.complete("spawn");
  if (input.wasPressed("KeyQ")) {
    const step = input.isDown("ShiftLeft") || input.isDown("ShiftRight") ? TOOLS.length - 1 : 1;
    app.setTool(TOOLS[(TOOLS.indexOf(app.tool) + step) % TOOLS.length]);
    app.sound.click(660);
    app.hud.onboarding.complete("tool");
  }
  if (input.wasPressed("KeyM")) app.cycleMaterial(1);
  if (input.wasPressed("KeyN")) app.cycleMaterial(-1);
  if (input.wasPressed("F4")) app.nextEnvironment();
  if (input.wasPressed("KeyB")) app.setDestructionLevel((app.destruction.level + 1) % CONFIG.destruction.levels.length);
  if (app.tool === "blast") {
    if (input.wasPressed("Mouse0")) app.detonateAimed();
    if (input.wheel !== 0) app.explosions.adjustLevel(-input.wheel);
  } else if (app.tool === "field") {
    if (input.wasPressed("Mouse0") && !app.fieldTool.place(eye, dir)) app.hud.toast(app.fieldTool.kind === "water" ? `Water volume limit reached (${CONFIG.water.maxVolumes})` : `Field limit reached (${CONFIG.fields.maxFields})`);
    if (input.wasPressed("Mouse2")) app.fieldTool.removeAimed(eye, dir);
    if (input.wheel !== 0) app.fieldTool.cycleKind(input.wheel);
    if (input.wasPressed("KeyV")) app.fieldTool.cycleStrength();
  } else if (app.tool === "link") {
    if (input.wasPressed("Mouse0")) {
      const r = app.linkTool.click(eye, dir);
      if (r.status === "joined") app.hud.toast(`${r.joint.kind} joint created`);
      else if (r.status === "limit") app.hud.toast("Could not create joint");
      else if (r.status === "none") app.hud.toast("Aim at an object first");
    }
    if (input.wasPressed("Mouse2")) {
      const n = app.linkTool.removeAimed(eye, dir);
      if (n > 0) app.hud.toast(`Removed ${n} joint${n === 1 ? "" : "s"}`);
    }
    if (input.wheel !== 0) app.linkTool.cycleKind(input.wheel);
  } else if (app.tool === "hand") {
    if (input.wasPressed("Mouse0") && app.grab.tryGrab(eye, dir)) app.hud.onboarding.complete("grab");
    if (input.wasReleased("Mouse0")) app.grab.release();
    if (input.wasPressed("Mouse2")) app.grab.throwOrPush(eye, dir);
    if (input.wheel !== 0 && app.grab.held) app.grab.adjustDistance(input.wheel);
  } else {
    if (input.wasPressed("Mouse0")) app.force.begin(eye, dir);
    if (input.wasReleased("Mouse0")) app.force.end();
    if (input.wasPressed("Mouse2")) app.force.strike(eye, dir);
    if (input.wheel !== 0) app.force.adjustLevel(-input.wheel);
    if (input.wasPressed("KeyV")) app.force.toggleMode();
  }
  if (input.wasPressed("KeyE")) {
    app.selectTarget();
    if (app.selection.current) app.hud.onboarding.complete("select");
  }
  if (input.wasPressed("KeyC")) app.duplicateSelected();
  if (input.wasPressed("KeyX") || input.wasPressed("Delete")) app.deleteTarget();
  if (input.wasPressed("KeyP")) app.togglePause();
  if (input.wasPressed("BracketLeft")) app.stepTimeScale(-1);
  if (input.wasPressed("BracketRight")) app.stepTimeScale(1);
  if (input.wasPressed("KeyR")) app.resetExperiment();
  if (input.wasPressed("KeyZ")) app.undo();
  if (input.wasPressed("KeyU")) app.hud.toggleHidden();
  if (input.wasPressed("F2")) app.cycleQuality();
  if (input.wasPressed("F9")) app.runBenchmark();
}
