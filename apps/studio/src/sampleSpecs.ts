export const SAMPLE_OK = `lang: webspec/v0.1
target: react-vite-shadcn-tailwind4
project:
  name: demo-app
workspace:
  aiDir: .ai
  keepTracked:
    - .ai/README.md
    - .ai/.gitkeep
ui:
  shadcn:
    components: [button, card, tabs, textarea]
routes:
  - { path: "/", page: "Home" }
  - { path: "/playground", page: "Playground" }
quality:
  gates:
    - "pnpm -C apps/web add react-router-dom"
`;

export const SAMPLE_BAD = `lang: webspec/v0.1
target: unknown-target
project:
  name: bad
workspace:
  aiDir: .ai
  keepTracked: [".ai/README.md", ".ai/.gitkeep"]
`;
