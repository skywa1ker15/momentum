// End-to-end smoke test: drives the production build in headless Chrome with real input.
// Usage: npm run build && npx vite preview --port 4173 &   then   npm run e2e
// Env: CHROME_PATH (default /usr/bin/google-chrome), E2E_URL (default http://localhost:4173/?debug)
import puppeteer from "puppeteer-core";

const url = process.env.E2E_URL ?? "http://localhost:4173/?debug";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const problems = [];
const consoleErrors = [];
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("GPU stall")) consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) problems.push(name);
};
const app = (fn, ...args) => page.evaluate(fn, ...args);
const key = async (k, ms = 400) => {
  await page.keyboard.press(k);
  await sleep(ms);
};
const stepSim = (n) => app((n) => { const a = window.__momentum; for (let i = 0; i < n; i++) a.world.step(1 / 60); }, n);
const menuTab = async (label) => {
  for (const h of await page.$$(".menu-tab")) if ((await h.evaluate((e) => e.textContent)) === label) await h.click();
  await sleep(350);
};
const menuButton = async (label, nth = 0) => {
  let k = 0;
  for (const h of await page.$$(".menu-panel.active .chip-button")) {
    if ((await h.evaluate((e) => e.textContent)) === label && k++ === nth) {
      await h.click();
      await sleep(500);
      return true;
    }
  }
  return false;
};
if (process.env.E2E_SHOTS) await import("node:fs").then((fs) => fs.mkdirSync(process.env.E2E_SHOTS, { recursive: true }));
const shot = async (name) => process.env.E2E_SHOTS && page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` });

// --- loading screen (M7)
await page.goto(url, { waitUntil: "domcontentloaded" });
const boot = await app(() => document.getElementById("boot")?.innerText.replace(/\s+/g, " ").trim() ?? null);
check("loading screen is shown while starting", !!boot && boot.includes("MOMENTUM"), `"${boot}"`);
await page.waitForFunction(() => window.__momentum, { timeout: 90000 });
await sleep(800);
check("loading screen is removed once started", await app(() => !document.getElementById("boot")));
await app(() => localStorage.clear());
// Most checks below assume a settled machine; the first-run preset check is exercised
// separately at the end, so switch it off here rather than have it change presets midway.
await app(() => window.__momentum.updateSettings({ tuned: true, quality: "medium" }));

// --- menu: guide on top (M1), keyboard focus (M3)
await menuButton("Show all controls (H)");
await sleep(400);
const guide = await app(() => { const g = document.querySelector(".guide"); const r = g.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return { open: g.classList.contains("open"), onTop: g.contains(top), top: top?.className }; });
check("control guide opens on top of the menu", guide.open && guide.onTop, JSON.stringify(guide));
await shot("guide-over-menu");
await key("Escape");
check("Esc closes the guide", await app(() => !document.querySelector(".guide").classList.contains("open")));
await page.focus(".menu-tab");
await key("Tab", 200);
check("Tab moves keyboard focus in the menu", await app(() => document.activeElement?.textContent === "Environments"));
await key("Enter", 400);
check("Enter activates the focused menu tab", await app(() => document.querySelector(".menu-tab.active")?.textContent === "Environments"));
await menuTab("Settings");
await shot("menu-settings");
await menuTab("Laboratory");

// --- enter; frozen until entered
check("simulation is frozen behind the menu", (await app(() => window.__momentum.world.simTime)) === 0);
await page.click(".enter-button");
await sleep(700);
check("entering locks the pointer", await app(() => window.__momentum.mode === "play"));

// --- spawn while looking down (M4)
await app(() => { window.__momentum.player.pitch = Math.PI / 2 - 0.02; });
const p0 = await app(() => window.__momentum.player.position.asArray());
await key("KeyF", 300);
await stepSim(60);
const down = await app((p0) => { const a = window.__momentum; const o = [...a.factory.all].at(-1); const p = a.player.position; return { v: o.body.getLinearVelocity().length(), moved: Math.hypot(p.x - p0[0], p.z - p0[2]), horiz: Math.hypot(o.mesh.position.x - p0[0], o.mesh.position.z - p0[2]) }; }, p0);
check("spawning while looking down does not fling the object or the player", down.v < 4 && down.moved < 0.05 && down.horiz > 0.6, JSON.stringify(down));

// --- throw speed (H2): tiny fragment
const speed = await app(() => { const a = window.__momentum; a.setDestructionLevel(0); const e = a.player.eyePosition; a.player.pitch = 0; const d = a.player.viewDirection; const o = a.factory.spawn({ kind: "box", material: "plastic", size: e.clone().set(0.1, 0.1, 0.1), position: e.add(d.scale(1.5)), props: { gravityFactor: 0 } }); a.world.step(1 / 60); a.grab.throwOrPush(e, d); a.world.step(1 / 60); const v = o.body.getLinearVelocity().length(); a.factory.remove(o); a.setDestructionLevel(2); return v; });
check("a 1 kg fragment is thrown at about 16 m/s (was 2,381)", speed > 14 && speed < 17, `${speed.toFixed(1)} m/s`);

// --- fixed step (H1): real-time pace through the frame loop
const pace = await app(async () => { const a = window.__momentum; const t0 = performance.now(), s0 = a.world.simTime; await new Promise((r) => setTimeout(r, 3000)); return { real: (performance.now() - t0) / 1000, sim: a.world.simTime - s0, fps: a.engine.getFps() }; });
const expected = Math.min(1, (pace.fps * 4) / 60);
check("simulation keeps pace with real time (4 sub-steps per frame)", pace.sim / pace.real > expected * 0.7, `${pace.sim.toFixed(2)} s simulated in ${pace.real.toFixed(2)} s at ${pace.fps.toFixed(0)} FPS`);

// --- hide HUD (L4), undo (M6)
await key("KeyU");
check("U hides the interface", await app(() => getComputedStyle(document.querySelector(".telemetry")).visibility === "hidden"));
await key("KeyU");
const before = await app(() => window.__momentum.factory.count);
await key("KeyR", 600);
const afterReset = await app(() => window.__momentum.factory.count);
await key("KeyZ", 800);
const afterUndo = await app(() => window.__momentum.factory.count);
check("Z undoes a reset", afterReset !== before && afterUndo === before, `${before} -> ${afterReset} -> ${afterUndo}`);

// --- edit mode: Tab focus (M3), Esc to menu (M2)
await key("Tab", 800);
check("Tab enters edit mode", await app(() => window.__momentum.mode === "edit"));
await shot("edit-mode");
await page.focus(".inspector .world input[type=range]");
await key("Tab", 500);
check("Tab inside a panel moves focus instead of leaving edit mode", await app(() => window.__momentum.mode === "edit" && document.activeElement?.tagName === "BUTTON"));
await key("Escape", 600);
check("Esc in edit mode opens the menu", await app(() => window.__momentum.mode === "menu"));

// --- save: confirm overwrite (M6), pose restored (L10)
await menuTab("Experiments");
await menuButton("Save", 0);
check("saving to an empty slot needs no confirmation", (await app(() => document.querySelector(".menu-status").textContent)) === "Saved to slot 1.");
await menuButton("Save", 0);
check("overwriting a slot asks first", await app(() => [...document.querySelectorAll(".menu-panel.active .chip-button")].some((b) => b.textContent === "Overwrite?")));
await menuButton("Overwrite?");
const savedPose = await app(() => window.__momentum.player.position.asArray());
await menuTab("Environments");
await (await page.$$(".env-card"))[3].click();
await sleep(2500);
check("choosing an environment goes straight into the lab", await app(() => window.__momentum.mode === "play"));
await app(() => document.exitPointerLock());
await sleep(800);
await menuTab("Experiments");
await menuButton("Load", 0);
await sleep(2000);
check("loading a save goes straight into the lab", await app(() => window.__momentum.mode === "play"));
await app(() => document.exitPointerLock());
await sleep(800);
const loaded = await app((pose) => { const a = window.__momentum; const p = a.player.position; return { env: a.environment.id, d: Math.hypot(p.x - pose[0], p.z - pose[2]), status: document.querySelector(".menu-status").textContent }; }, savedPose);
check("loading a save restores the environment and where the player stood", loaded.env === "test-chamber" && loaded.d < 0.2, JSON.stringify(loaded));
await menuButton("Delete", 0);
check("deleting a slot asks first", await app(() => [...document.querySelectorAll(".menu-panel.active .chip-button")].some((b) => b.textContent === "Delete?")));
await menuButton("Delete?");
await shot("menu-experiments");

// --- settings persist
await menuTab("Settings");
await app(() => { const boxes = document.querySelectorAll(".menu-panel.active input[type=checkbox]"); boxes[1].click(); boxes[2].click(); });
await sleep(300);
const set = await app(() => { const s = window.__momentum.settings; return { dyn: s.dynamicResolution, shake: s.cameraShake }; });
check("dynamic resolution and camera shake can be switched off", set.dyn === false && set.shake === false, JSON.stringify(set));

// --- in-play screenshot at a narrow width (L3)
await page.setViewport({ width: 1024, height: 600 });
await menuTab("Laboratory");
await page.click(".enter-button");
await sleep(1500);
const overlap = await app(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const a = r(".onboarding"), b = r(".hotbar"); return a.bottom > b.top && a.left < b.right && document.querySelector(".onboarding").classList.contains("visible") && getComputedStyle(document.querySelector(".onboarding")).display !== "none"; });
check("getting-started panel does not overlap the hotbar at 1024 px", !overlap);
await shot("play-1024");
await page.setViewport({ width: 1280, height: 720 });
await sleep(800);
await shot("play-1280");

// --- mouse capture refused: the lab must still start (arrow-key look)
await app(() => document.exitPointerLock());
await sleep(800);
await app(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error("denied")); });
await page.click(".nav-enter");
await sleep(800);
check("Resume works when mouse capture is refused", await app(() => window.__momentum.mode === "play" && window.__momentum.input.fallback));
const yaw0 = await app(() => window.__momentum.player.yaw ?? 0);
await page.keyboard.down("ArrowRight");
await sleep(800);
await page.keyboard.up("ArrowRight");
const yaw1 = await app(() => window.__momentum.player.yaw ?? 0);
check("arrow keys turn the view in fallback mode", yaw0 !== yaw1, `${yaw0} -> ${yaw1}`);
await key("Escape", 600);
check("Esc returns to the menu in fallback mode", await app(() => window.__momentum.mode === "menu"));

// --- animation and graphics pass
// Back into the lab (mouse capture is still mocked as refused, so this is fallback mode).
await page.click(".nav-enter");
await sleep(800);
const marker = await app(() => { const m = document.querySelector(".slot-marker"); return { placed: m.classList.contains("placed"), x: m.style.transform }; });
await key("Digit3", 600);
const marker2 = await app(() => document.querySelector(".slot-marker").style.transform);
check("the hotbar marker slides to the chosen shape", marker.placed && marker2 !== marker.x, `${marker.x} -> ${marker2}`);

const dust = await app(() => { const s = window.__momentum.scene.particleSystems.find((p) => p.name === "fx-dust"); return { exists: !!s, started: s?.isStarted() ?? false, rate: s?.emitRate ?? 0, shafts: window.__momentum.scene.meshes.filter((m) => m.name.startsWith("fx-shaft")).length }; });
check("ambient dust and light shafts exist and run at the medium preset", dust.exists && dust.started && dust.rate > 0 && dust.shafts === 2, JSON.stringify(dust));

await app(() => window.__momentum.updateSettings({ quality: "low" }));
await sleep(600);
const lowDust = await app(() => { const s = window.__momentum.scene.particleSystems.find((p) => p.name === "fx-dust"); return { rate: s.emitRate, shaftOn: window.__momentum.scene.meshes.find((m) => m.name === "fx-shaft-0")?.isEnabled() }; });
check("the low preset switches the atmosphere off entirely", lowDust.rate === 0 && lowDust.shaftOn === false, JSON.stringify(lowDust));
await app(() => window.__momentum.updateSettings({ quality: "medium" }));
await sleep(600);

// The camera must stay inside the player's head however much the view is moving.
await app(() => { const a = window.__momentum; a.viewMotion.enabled = true; });
await page.keyboard.down("KeyW");
await sleep(1200);
const drift = await app(() => { const a = window.__momentum; const e = a.player.eyePosition; const c = a.camera ?? a.scene.activeCamera; return Math.hypot(c.position.x - e.x, c.position.y - e.y, c.position.z - e.z); });
await page.keyboard.up("KeyW");
check("head movement never pulls the camera out of the body", drift < 0.3, `${drift.toFixed(3)} m`);

const envFade = await app(() => { const a = window.__momentum; a.loadEnvironment("gravity-lab"); return a.hud.fadeOpacity; });
check("switching environment covers the screen, then fades in", envFade === 1);
await sleep(1200);
check("the cover clears after the fade", (await app(() => window.__momentum.hud.fadeOpacity)) === 0);

// --- phase 7: pooling, renderer check, first-run tuning
const pool = await app(() => {
  const f = window.__momentum.factory;
  const before = f.reuseCount;
  const o = f.spawn({ kind: "box", position: { x: 0, y: 2, z: 0, clone() { return this; } } });
  return { spawned: o !== null, before };
});
check("the factory exposes its pool counters", typeof pool.before === "number");
const recycled = await app(() => {
  const f = window.__momentum.factory;
  const list = [...f.all];
  const victim = list[list.length - 1];
  if (!victim) return null;
  f.remove(victim);
  const pooled = f.pooledCount;
  const made = f.spawn({ kind: victim.kind, position: victim.mesh.position });
  return { pooled, reuses: f.reuseCount, ok: made !== null };
});
check("removing an object parks it and the next spawn reuses it", recycled !== null && recycled.pooled > 0 && recycled.reuses > 0, JSON.stringify(recycled));
check("the renderer passed its own blank-frame check", await app(() => window.__momentum.rendererVerdict !== "blank"), await app(() => String(window.__momentum.rendererVerdict)));

// The high preset adds ambient occlusion and motion blur, both loaded on demand.
await app(() => window.__momentum.updateSettings({ quality: "high" }));
await sleep(3500);
const high = await app(() => { const s = window.__momentum.scene; return { pipes: s.postProcessRenderPipelineManager.supportedPipelines.map((p) => p.name), q: window.__momentum.quality }; });
check("the high preset loads ambient occlusion without errors", high.q === "high" && high.pipes.includes("momentum-ssao"), JSON.stringify(high));
await app(() => window.__momentum.updateSettings({ quality: "medium" }));
await sleep(1200);
check("dropping back to medium removes it again", !(await app(() => window.__momentum.scene.postProcessRenderPipelineManager.supportedPipelines.map((p) => p.name).includes("momentum-ssao"))));

// First-run tuning: a machine this slow (software rendering) must be moved down a preset.
await app(() => window.__momentum.updateSettings({ tuned: false, quality: "high" }));
await sleep(9000);
const tuned = await app(() => ({ tuned: window.__momentum.settings.tuned, quality: window.__momentum.quality }));
check("the first run lowers the preset on a machine that cannot hold it", tuned.tuned === true && tuned.quality !== "high", JSON.stringify(tuned));

check("no console errors or warnings", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(problems.length ? `\n${problems.length} check(s) failed` : "\nall checks passed");
process.exit(problems.length ? 1 : 0);
