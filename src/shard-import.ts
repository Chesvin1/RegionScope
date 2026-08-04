import type { CoordinatePair } from './coordinates';

export interface ShardAssignment {
  id: string;
  shard: string;
  points: CoordinatePair[];
}

interface PendingAssignment {
  id?: string;
  shard?: string;
  points: CoordinatePair[];
  startLine: number;
}

const stripComment = (line: string): string => {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
      quote = quote === character ? undefined : quote ?? character;
    } else if (character === '#' && quote === undefined) {
      return line.slice(0, index);
    }
  }
  return line;
};

const parseTextValue = (value: string): string => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const finishAssignment = (
  pending: PendingAssignment | undefined,
  assignments: ShardAssignment[],
): void => {
  if (!pending) {
    return;
  }
  if (!pending.id) {
    throw new Error(`Assignment near line ${pending.startLine} is missing an id.`);
  }
  if (!pending.shard) {
    throw new Error(`Assignment “${pending.id}” is missing a shard name.`);
  }
  if (pending.points.length < 3) {
    throw new Error(`Assignment “${pending.id}” needs at least three points.`);
  }

  const points = [...pending.points];
  const first = points[0];
  const last = points.at(-1);
  if (last && first.x === last.x && first.z === last.z) {
    points.pop();
  }
  if (points.length < 3) {
    throw new Error(`Assignment “${pending.id}” needs at least three unique points.`);
  }

  const uniquePoints = new Set(points.map((point) => `${point.x},${point.z}`));
  if (uniquePoints.size !== points.length) {
    throw new Error(`Assignment “${pending.id}” contains a repeated polygon point.`);
  }
  const twiceArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  if (twiceArea === 0) {
    throw new Error(`Assignment “${pending.id}” does not form a polygon with area.`);
  }

  assignments.push({ id: pending.id, shard: pending.shard, points });
};

export const parseShardAssignments = (source: string): ShardAssignment[] => {
  const assignments: ShardAssignment[] = [];
  let pending: PendingAssignment | undefined;
  let inPoints = false;
  let foundRoot = false;

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const line = stripComment(rawLine).trim();
    if (!line) {
      return;
    }
    if (line === 'assignments:') {
      foundRoot = true;
      return;
    }

    const idMatch = line.match(/^-\s+id:\s*(.+)$/);
    if (idMatch) {
      finishAssignment(pending, assignments);
      const id = parseTextValue(idMatch[1]);
      if (!id) {
        throw new Error(`Assignment on line ${lineNumber} has an empty id.`);
      }
      pending = { id, points: [], startLine: lineNumber };
      inPoints = false;
      return;
    }

    if (!pending) {
      throw new Error(`Unexpected content on line ${lineNumber}. Expected “assignments:” or “- id:”.`);
    }

    const shardMatch = line.match(/^shard:\s*(.+)$/);
    if (shardMatch) {
      pending.shard = parseTextValue(shardMatch[1]);
      if (!pending.shard) {
        throw new Error(`Assignment “${pending.id}” has an empty shard name.`);
      }
      inPoints = false;
      return;
    }

    if (line === 'points:') {
      inPoints = true;
      return;
    }

    const pointMatch = line.match(/^-\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/);
    if (inPoints && pointMatch) {
      const x = Number(pointMatch[1]);
      const z = Number(pointMatch[2]);
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) {
        throw new Error(`Point on line ${lineNumber} is outside the supported integer range.`);
      }
      pending.points.push({ x, z });
      return;
    }

    throw new Error(`Could not understand line ${lineNumber}: ${line}`);
  });

  if (!foundRoot) {
    throw new Error('Missing the top-level “assignments:” key.');
  }
  finishAssignment(pending, assignments);
  if (assignments.length === 0) {
    throw new Error('No shard assignments were found.');
  }

  const ids = new Set<string>();
  assignments.forEach((assignment) => {
    if (ids.has(assignment.id)) {
      throw new Error(`Duplicate assignment id: “${assignment.id}”.`);
    }
    ids.add(assignment.id);
  });

  return assignments;
};
