# Visual PR body

Use when people can see the change, directly or not: layout, color, copy, motion, tooltips,
charts, emails, generated images.

````md
- <What people see differently, and why it was worth changing.>
- <A state, theme or breakpoint that behaves differently from the rest.>

`/settings` with mock data, 1440×900 @2x.

| State | Before (`main`) | After (this PR) |
| --- | --- | --- |
| Default | ![before](./before-default.png) | ![after](./after-default.png) |
| Hover | ![before](./before-hover.png) | ![after](./after-hover.png) |
| Dark | ![before](./before-dark.png) | ![after](./after-dark.png) |
| Mobile | ![before](./before-mobile.png) | ![after](./after-mobile.png) |
| Empty | none | ![after](./after-empty.png) |

| Before | After |
| --- | --- |
| <video src="./before.mp4" controls></video> | <video src="./after.mp4" controls></video> |

```tsx
// optional: the one prop or token behind the new look
<Tooltip layout="rows" variant="frosted-glass" maxRows={8} />
```
````

How:

- Capture both columns with the same viewport, theme, dpr and data. Before comes from the target
  branch, after from the PR branch.
- Show every state that can differ: empty, one item, many items, light and dark, a narrow
  viewport. Skip states that look the same.
- Crop to the changed area. A full-page shot hides the change.
- Motion goes in a video row.
- Annotate every screenshot (below), then upload with `--attach`. Do not commit images.

## Annotated screenshots

Use the `annotate` skill (install steps in `../SKILL.md`). It can capture the page itself, so
every arrow lands on the exact element that changed.

1. Run the target branch where you can reach it: a git worktree on another port, or its preview
   deploy. Never stash or reset the PR branch to get the "before".
2. Write one capture spec per cell, with the same `url` path, `clip`, `viewport` and
   `colorScheme` on both sides. Before notes say what was wrong; after notes say what changed.

   ```json
   {
     "url": "http://localhost:3001/settings",
     "clip": "#billing-card",
     "out": "before-default.png",
     "notes": [
       { "text": "plan name and price fight for attention", "target": ".plan-header" },
       { "text": "cancel sits right next to upgrade", "target": "button.cancel", "mark": "circle" }
     ]
   }
   ```

   ```json
   {
     "url": "http://localhost:3000/settings",
     "clip": "#billing-card",
     "out": "after-default.png",
     "notes": [
       { "text": "price leads, plan name steps back", "target": ".plan-header" },
       { "text": "cancel moved to the overflow menu", "target": "button.more" }
     ]
   }
   ```

3. Run `annotate before-default.json` and `annotate after-default.json`, read the warnings and
   look at both PNGs. Fix anything off (the annotate skill's verify step) before uploading.
4. Reference the PNGs in the table and attach them with `gh pr edit --attach`.

Notes:

- Lowercase, 2 to 8 words, the why or what changed. Never describe what is already visible.
- 1 to 3 notes per screenshot, only on what this PR changed.
- Point at the exact element: the icon, not the card around it.
- One annotated image per cell, so the table still reads row by row.
