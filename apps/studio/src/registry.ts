import viteStack from "./stacks/react-vite-shadcn-tailwind4.json";
import nextStack from "./stacks/next-app-shadcn-tailwind4.json";

export const REGISTRY: Record<string, any> = {
  [viteStack.id]: viteStack,
  [nextStack.id]: nextStack
};

export const TARGETS = Object.values(REGISTRY).map((m: any) => ({
  id: m.id,
  name: m.displayName ?? m.id
}));
