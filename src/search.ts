import { getRegionForBlock, type CoordinatePair } from './coordinates';

export type SearchResult =
  | { kind: 'region'; region: CoordinatePair }
  | { kind: 'block'; block: CoordinatePair; region: CoordinatePair };

const toSafeInteger = (value: string): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const parseSearch = (input: string): SearchResult | undefined => {
  const query = input.trim();
  const regionMatch = query.match(/^r\.(-?\d+)\.(-?\d+)(?:\.mca)?$/i);

  if (regionMatch) {
    const x = toSafeInteger(regionMatch[1]);
    const z = toSafeInteger(regionMatch[2]);
    if (x !== undefined && z !== undefined) {
      return { kind: 'region', region: { x, z } };
    }
  }

  const blockMatch = query.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/);
  if (blockMatch) {
    const x = toSafeInteger(blockMatch[1]);
    const z = toSafeInteger(blockMatch[2]);
    if (x !== undefined && z !== undefined) {
      const block = { x, z };
      return { kind: 'block', block, region: getRegionForBlock(x, z) };
    }
  }

  return undefined;
};
