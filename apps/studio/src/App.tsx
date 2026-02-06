import { useMemo, useState } from "react";
import { compileWebSpec } from "@webspec/compiler";
import { REGISTRY, TARGETS } from "./registry";
import { SAMPLE_OK, SAMPLE_BAD } from "./sampleSpecs";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function pretty(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}

export default function App() {
  const [specText, setSpecText] = useState(SAMPLE_OK);
  const [selectedTarget, setSelectedTarget] = useState<string>(TARGETS[0]?.id ?? "");
  const [, setMode] = useState<"ok" | "bad">("ok");

  // Keep spec target in sync with dropdown (simple UX)
  const normalizedSpecText = useMemo(() => {
    const lines = specText.split("\n");
    const out = lines.map((l) => (l.startsWith("target:") ? `target: ${selectedTarget}` : l));
    return out.join("\n");
  }, [specText, selectedTarget]);

  const result = useMemo(() => {
    return compileWebSpec({ sourceText: normalizedSpecText, registry: REGISTRY });
  }, [normalizedSpecText]);

  const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">WebSpec Studio</h1>
          <p className="text-muted-foreground">
            Web-dev agent language with compile-time logic drift guardrails. Compiler refuses to produce a plan when rules
            fail.
          </p>
        </header>

        <div className="flex gap-3 flex-wrap items-center">
          <Badge variant={errorCount ? "destructive" : "secondary"}>
            {errorCount ? `${errorCount} compile error(s)` : "Compile OK"}
          </Badge>

          <div className="w-[360px]">
            <Select value={selectedTarget} onValueChange={setSelectedTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select target" />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setMode("ok");
              setSpecText(SAMPLE_OK);
            }}
          >
            Load OK spec
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMode("bad");
              setSpecText(SAMPLE_BAD);
            }}
          >
            Load BAD spec
          </Button>
        </div>

        <Tabs defaultValue="spec">
          <TabsList>
            <TabsTrigger value="spec">Spec</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="plan">Plan IR</TabsTrigger>
          </TabsList>

          <TabsContent value="spec" className="mt-4">
            <Card className="p-4 space-y-3">
              <div className="text-sm text-muted-foreground">
                Edit YAML below. The compiler runs live; it will STOP if target/macros/effects/proofs fail.
              </div>
              <Textarea
                className="min-h-[360px] font-mono text-xs"
                value={normalizedSpecText}
                onChange={(e) => setSpecText(e.target.value)}
              />
            </Card>
          </TabsContent>

          <TabsContent value="diagnostics" className="mt-4">
            <Card className="p-4">
              <ScrollArea className="h-[420px] rounded-md border p-3">
                <pre className="text-xs">{pretty(result.diagnostics)}</pre>
              </ScrollArea>
            </Card>
          </TabsContent>

          <TabsContent value="plan" className="mt-4">
            <Card className="p-4">
              <ScrollArea className="h-[420px] rounded-md border p-3">
                <pre className="text-xs">{result.plan ? pretty(result.plan) : "No plan produced (compile failed)."}</pre>
              </ScrollArea>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="text-xs text-muted-foreground">
          Tip: Try selecting a different target, or load the BAD spec to see the compiler stop you.
        </footer>
      </div>
    </div>
  );
}
