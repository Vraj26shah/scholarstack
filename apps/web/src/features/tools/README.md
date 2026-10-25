# The toolbox (free student tools)

Free tools that work without signing in. A student's data stays in their browser; nothing is
sent to the server.

| Folder | Tool | Key |
|---|---|---|
| `cgpa/` | CGPA calculator: this semester, overall, what you need next | `cgpa` |
| `attendance/` | Attendance calculator: exam eligibility, classes you can miss, marks | `attendance` |
| `timetable/` | Timetable maker: VIT Bhopal slot grid, clashes, image/PDF | `timetable` |

## How it's organised (SOLID)

```
tools/
  core/                 shared by every tool, knows no tool
    types.ts            ToolModule: what the site needs to know about a tool
    storage.ts          ToolStore contract + browser and memory stores + useToolState
    ui.tsx              ToolHeader, ToolCard, ResultPanel, Tabs, Labelled, field
  <tool>/
    domain.ts           the rules, as plain functions (no React, no storage): tested
    components/         one small piece of the screen per file
    <tool>-tool.tsx     composes the pieces; owns no rules
    index.ts            the tool's ToolModule (key, icon, screen)
  registry.ts           the list of ToolModules: the only place a new tool is added
  tool-page.tsx         /tools/:key, reads the registry and the admin's Features list
```

- **Single responsibility.** Rules live in `domain.ts`, persistence in `core/storage.ts`, export
  formats in `timetable/exporters/`, each screen part in its own component.
- **Open/closed.** A new tool is a new folder plus one line in `registry.ts`; a new timetable
  export is one new exporter file. Nothing existing is edited.
- **Liskov substitution.** Any `ToolStore` (browser, memory, a future account store) and any
  `TimetableExporter` works wherever one is expected.
- **Interface segregation.** `ToolStore` is just `load`/`save`; `TimetableExporter` is just
  `label` + `export(courses)`.
- **Dependency inversion.** Screens use `useToolState`, which depends on the `ToolStore`
  contract given by `ToolStoreProvider` (browser by default, memory in tests), never on
  `localStorage` directly.

## Adding a tool

1. Create `tools/<key>/` with `domain.ts`, `components/`, `<key>-tool.tsx` and `index.ts`
   (copy `attendance/` as the smallest example).
2. Add its module to `MODULES` in `registry.ts`.
3. Add tests for `domain.ts` in `src/test/tools.test.ts`.
4. In the site: Admin → Features & email → add a tool with the same key. It shows
   "Coming soon" until you press **Launch**, which also emails students who asked.

No outside scripts, fonts or libraries: the site's security rules block them, and tools should
look like the rest of the site.
