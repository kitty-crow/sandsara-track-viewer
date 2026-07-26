import {
  appendPoints,
  pointRadius,
  polylineLength,
  removeAdjacentDuplicates,
  routingIndexes,
  squaredDistance,
  type RoutingPoint
} from "./routingGeometry";

interface GraphEdge {
  readonly to: number;
  readonly length: number;
  readonly points: readonly RoutingPoint[];
}

interface GraphNode {
  readonly point: RoutingPoint;
  readonly edges: GraphEdge[];
}

export interface ShortestPaths {
  readonly distances: readonly number[];
  readonly previousNode: readonly number[];
  readonly previousEdge: readonly GraphEdge[];
}

const MAX_GRAPH_NODES_PER_POLYLINE = 192;
const GRAPH_CELL_COUNT = 40;

export class RouteGraph {
  private readonly nodes: GraphNode[] = [];
  private readonly nodeByKey = new Map<string, number>();
  private readonly spatial = new Map<string, number[]>();
  private readonly cellSize: number;
  private readonly mergeTolerance: number;

  public constructor(private readonly outerRadius: number) {
    this.cellSize = Math.max(1, outerRadius * 2 / GRAPH_CELL_COUNT);
    this.mergeTolerance = Math.max(1e-5, outerRadius * 1e-6);
  }

  public point(nodeId: number): RoutingPoint {
    return this.nodes[nodeId]?.point ?? { x: 0, y: 0 };
  }

  public addPolyline(points: readonly RoutingPoint[]): {
    readonly startNode: number;
    readonly endNode: number;
  } {
    const clean = removeAdjacentDuplicates(points);
    if (clean.length === 0) {
      const node = this.addNode({ x: 0, y: 0 });
      return { startNode: node, endNode: node };
    }

    const indexes = routingIndexes(clean.length, MAX_GRAPH_NODES_PER_POLYLINE);
    let previousIndex = indexes[0] ?? 0;
    let previousNode = this.addNode(clean[previousIndex] ?? clean[0] ?? { x: 0, y: 0 });
    const startNode = previousNode;

    for (let position = 1; position < indexes.length; position++) {
      const currentIndex = indexes[position] ?? clean.length - 1;
      const currentPoint = clean[currentIndex];
      if (currentPoint === undefined) {
        continue;
      }
      const currentNode = this.addNode(currentPoint);
      const forward = clean.slice(previousIndex, currentIndex + 1);
      const length = polylineLength(forward);
      if (length > 0 && previousNode !== currentNode) {
        this.nodes[previousNode]?.edges.push({ to: currentNode, length, points: forward });
        this.nodes[currentNode]?.edges.push({
          to: previousNode,
          length,
          points: [...forward].reverse()
        });
      }
      previousIndex = currentIndex;
      previousNode = currentNode;
    }

    return { startNode, endNode: previousNode };
  }

