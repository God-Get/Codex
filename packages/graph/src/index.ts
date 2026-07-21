import type { CodexObject, CodexProject, CodexRelation } from "@codex/core";

export interface GraphEdge extends CodexRelation { source: string; }
export interface GraphStatistics {
  objects: number;
  relations: number;
  roots: number;
  maxDepth: number;
  objectTypes: Record<string, number>;
  languages: Record<string, number>;
}

export class CodexGraph {
  readonly project: CodexProject;
  readonly objects: ReadonlyMap<string, CodexObject>;
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();
  private readonly byType = new Map<string, CodexObject[]>();

  constructor(project: CodexProject) {
    this.project = structuredClone(project);
    const objectMap = new Map<string, CodexObject>();
    for (const object of this.project.objects) {
      if (objectMap.has(object.id)) throw new Error(`Duplicate object id: ${object.id}`);
      objectMap.set(object.id, object);
      this.byType.set(object.type, [...(this.byType.get(object.type) ?? []), object]);
      const relations = [
        ...(object.relations ?? []),
        ...(object.derivedFrom ?? []).map(target => ({ type: "derivedFrom", target }))
      ];
      for (const relation of relations) {
        const edge: GraphEdge = { source: object.id, ...relation };
        this.outgoing.set(object.id, [...(this.outgoing.get(object.id) ?? []), edge]);
        this.incoming.set(relation.target, [...(this.incoming.get(relation.target) ?? []), edge]);
      }
    }
    this.objects = objectMap;
  }

  getObject(id: string): CodexObject | undefined { return this.objects.get(id); }
  getObjectsByType(type: string): readonly CodexObject[] { return this.byType.get(type) ?? []; }
  edgesFrom(id: string): readonly GraphEdge[] { return this.outgoing.get(id) ?? []; }
  edgesTo(id: string): readonly GraphEdge[] { return this.incoming.get(id) ?? []; }
  neighbours(id: string): readonly CodexObject[] {
    const ids = new Set([...this.edgesFrom(id).map(e => e.target), ...this.edgesTo(id).map(e => e.source)]);
    return [...ids].map(value => this.objects.get(value)).filter((value): value is CodexObject => Boolean(value));
  }
  roots(): readonly CodexObject[] { return [...this.objects.values()].filter(object => this.edgesTo(object.id).length === 0); }
  descendants(id: string, relationTypes?: readonly string[]): readonly CodexObject[] {
    const visited = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of this.edgesFrom(current)) {
        if (relationTypes && !relationTypes.includes(edge.type)) continue;
        if (!visited.has(edge.target)) { visited.add(edge.target); queue.push(edge.target); }
      }
    }
    visited.delete(id);
    return [...visited].map(value => this.objects.get(value)).filter((value): value is CodexObject => Boolean(value));
  }
  unreachableFrom(rootIds: readonly string[]): readonly CodexObject[] {
    const reached = new Set(rootIds);
    for (const root of rootIds) for (const object of this.descendants(root)) reached.add(object.id);
    return [...this.objects.values()].filter(object => !reached.has(object.id));
  }
  statistics(): GraphStatistics {
    const objectTypes: Record<string, number> = {};
    const languages: Record<string, number> = {};
    for (const object of this.objects.values()) {
      objectTypes[object.type] = (objectTypes[object.type] ?? 0) + 1;
      if (object.language) languages[object.language] = (languages[object.language] ?? 0) + 1;
    }
    let maxDepth = 0;
    for (const root of this.roots()) maxDepth = Math.max(maxDepth, this.depth(root.id, new Set()));
    return { objects: this.objects.size, relations: [...this.outgoing.values()].reduce((n, edges) => n + edges.length, 0), roots: this.roots().length, maxDepth, objectTypes, languages };
  }
  toJSON(): CodexProject { return structuredClone(this.project); }
  private depth(id: string, path: Set<string>): number {
    if (path.has(id)) return 0;
    const nextPath = new Set(path).add(id);
    const children = this.edgesFrom(id);
    return children.length === 0 ? 1 : 1 + Math.max(...children.map(edge => this.depth(edge.target, nextPath)));
  }
}

export function buildGraph(project: CodexProject): CodexGraph { return new CodexGraph(project); }
