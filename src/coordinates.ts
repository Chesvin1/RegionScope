import L, { type LatLng, type LatLngExpression } from 'leaflet';

export const BLOCKS_PER_CHUNK = 16;
export const CHUNKS_PER_REGION = 32;
export const BLOCKS_PER_REGION = BLOCKS_PER_CHUNK * CHUNKS_PER_REGION;

export interface CoordinatePair {
  x: number;
  z: number;
}

export interface RegionBounds {
  blockMin: CoordinatePair;
  blockMax: CoordinatePair;
  chunkMin: CoordinatePair;
  chunkMax: CoordinatePair;
}

export const blockToChunk = (block: number): number =>
  Math.floor(block / BLOCKS_PER_CHUNK);

export const blockToRegion = (block: number): number =>
  Math.floor(block / BLOCKS_PER_REGION);

export const blockToLatLng = (x: number, z: number): LatLngExpression => [-z, x];

export const latLngToBlock = (position: LatLng): CoordinatePair => ({
  x: Math.floor(position.lng),
  z: Math.floor(-position.lat),
});

export const getRegionBounds = (regionX: number, regionZ: number): RegionBounds => {
  const blockMin = {
    x: regionX * BLOCKS_PER_REGION,
    z: regionZ * BLOCKS_PER_REGION,
  };
  const chunkMin = {
    x: regionX * CHUNKS_PER_REGION,
    z: regionZ * CHUNKS_PER_REGION,
  };

  return {
    blockMin,
    blockMax: {
      x: blockMin.x + BLOCKS_PER_REGION - 1,
      z: blockMin.z + BLOCKS_PER_REGION - 1,
    },
    chunkMin,
    chunkMax: {
      x: chunkMin.x + CHUNKS_PER_REGION - 1,
      z: chunkMin.z + CHUNKS_PER_REGION - 1,
    },
  };
};

export const getRegionName = (regionX: number, regionZ: number): string =>
  `r.${regionX}.${regionZ}`;

export const getRegionForBlock = (x: number, z: number): CoordinatePair => ({
  x: blockToRegion(x),
  z: blockToRegion(z),
});

export const getRegionCenter = (regionX: number, regionZ: number): LatLng =>
  L.latLng(
    -(regionZ * BLOCKS_PER_REGION + BLOCKS_PER_REGION / 2),
    regionX * BLOCKS_PER_REGION + BLOCKS_PER_REGION / 2,
  );
