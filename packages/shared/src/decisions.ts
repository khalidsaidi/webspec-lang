import { DecisionTree, DecisionTreeNode, WebSpecDecision } from "./types";

export function buildDecisionTree(decisions: WebSpecDecision[]): DecisionTree {
  const nodes: Record<string, DecisionTreeNode> = {};

  for (const d of decisions) {
    if (nodes[d.id]) throw new Error(`Duplicate decision id: ${d.id}`);
    nodes[d.id] = { ...d, parent: d.parent ?? null, children: [] };
  }

  for (const d of Object.values(nodes)) {
    const parent = d.parent ?? null;
    if (parent) {
      const p = nodes[parent];
      if (!p) throw new Error(`Decision "${d.id}" references missing parent: ${parent}`);
      p.children.push(d.id);
    }
  }

  const roots = Object.values(nodes)
    .filter((n) => !n.parent)
    .map((n) => n.id);

  // Cycle detection via DFS
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Decision tree cycle detected at: ${id}`);
    visiting.add(id);
    for (const child of nodes[id]?.children ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  }

  for (const root of roots) visit(root);

  const byId: DecisionTree["index"]["byId"] = {};
  for (const [id, node] of Object.entries(nodes)) {
    byId[id] = { parent: node.parent ?? null, children: [...node.children] };
  }

  return { nodes, index: { roots, byId } };
}
