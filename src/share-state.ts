export type SharedPoint = [number, number];

export interface SharedAreaSelection {
  kind: 'area';
  cornerA: SharedPoint;
  cornerB: SharedPoint;
  color: string;
}

export interface SharedShardSelection {
  kind: 'shard';
  assignmentId: string;
  shard: string;
  points: SharedPoint[];
  color: string;
}

export type SharedSelection = SharedAreaSelection | SharedShardSelection;

export interface ShareState {
  version: 1;
  view: {
    x: number;
    z: number;
    zoom: number;
  };
  worldBorderRadius?: number;
  selections: SharedSelection[];
}

const MAX_PAYLOAD_LENGTH = 120_000;
const MAX_SELECTIONS = 250;
const MAX_TOTAL_POINTS = 5_000;
const MAX_LABEL_LENGTH = 200;
const COLOR_PATTERN = /^hsl\((?:\d|[1-9]\d|[12]\d\d|3[0-5]\d|360) 68% 52%\)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const readPoint = (value: unknown): SharedPoint => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isSafeCoordinate(value[0]) ||
    !isSafeCoordinate(value[1])
  ) {
    throw new Error('A shared selection contains an invalid coordinate.');
  }
  return [value[0], value[1]];
};

const readColor = (value: unknown): string => {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    throw new Error('A shared selection contains an invalid color.');
  }
  return value;
};

const readLabel = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LABEL_LENGTH) {
    throw new Error(`A shared shard contains an invalid ${label}.`);
  }
  return value;
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 16_384)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (payload: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error('The shared setup contains invalid link data.');
  }
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('The shared setup could not be decoded.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const validateShareState = (value: unknown): ShareState => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.view)) {
    throw new Error('This shared setup uses an unsupported format.');
  }

  const { x, z, zoom } = value.view;
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    Math.abs(x) > Number.MAX_SAFE_INTEGER ||
    typeof z !== 'number' ||
    !Number.isFinite(z) ||
    Math.abs(z) > Number.MAX_SAFE_INTEGER ||
    typeof zoom !== 'number' ||
    !Number.isFinite(zoom) ||
    zoom < -18 ||
    zoom > 6
  ) {
    throw new Error('The shared setup contains an invalid map view.');
  }

  let worldBorderRadius: number | undefined;
  if (value.worldBorderRadius !== undefined) {
    if (
      typeof value.worldBorderRadius !== 'number' ||
      !Number.isSafeInteger(value.worldBorderRadius) ||
      value.worldBorderRadius < 1 ||
      value.worldBorderRadius > 30_000_000
    ) {
      throw new Error('The shared setup contains an invalid world border.');
    }
    worldBorderRadius = value.worldBorderRadius;
  }

  if (!Array.isArray(value.selections) || value.selections.length > MAX_SELECTIONS) {
    throw new Error('The shared setup contains too many selections.');
  }

  let totalPoints = 0;
  const selections: SharedSelection[] = value.selections.map((selection) => {
    if (!isRecord(selection)) {
      throw new Error('The shared setup contains an invalid selection.');
    }
    const color = readColor(selection.color);
    if (selection.kind === 'area') {
      return {
        kind: 'area',
        cornerA: readPoint(selection.cornerA),
        cornerB: readPoint(selection.cornerB),
        color,
      };
    }
    if (selection.kind === 'shard') {
      if (!Array.isArray(selection.points) || selection.points.length < 3) {
        throw new Error('A shared shard needs at least three polygon points.');
      }
      totalPoints += selection.points.length;
      if (totalPoints > MAX_TOTAL_POINTS) {
        throw new Error('The shared setup contains too many polygon points.');
      }
      const points = selection.points.map(readPoint);
      const uniquePoints = new Set(points.map(([x, z]) => `${x},${z}`));
      if (uniquePoints.size !== points.length) {
        throw new Error('A shared shard contains a repeated polygon point.');
      }
      const twiceArea = points.reduce((area, [x, z], index) => {
        const [nextX, nextZ] = points[(index + 1) % points.length];
        return area + x * nextZ - nextX * z;
      }, 0);
      if (twiceArea === 0) {
        throw new Error('A shared shard does not form a polygon with area.');
      }
      return {
        kind: 'shard',
        assignmentId: readLabel(selection.assignmentId, 'assignment id'),
        shard: readLabel(selection.shard, 'shard name'),
        points,
        color,
      };
    }
    throw new Error('The shared setup contains an unknown selection type.');
  });

  return {
    version: 1,
    view: { x, z, zoom },
    ...(worldBorderRadius === undefined ? {} : { worldBorderRadius }),
    selections,
  };
};

export const encodeShareState = (state: ShareState): string => {
  const validated = validateShareState(state);
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  const payload = bytesToBase64Url(bytes);
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error('This setup is too large to fit in a shareable link.');
  }
  return payload;
};

export const decodeShareState = (payload: string): ShareState => {
  if (!payload || payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error('The shared setup link is empty or too large.');
  }
  const json = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(payload));
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('The shared setup contains invalid JSON data.');
  }
  return validateShareState(value);
};
