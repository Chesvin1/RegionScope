import L, { type Coords, type DoneCallback } from 'leaflet';
import { BLOCKS_PER_CHUNK, BLOCKS_PER_REGION, getRegionName } from './coordinates';

export interface GridPalette {
  block: string;
  chunk: string;
  region: string;
  major: string;
  axis: string;
  label: string;
  labelBackground: string;
}

const LIGHT_PALETTE: GridPalette = {
  block: 'rgba(65, 92, 72, 0.12)',
  chunk: 'rgba(65, 92, 72, 0.24)',
  region: 'rgba(47, 72, 54, 0.35)',
  major: 'rgba(36, 125, 75, 0.72)',
  axis: 'rgba(211, 92, 52, 0.9)',
  label: '#2b3a2e',
  labelBackground: 'rgba(243, 245, 239, 0.86)',
};

const DARK_PALETTE: GridPalette = {
  block: 'rgba(175, 199, 181, 0.1)',
  chunk: 'rgba(175, 199, 181, 0.22)',
  region: 'rgba(177, 205, 185, 0.34)',
  major: 'rgba(100, 210, 145, 0.7)',
  axis: 'rgba(255, 142, 102, 0.92)',
  label: '#e6eee8',
  labelBackground: 'rgba(20, 27, 22, 0.86)',
};

export class RegionGridLayer extends L.GridLayer {
  private palette: GridPalette;

  constructor(isDark = false) {
    super({
      tileSize: 256,
      minZoom: -18,
      maxZoom: 6,
      noWrap: true,
      updateWhenZooming: false,
      updateWhenIdle: false,
      keepBuffer: 3,
    });
    this.palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  setDarkMode(isDark: boolean): void {
    this.palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    this.redraw();
  }

  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const canvas = document.createElement('canvas');
    const tileSize = this.getTileSize();
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = tileSize.x * pixelRatio;
    canvas.height = tileSize.y * pixelRatio;
    canvas.style.width = `${tileSize.x}px`;
    canvas.style.height = `${tileSize.y}px`;

    const context = canvas.getContext('2d');
    if (context) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.drawTile(context, coords, tileSize);
    }

    queueMicrotask(() => done(undefined, canvas));
    return canvas;
  }

  private drawTile(context: CanvasRenderingContext2D, coords: Coords, tileSize: L.Point): void {
    const scale = 2 ** coords.z;
    const originX = coords.x * tileSize.x;
    const originY = coords.y * tileSize.y;
    const minBlockX = originX / scale;
    const minBlockZ = -(originY + tileSize.y) / scale;
    const maxBlockX = (originX + tileSize.x) / scale;
    const maxBlockZ = -originY / scale;
    const regionPixels = BLOCKS_PER_REGION * scale;
    const chunkPixels = BLOCKS_PER_CHUNK * scale;
    const blockPixels = scale;

    if (blockPixels >= 6) {
      this.drawGrid(
        context,
        1,
        minBlockX,
        maxBlockX,
        minBlockZ,
        maxBlockZ,
        scale,
        originX,
        originY,
        this.palette.block,
        0.75,
      );
    }

    if (chunkPixels >= 10) {
      this.drawGrid(
        context,
        BLOCKS_PER_CHUNK,
        minBlockX,
        maxBlockX,
        minBlockZ,
        maxBlockZ,
        scale,
        originX,
        originY,
        this.palette.chunk,
        1,
      );
    }

    if (regionPixels >= 20) {
      this.drawGrid(
        context,
        BLOCKS_PER_REGION,
        minBlockX,
        maxBlockX,
        minBlockZ,
        maxBlockZ,
        scale,
        originX,
        originY,
        this.palette.region,
        1.25,
      );
    }

    let majorInterval = BLOCKS_PER_REGION * 8;
    while (majorInterval * scale < 56) {
      majorInterval *= 2;
    }
    this.drawGrid(
      context,
      majorInterval,
      minBlockX,
      maxBlockX,
      minBlockZ,
      maxBlockZ,
      scale,
      originX,
      originY,
      this.palette.major,
      1.75,
    );

    this.drawAxes(context, minBlockX, maxBlockX, minBlockZ, maxBlockZ, originX, originY);

    if (regionPixels >= 140) {
      this.drawRegionLabels(context, coords, tileSize, scale);
    }
  }

  private drawGrid(
    context: CanvasRenderingContext2D,
    interval: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    scale: number,
    originX: number,
    originY: number,
    strokeStyle: string,
    lineWidth: number,
  ): void {
    context.beginPath();
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;

    for (let x = Math.ceil(minX / interval) * interval; x <= maxX; x += interval) {
      const pixelX = Math.round(x * scale - originX) + 0.5;
      context.moveTo(pixelX, 0);
      context.lineTo(pixelX, this.getTileSize().y);
    }

    for (let z = Math.ceil(minZ / interval) * interval; z <= maxZ; z += interval) {
      const pixelY = Math.round(-z * scale - originY) + 0.5;
      context.moveTo(0, pixelY);
      context.lineTo(this.getTileSize().x, pixelY);
    }

    context.stroke();
  }

  private drawAxes(
    context: CanvasRenderingContext2D,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    originX: number,
    originY: number,
  ): void {
    context.beginPath();
    context.strokeStyle = this.palette.axis;
    context.lineWidth = 2;

    if (minX <= 0 && maxX >= 0) {
      const pixelX = Math.round(-originX) + 0.5;
      context.moveTo(pixelX, 0);
      context.lineTo(pixelX, this.getTileSize().y);
    }

    if (minZ <= 0 && maxZ >= 0) {
      const pixelY = Math.round(-originY) + 0.5;
      context.moveTo(0, pixelY);
      context.lineTo(this.getTileSize().x, pixelY);
    }

    context.stroke();
  }

  private drawRegionLabels(
    context: CanvasRenderingContext2D,
    coords: Coords,
    tileSize: L.Point,
    scale: number,
  ): void {
    const originX = coords.x * tileSize.x;
    const originY = coords.y * tileSize.y;
    const minRegionX = Math.floor(originX / scale / BLOCKS_PER_REGION);
    const maxRegionX = Math.floor((originX + tileSize.x) / scale / BLOCKS_PER_REGION);
    const minRegionZ = Math.floor(-(originY + tileSize.y) / scale / BLOCKS_PER_REGION);
    const maxRegionZ = Math.floor(-originY / scale / BLOCKS_PER_REGION);

    context.font = '600 12px Inter, ui-sans-serif, system-ui, sans-serif';
    context.textBaseline = 'top';

    for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
      for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += 1) {
        const x = regionX * BLOCKS_PER_REGION * scale - originX + 9;
        const y = -(regionZ + 1) * BLOCKS_PER_REGION * scale - originY + 9;

        if (x < 0 || x >= tileSize.x || y < 0 || y >= tileSize.y) {
          continue;
        }

        const label = getRegionName(regionX, regionZ);
        const width = context.measureText(label).width;
        context.fillStyle = this.palette.labelBackground;
        context.fillRect(x - 4, y - 3, width + 8, 18);
        context.fillStyle = this.palette.label;
        context.fillText(label, x, y);
      }
    }
  }
}
