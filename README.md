# ptl.inc

The Predictive Text Labs landing page. Six beats of an argument, over a film
that is **drawn, not filmed**.

## What this is

No video, no image sequence, no animation library, no framework, no build step.
The whole film is one WebGL2 fragment shader — `src/ptl-field.js` — and scroll
is its only clock. Every position on the page is a pure function of `scrollY`,
so there is nothing to seek, buffer or decode; dragging the scrollbar backwards
runs the film backwards exactly.

The reason is in the shader's own header: the reference set this was art
directed against (Algolia, Pulse, 1-bit posters) is *graphic*, not
photographic. Every one of those images is a single coherent form built from a
regular grid of marks falling off into black. You cannot get that by crushing a
photograph to 1-bit — crushing a photograph gives you noise. You get it by
drawing the grid. The output stage is a **halftone**, not a dither: marks sit on
a rigid lattice and their SIZE carries the image (`s = sqrt(luminance)`, so area
is proportional to light). Fixed-size on/off marks read as a dot-matrix printer;
size modulation reads as print.

## Files

    index.html          the page: chrome, the copy, and all of its CSS
    about.html          placeholder
    src/ptl-field.js    the renderer — one shader, three treatments (FORM ships)
    src/ptl-page.js     the choreography: scroll -> section -> type and field
    fonts/              Cormorant (+italic), Geist Mono, Inter — all local

**The copy is in `index.html`, not in the JavaScript.** Every visible word is
drawn into scroll-choreographed containers, which would otherwise leave a
crawler, a link preview and a screen reader with a page containing no words at
all. So the argument lives in `#story` as ordinary semantic HTML and the script
reads it out of the DOM. One source of truth. Edit the copy there.

## Develop

    pnpm dev            serve at http://localhost:8777
    pnpm verify         oxlint + knip + jscpd

## Deploy

Static, published from the repository root. Both `netlify.toml` and
`vercel.json` set an empty build command — there is nothing to compile, so
there is nothing that can fail at deploy time. Fonts are served immutable for a
year.

## Accessibility

- The full argument is in the DOM and in reading order; the rendered copy is
  `aria-hidden`, so it is never announced twice.
- `prefers-reduced-motion` holds every section fully resolved, stops the caret
  blinking, and disables the pointer-lit mark.
- Without JavaScript the copy stops hiding and sets itself as a document.
