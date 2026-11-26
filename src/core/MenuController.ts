import type { App } from "./App";
import { clearSlot, downloadExperiment, listSlots, readExperimentFile, readSlot, writeSlot } from "../persistence/Storage";

/** Connects the menu's buttons to the app: entering, environments, save slots, files and settings. */
export function wireMenu(app: App): void {
const menu = app.hud.menu;
  menu.onEnter = () => {
    app.sound.unlock();
    app.input.requestLock();
  };
  menu.onUiSound = () => {
    app.sound.unlock();
    app.sound.click();
  };
  menu.onShowGuide = () => app.hud.toggleGuide();
  menu.onEnvironment = (id) => {
    app.loadEnvironment(id);
    menu.setStatus("Environment loaded. Press Z in the lab to undo.");
  };
  menu.onSettings = (change) => app.updateSettings(change);
  menu.onResetHints = () => {
    app.updateSettings({ hintsDone: false });
    app.hud.onboarding.start();
  };
  menu.onSave = (slot) => {
    const ok = writeSlot(slot, app.captureExperiment());
    menu.setSlots(listSlots());
    menu.setStatus(ok ? `Saved to slot ${slot}.` : "Could not save: browser storage is unavailable or full.", !ok);
  };
  menu.onLoad = (slot) => {
    const result = app.loadExperiment(readSlot(slot));
    menu.setStatus(result.ok ? `${result.message} Press Z in the lab to undo.` : result.message, !result.ok);
  };
  menu.onDeleteSlot = (slot) => {
    clearSlot(slot);
    menu.setSlots(listSlots());
    menu.setStatus(`Slot ${slot} cleared.`);
  };
  menu.onExport = () => {
    downloadExperiment(app.captureExperiment());
    menu.setStatus("Experiment exported as a .json file.");
  };
  menu.onImport = (file) => {
    readExperimentFile(file)
      .then((raw) => {
        const result = app.loadExperiment(raw);
        menu.setStatus(result.message, !result.ok);
      })
      .catch((err: unknown) => menu.setStatus(err instanceof Error ? err.message : "Could not read that file.", true));
  };
  app.hud.onboarding.onFinished = () => app.updateSettings({ hintsDone: true });
  menu.setSlots(listSlots());
}
