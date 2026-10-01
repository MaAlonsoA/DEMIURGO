// The project's code map (GET /api/projects/:id/code-map; core build/project-map.ts).

export type CodeMapFeature = {
  code: string;
  title: string;
  tasks: { code: string; title: string }[];
  folders: { dir: string; files: string[] }[];
};
export type CodeMapHotspot = { path: string; tasks: number; of: number; features: string[] };
export type CodeMapOwner = { name: string; feature: string; task: string };
export type CodeMap = {
  merged_tasks: number;
  hotspots: CodeMapHotspot[];
  features: CodeMapFeature[];
  tables: CodeMapOwner[];
  routes: CodeMapOwner[];
};
