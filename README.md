# RegionScope

RegionScope is a fast, static Minecraft region-coordinate explorer. It renders an infinite X/Z grid procedurally in the browser—no world files, map tiles, or map data are uploaded or displayed.

## Features

- Smooth pan and zoom on an infinite coordinate plane
- Familiar Cartesian orientation with positive X to the right and positive Z upward
- Canvas-rendered adaptive grid with chunk, region, and major lines
- Region labels at close zoom levels
- Search for region files such as `r.-2.3.mca`
- Search for block coordinates such as `1200 -540`
- Highlighted search results and click-to-inspect region bounds
- Block-level grid and exact block selection at maximum zoom
- Live block, chunk, and region coordinates under the cursor
- Configurable origin-centered world-border drawing tool
- Unlimited two-corner area selections with automatic colors and saved coordinate lists
- Correct negative-coordinate conversion using `Math.floor()`
- Responsive light and dark themes
- Static GitHub Pages deployment

Each chunk is 16 × 16 blocks. Each region is 32 × 32 chunks, or 512 × 512 blocks. Region files follow Minecraft's `r.<x>.<z>.mca` naming convention.

## Local development

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/Chesvin1/RegionScope.git
cd RegionScope
npm install
npm run dev
```

Open the local URL printed by Vite. To verify a production build:

```bash
npm run build
npm run preview
```

The production files are generated in `dist/`.

## Deploy to GitHub Pages

The repository includes a GitHub Actions workflow that builds and deploys the site whenever `main` is pushed.

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main`, or run **Deploy to GitHub Pages** manually from the **Actions** tab.

For this repository, Vite's base path is set to `/RegionScope/` in `vite.config.ts`. If the repository is renamed, update that value to match the new repository name.

The published URL will be:

```text
https://chesvin1.github.io/RegionScope/
```

## Project structure

```text
src/
  coordinates.ts  Coordinate conversions and region bounds
  grid-layer.ts   Canvas-based Leaflet grid with adaptive detail
  main.ts         Map interactions, search, selection, and theme behavior
  search.ts       Region-name and block-coordinate parsing
  style.css       Responsive light and dark interface
```

## Privacy and scope

RegionScope runs entirely in the browser. It has no backend, database, authentication, analytics, or file-upload feature. It visualizes coordinate boundaries only—not Minecraft terrain or world content.

## License

MIT
