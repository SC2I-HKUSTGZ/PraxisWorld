# PraxisWorld — Reference Knowledge Base

Interactive, section-organized map of every reference cited in the
**PraxisWorld** survey, plus a ready-to-open **Obsidian vault**.

Generated from the latest Overleaf snapshot
(`SC2I-HKUSTGZ/PraxisWorld` ← `git.overleaf.com/6a1822a2f4b5b567cc34d901`),
commit `12cd90c`. **181 references** cited across **7 sections / 22 subsections**
(188 total bib entries).

## What's here

| Path | What it is |
|------|------------|
| `index.html`, `app.js`, `style.css` | Self-contained interactive visualization (D3 v7, vendored in `lib/`). No build step. |
| `graph-data.json` | The knowledge graph (nodes, links, tree, full reference metadata + BibTeX), generated from the survey source. |
| `vault/` | A real **Obsidian vault**: open this folder in Obsidian to browse the same structure as an organic graph with backlinks. |
| `lib/d3.v7.min.js` | Vendored D3 (offline-safe). |

### The web visualization

- **Graph view** — Obsidian-style force graph. The survey is the hub; the seven
  sections fan out into their subsections and cited works, colored by section.
  References cited in several sections become visible *bridges*.
- **Tree view** — the survey's narrative tree (section → subsection → reference),
  collapsible.
- Hover to highlight a reference's neighborhood; click any node for a detail
  panel (authors, venue, year, every place it is cited, and copyable BibTeX).
- Search by title / author / key / venue; filter by section via the legend.

### The Obsidian vault (`vault/`)

```
vault/
  PraxisWorld.md              # home / map-of-content
  Sections/                   # one note per survey section (with subsection headings)
  References/<section>/<key>.md   # one note per reference, foldered by primary section
  .obsidian/                  # graph color-groups by section, ready to open
```

Each reference note carries front-matter (title, authors, year, venue, cite
count, section tags) and links back to every section/subsection that cites it,
so Obsidian's graph and backlink panes reconstruct the survey's citation
structure. Open `vault/` as a vault in Obsidian and open the graph view.

## Regenerating

From the survey workspace (`aot_survey/`):

```bash
python3 kb_build/extract.py     # parse sections + citations + references.bib -> structure.json
python3 kb_build/build_kb.py    # build vault/ and graph-data.json
```

## Local preview

```bash
cd ..            # the PraxisWorld site root
python3 -m http.server 8000
# open http://localhost:8000/knowledge-base/
```
