import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { MATERIALS, type MaterialId } from "../materials/Materials";

const hasDom = typeof document !== "undefined";

/** Shared PBR materials for the facility. One instance per look so draw calls can batch. */
export class MaterialLibrary {
  readonly floor: PBRMaterial;
  readonly wall: PBRMaterial;
  readonly ceiling: PBRMaterial;
  readonly structure: PBRMaterial;
  readonly deck: PBRMaterial;
  readonly glass: PBRMaterial;
  readonly emissiveCyan: PBRMaterial;
  readonly emissiveAmber: PBRMaterial;
  readonly lightPanel: PBRMaterial;
  readonly emissiveViolet: PBRMaterial;
  /** Render material for each physical material preset. */
  readonly solids: Record<MaterialId, PBRMaterial>;

  constructor(private readonly scene: Scene) {
    this.floor = this.pbr("mat-floor", new Color3(0.3, 0.32, 0.36), 0.15, 0.42);
    if (hasDom) {
      const tex = this.panelTexture("tex-floor-panels", "#8f949c", "#3a3d44");
      tex.uScale = 18;
      tex.vScale = 24;
      this.floor.albedoTexture = tex;
      this.floor.albedoColor = new Color3(0.42, 0.45, 0.5);
    }
    this.wall = this.pbr("mat-wall", new Color3(0.26, 0.28, 0.33), 0.1, 0.6);
    this.ceiling = this.pbr("mat-ceiling", new Color3(0.1, 0.11, 0.13), 0.1, 0.8);
    this.structure = this.pbr("mat-structure", new Color3(0.36, 0.38, 0.42), 0.55, 0.4);
    this.deck = this.pbr("mat-deck", new Color3(0.2, 0.21, 0.25), 0.4, 0.5);

    this.glass = this.pbr("mat-glass", new Color3(0.55, 0.75, 0.85), 0, 0.08);
    this.glass.alpha = 0.22;
    this.glass.backFaceCulling = false;

    this.emissiveCyan = this.emissive("mat-emissive-cyan", new Color3(0.15, 0.85, 1.0), 1.6);
    this.emissiveAmber = this.emissive("mat-emissive-amber", new Color3(1.0, 0.55, 0.15), 1.4);
    this.lightPanel = this.emissive("mat-light-panel", new Color3(0.86, 0.93, 1.0), 2.2);

    this.emissiveViolet = this.emissive("mat-emissive-violet", new Color3(0.62, 0.42, 1.0), 1.6);

    this.solids = {} as Record<MaterialId, PBRMaterial>;
    for (const def of Object.values(MATERIALS)) {
      const m = this.pbr(`mat-solid-${def.id}`, new Color3(...def.look.color), def.look.metallic, def.look.roughness);
      if (def.look.alpha !== undefined) {
        m.alpha = def.look.alpha;
        m.backFaceCulling = false;
      }
      this.solids[def.id] = m;
    }
  }

  private pbr(name: string, albedo: Color3, metallic: number, roughness: number): PBRMaterial {
    const m = new PBRMaterial(name, this.scene);
    m.albedoColor = albedo;
    m.metallic = metallic;
    m.roughness = roughness;
    return m;
  }

  private emissive(name: string, color: Color3, intensity: number): PBRMaterial {
    const m = this.pbr(name, Color3.Black(), 0, 1);
    m.emissiveColor = color;
    m.emissiveIntensity = intensity;
    m.disableLighting = true;
    return m;
  }

  /** Procedural floor-panel texture: light panel with dark seams. Avoids shipping image assets. */
  private panelTexture(name: string, panel: string, seam: string): DynamicTexture {
    const size = 256;
    const tex = new DynamicTexture(name, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, size, size);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "rgba(255,255,255,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0.10)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = seam;
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, size, size);
    ctx.fillStyle = seam;
    for (const [x, y] of [[18, 18], [size - 18, 18], [18, size - 18], [size - 18, size - 18]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    tex.update();
    tex.wrapU = 1; // Texture.WRAP_ADDRESSMODE (DynamicTexture defaults to clamp)
    tex.wrapV = 1;
    tex.anisotropicFilteringLevel = 8;
    return tex;
  }
}
