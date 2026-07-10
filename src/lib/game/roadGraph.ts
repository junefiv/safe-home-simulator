import {
  distancePointToSegmentM,
  haversineDistance,
  projectPointToSegment,
} from "./geo";
import type { LatLng, WalkLine } from "./types";

const NODE_MERGE_M = 3;
const graphCache = new WeakMap<WalkLine[], RoadGraph>();

export interface RoadGraph {
  nodes: LatLng[];
  edges: { to: number; weight: number }[][];
  nodeIndexByKey: Map<string, number>;
}

export interface RoadSnap {
  point: LatLng;
  nodeIndex: number;
  distanceM: number;
}

function nodeKey(lat: number, lng: number): string {
  const latScale = 111111;
  const lngScale = 111111 * Math.cos((lat * Math.PI) / 180);
  return `${Math.round((lat * latScale) / NODE_MERGE_M)}:${Math.round((lng * lngScale) / NODE_MERGE_M)}`;
}

function addEdge(graph: RoadGraph, from: number, to: number, weight: number): void {
  if (from === to || weight <= 0) return;
  const list = graph.edges[from];
  const existing = list.find((e) => e.to === to);
  if (existing) {
    existing.weight = Math.min(existing.weight, weight);
    return;
  }
  list.push({ to, weight });
}

export function buildRoadGraph(walkLines: WalkLine[]): RoadGraph {
  const cached = graphCache.get(walkLines);
  if (cached) return cached;

  const nodes: LatLng[] = [];
  const edges: { to: number; weight: number }[][] = [];
  const keyToIndex = new Map<string, number>();

  const getOrCreateNode = (pt: LatLng): number => {
    const key = nodeKey(pt.lat, pt.lng);
    const found = keyToIndex.get(key);
    if (found !== undefined) return found;
    const idx = nodes.length;
    nodes.push({ lat: pt.lat, lng: pt.lng });
    edges.push([]);
    keyToIndex.set(key, idx);
    return idx;
  };

  for (const line of walkLines) {
    const a = getOrCreateNode(line.p1);
    const b = getOrCreateNode(line.p2);
    const weight = haversineDistance(line.p1, line.p2);
    addEdge({ nodes, edges, nodeIndexByKey: keyToIndex }, a, b, weight);
    addEdge({ nodes, edges, nodeIndexByKey: keyToIndex }, b, a, weight);
  }

  const graph: RoadGraph = { nodes, edges, nodeIndexByKey: keyToIndex };
  graphCache.set(walkLines, graph);
  return graph;
}

export function getRoadGraph(walkLines: WalkLine[]): RoadGraph | null {
  if (walkLines.length === 0) return null;
  return buildRoadGraph(walkLines);
}

export function snapToRoadNetwork(
  point: LatLng,
  walkLines: WalkLine[],
  graph: RoadGraph,
): RoadSnap | null {
  if (walkLines.length === 0 || graph.nodes.length === 0) return null;

  let bestPoint: LatLng | null = null;
  let bestNode = 0;
  let bestDist = Infinity;

  for (const line of walkLines) {
    const projected = projectPointToSegment(point, line.p1, line.p2);
    const dist = haversineDistance(point, projected);
    if (dist >= bestDist) continue;

    const distToP1 = haversineDistance(projected, line.p1);
    const distToP2 = haversineDistance(projected, line.p2);
    const endpoint = distToP1 <= distToP2 ? line.p1 : line.p2;
    const nodeIndex =
      graph.nodeIndexByKey.get(nodeKey(endpoint.lat, endpoint.lng)) ?? 0;

    bestDist = dist;
    bestPoint = projected;
    bestNode = nodeIndex;
  }

  if (!bestPoint) return null;
  return { point: bestPoint, nodeIndex: bestNode, distanceM: bestDist };
}

interface AStarNode {
  idx: number;
  f: number;
}

function reconstructPath(cameFrom: Map<number, number>, current: number): number[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.push(current);
  }
  path.reverse();
  return path;
}

export function findRoadPath(
  graph: RoadGraph,
  startIdx: number,
  goalIdx: number,
): number[] | null {
  if (startIdx === goalIdx) return [startIdx];
  if (startIdx < 0 || goalIdx < 0) return null;
  if (startIdx >= graph.nodes.length || goalIdx >= graph.nodes.length) return null;

  const goal = graph.nodes[goalIdx];
  const open: AStarNode[] = [{ idx: startIdx, f: 0 }];
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  gScore.set(startIdx, 0);

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!.idx;

    if (current === goalIdx) {
      return reconstructPath(cameFrom, current);
    }

    const currentG = gScore.get(current) ?? Infinity;
    for (const edge of graph.edges[current]) {
      const tentative = currentG + edge.weight;
      const known = gScore.get(edge.to);
      if (known !== undefined && tentative >= known) continue;

      cameFrom.set(edge.to, current);
      gScore.set(edge.to, tentative);
      const h = haversineDistance(graph.nodes[edge.to], goal);
      open.push({ idx: edge.to, f: tentative + h });
    }
  }

  return null;
}

export function buildChaseWaypoints(
  from: LatLng,
  to: LatLng,
  walkLines: WalkLine[],
  graph: RoadGraph,
): LatLng[] {
  const startSnap = snapToRoadNetwork(from, walkLines, graph);
  const goalSnap = snapToRoadNetwork(to, walkLines, graph);
  if (!startSnap || !goalSnap) return [to];

  const nodePath = findRoadPath(graph, startSnap.nodeIndex, goalSnap.nodeIndex);
  if (!nodePath || nodePath.length === 0) return [to];

  const waypoints: LatLng[] = [];
  const firstNode = graph.nodes[nodePath[0]];
  if (haversineDistance(from, firstNode) > 2) {
    waypoints.push(firstNode);
  }

  for (let i = 1; i < nodePath.length; i += 1) {
    waypoints.push(graph.nodes[nodePath[i]]);
  }

  if (haversineDistance(waypoints[waypoints.length - 1] ?? from, to) > 2) {
    waypoints.push(to);
  }

  return waypoints.length > 0 ? waypoints : [to];
}

export function nearestRoadPoint(point: LatLng, walkLines: WalkLine[]): LatLng | null {
  if (walkLines.length === 0) return null;

  let best: LatLng | null = null;
  let bestDist = Infinity;
  for (const line of walkLines) {
    const projected = projectPointToSegment(point, line.p1, line.p2);
    const dist = distancePointToSegmentM(point, line.p1, line.p2);
    if (dist < bestDist) {
      bestDist = dist;
      best = projected;
    }
  }
  return best;
}

