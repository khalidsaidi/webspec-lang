# Decision Tree Store

This directory contains the **canonical decision tree** used to keep agents on track.

## Format

`tree.json` stores the decision tree and index for fast lookup:

```json
{
  "nodes": {
    "DEC-01": {
      "id": "DEC-01",
      "parent": null,
      "question": "Which build tool should the Studio use?",
      "answer": "Vite",
      "rationale": "Fast dev server + static deploy",
      "status": "final",
      "confidence": 0.86,
      "evidence": ["README.md#WebSpec (v0.2)"],
      "children": []
    }
  },
  "index": {
    "roots": ["DEC-01"],
    "byId": {
      "DEC-01": { "parent": null, "children": [] }
    }
  }
}
```

## Usage

- CLI will load `decisions/tree.json` automatically unless overridden with `--decisions`.
- Specs can reference decisions by id via `steps[].decisions`.
- The compiler enforces that every action step references **final** decisions.