  public shortestPaths(startNode: number): ShortestPaths {
    const distances = new Array<number>(this.nodes.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = new Array<number>(this.nodes.length).fill(-1);
    const previousEdge = new Array<GraphEdge>(this.nodes.length);
    const visited = new Uint8Array(this.nodes.length);
    const queue = new MinHeap();

    distances[startNode] = 0;
    queue.push(startNode, 0);

    while (queue.size > 0) {
      const item = queue.pop();
      if (item === undefined || visited[item.node] !== 0) {
        continue;
      }
      visited[item.node] = 1;
      const node = this.nodes[item.node];
      if (node === undefined) {
        continue;
      }

      for (const edge of node.edges) {
        const nextDistance = item.distance + edge.length;
        if (nextDistance + 1e-9 < (distances[edge.to] ?? Number.POSITIVE_INFINITY)) {
          distances[edge.to] = nextDistance;
          previousNode[edge.to] = item.node;
          previousEdge[edge.to] = edge;
          queue.push(edge.to, nextDistance);
        }
      }
    }

    return { distances, previousNode, previousEdge };
  }

  public reconstructPath(shortest: ShortestPaths, targetNode: number): RoutingPoint[] {
    const reversedEdges: GraphEdge[] = [];
    let cursor = targetNode;
    while ((shortest.previousNode[cursor] ?? -1) >= 0) {
      const edge = shortest.previousEdge[cursor];
      if (edge === undefined) {
        break;
      }
      reversedEdges.push(edge);
      cursor = shortest.previousNode[cursor] ?? -1;
    }

    const output: RoutingPoint[] = [this.point(cursor >= 0 ? cursor : targetNode)];
    for (let index = reversedEdges.length - 1; index >= 0; index--) {
      const edge = reversedEdges[index];
      if (edge !== undefined) {
        appendPoints(output, edge.points.slice(1));
      }
    }
    return output;
  }

  public nearestNodeIds(point: RoutingPoint, limit: number): number[] {
    const centreX = Math.floor(point.x / this.cellSize);
    const centreY = Math.floor(point.y / this.cellSize);
    const candidates = new Set<number>();

    for (let radius = 0; radius <= GRAPH_CELL_COUNT && candidates.size < limit * 3; radius++) {
      for (let x = centreX - radius; x <= centreX + radius; x++) {
        for (const y of [centreY - radius, centreY + radius]) {
          this.addCellCandidates(candidates, x, y);
        }
      }
      for (let y = centreY - radius + 1; y < centreY + radius; y++) {
        for (const x of [centreX - radius, centreX + radius]) {
          this.addCellCandidates(candidates, x, y);
        }
      }
    }

    if (candidates.size === 0) {
      for (let node = 0; node < this.nodes.length; node++) {
        candidates.add(node);
      }
    }

    return [...candidates]
      .sort((first, second) =>
        squaredDistance(this.point(first), point) - squaredDistance(this.point(second), point))
      .slice(0, limit);
  }

  public outerNodeIds(limit: number): number[] {
    return this.nodes
      .map((_node, index) => index)
      .sort((first, second) =>
        pointRadius(this.point(second)) - pointRadius(this.point(first)))
      .slice(0, limit);
  }

  private addNode(point: RoutingPoint): number {
    const key = `${Math.round(point.x / this.mergeTolerance)},${Math.round(point.y / this.mergeTolerance)}`;
    const existing = this.nodeByKey.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const nodeId = this.nodes.length;
    this.nodes.push({ point: { x: point.x, y: point.y }, edges: [] });
    this.nodeByKey.set(key, nodeId);
    const cellKey = this.cellKey(
      Math.floor(point.x / this.cellSize),
      Math.floor(point.y / this.cellSize)
    );
    const cell = this.spatial.get(cellKey);
    if (cell === undefined) {
      this.spatial.set(cellKey, [nodeId]);
    } else {
      cell.push(nodeId);
    }
    return nodeId;
  }

  private addCellCandidates(target: Set<number>, x: number, y: number): void {
    const cell = this.spatial.get(this.cellKey(x, y));
    if (cell !== undefined) {
      for (const node of cell) {
        target.add(node);
      }
    }
  }

  private cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }
}

class MinHeap {
  private readonly items: Array<{ readonly node: number; readonly distance: number }> = [];

  public get size(): number {
    return this.items.length;
  }

  public push(node: number, distance: number): void {
    this.items.push({ node, distance });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if ((this.items[parent]?.distance ?? 0) <= distance) {
        break;
      }
      this.items[index] = this.items[parent] ?? { node, distance };
      index = parent;
    }
    this.items[index] = { node, distance };
  }

  public pop(): { readonly node: number; readonly distance: number } | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (first === undefined || last === undefined || this.items.length === 0) {
      return first;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) {
        break;
      }
      const smallest = right < this.items.length &&
        (this.items[right]?.distance ?? Number.POSITIVE_INFINITY) <
        (this.items[left]?.distance ?? Number.POSITIVE_INFINITY)
        ? right
        : left;
      if ((this.items[smallest]?.distance ?? Number.POSITIVE_INFINITY) >= last.distance) {
        break;
      }
      this.items[index] = this.items[smallest] ?? last;
      index = smallest;
    }
    this.items[index] = last;
    return first;
  }
}
