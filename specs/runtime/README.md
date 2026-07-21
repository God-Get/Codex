# CODEX Runtime 0.2

The CODEX runtime layer consists of three packages:

- `@codex/importer` compiles deterministic Markdown/YAML source trees into `CodexProject` values.
- `@codex/graph` builds indexed, traversable project graphs.
- `@codex/query` evaluates deterministic object predicates over a project graph.

## Importer

```sh
codex-import reference/hermetica --output=hermetica.json --json
```

The importer recursively scans Markdown files, ignores hidden directories, `node_modules`, and `dist`, sorts paths deterministically, reads `project.yml` or `project.yaml`, and emits a CODEX project. Source body and location are preserved in object metadata.

## Graph

```ts
import { buildGraph } from "@codex/graph";

const graph = buildGraph(project);
const roots = graph.roots();
const descendants = graph.descendants("WORK-CH", ["contains"]);
const statistics = graph.statistics();
```

Edges preserve their declared direction. `derivedFrom` is represented as an edge from the derived object to its source object.

## Query

```sh
codex-query hermetica.json "type=translation AND language=ru" --json
```

The 0.2 query grammar supports equality predicates joined by case-insensitive `AND`. Supported fields are `id`, `type`, `title`, `version`, `status`, `language`, and nested `metadata.*` paths.

## Machine contract

Both runtime CLIs use the CODEX CLI API 0.2 envelope.

Success:

```json
{
  "ok": true,
  "apiVersion": "0.2",
  "command": "query.execute",
  "result": {}
}
```

Failure:

```json
{
  "ok": false,
  "apiVersion": "0.2",
  "command": "query.execute",
  "diagnostic": {
    "code": "QUERY-1002",
    "message": "..."
  }
}
```

Machine-readable successes are written to stdout. Machine-readable failures are written to stderr with a non-zero exit code.
