# Obsidian canvas for DeepSeek Harness

This bundle opens [JSON Canvas](https://jsoncanvas.org/spec/1.0/) files (`.canvas`, the format Obsidian Canvas uses) in the DSH Web GUI. Click a `.canvas` file in the Files sidebar, or in a chat message, and it opens in the right sidebar as an editable canvas. Edits save back to the same file.

## What works

- Text cards render Markdown: headings, emphasis, lists, task lists, tables, code blocks, quotes, callouts, links, wikilinks, tags, and embedded images.
- File cards show Markdown notes (with `#Heading` and `#^block` subpaths), images, video, audio, and PDFs from the vault.
- Link cards embed the web page. Double-click to interact with it.
- Groups have labels, colors, and background images. Moving a group moves the cards inside it.
- Edges connect card sides with curves, arrowheads, labels, and colors. Drag an edge end to reconnect it.
- The six Obsidian preset colors and custom hex colors work on cards, groups, and edges.

## Controls

| Action | How |
| --- | --- |
| Pan | Scroll, Space + drag, or middle-drag |
| Zoom | Ctrl/Cmd + scroll, pinch, or the zoom buttons |
| New card | Double-click empty canvas, or click/drag a button in the bottom toolbar |
| Edit a card | Double-click it, or select it and press Enter |
| Select | Click, Shift + click, or drag a box on empty canvas |
| Connect | Drag from a dot on a card side to another card; release on empty canvas to create a connected card |
| Resize | Drag a selected card's edge or corner |
| Duplicate | Alt + drag, or Cmd/Ctrl + D |
| Copy, cut, paste | Cmd/Ctrl + C, X, V. Pasting text makes a card; pasting a URL makes a web page card |
| Remove | Delete or Backspace |
| Undo, redo | Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z |
| Zoom to fit, to selection, to 100% | Shift + 1, Shift + 2, Shift + 0 |
| Nudge | Arrow keys (Shift for 20 px) |

Right-click opens a context menu. The gear button toggles snap to grid.

## Files and the vault

A canvas's vault root is the nearest parent folder that holds `.obsidian`, otherwise the nearest one that holds `.git`, otherwise the canvas's own folder. File cards and "Add note from vault" use paths relative to that root, the same way Obsidian stores them. The Host refuses files outside the root.

## How it is built

- `client.js` registers a document preview for the `canvas` extension and its body in the `sidebar.right.tab.document` slot. It is plain JavaScript with no build step.
- `index.js` adds three authenticated Web routes: `POST /obsidian-canvas/save` replaces an existing `.canvas` file atomically after checking the text is a JSON object, `GET /obsidian-canvas/vault` lists vault files, and `GET /obsidian-canvas/file` serves one vault file.
- Saving keeps unknown top-level keys and entries it cannot place, and writes with tab indentation like Obsidian.

Optional row configuration in `cordis.patch.yml`: `maxCanvasBytes` (default 32 MiB), `maxFileBytes` (default 64 MiB), `maxVaultFiles` (default 5000).

## Limits

- The save route writes through the Host directly, so the session's file sandbox does not apply to it. It only replaces files that already exist and end in `.canvas`.
- To create a new canvas, create an empty `.canvas` file first (an empty file opens as an empty canvas).
- Embedded notes refresh when the canvas reloads, not when the note changes on its own.
- Web pages that forbid framing show the browser's blocked-frame page.
- Clicking a wikilink or file card does not open that note yet.
