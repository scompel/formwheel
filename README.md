# Formwheel

Formwheel is an offline, browser-based pottery profile visualizer. Draw one side of a vessel, see the revolved form immediately, and download either a positive former for plaster mold making or a hollow vessel for direct 3D printing.

## Open it

The app has no dependencies and works directly from `index.html`. For the most predictable browser behavior, run:

```sh
npm run serve
```

Then open <http://127.0.0.1:4173/>.

## Production build

Formwheel has no runtime dependencies. Create the deployable static site with:

```sh
npm install
npm run build
```

The finished site is written to `dist/`.

## Core workflow

1. Pick a preset and drag the profile handles. Click empty space to add a handle; double-click an interior handle to remove it.
2. Enter the desired final fired height and diameter.
3. Enter the measured wet-to-fired shrinkage of the clay body.
4. Check the mold warning. Green profiles can pull upward from a one-piece plaster mold; red profile segments indicate an undercut that needs a split mold.
5. Download the former STL. Its dimensions are enlarged by `1 / (1 - shrinkage)` so the fired casting returns to the target dimensions.

The vessel STL is a separate hollow export for direct FDM printing and uses the entered wall and base thicknesses.

## Important scope boundary

The Mold kit workspace generates a shrinkage-compensated inner former with slip well, guided circular case halves with clamp flanges, a bottom ring, and four rounded registration natches for split plaster workflows. Axial Formwheel profiles receive the complete automatic case system. Uploaded STL files receive a printable envelope and split-workflow guidance, but their parting surface, slip opening, and undercuts still require a mold-maker’s judgment.

## Verification

```sh
npm test
```

The tests cover profile interpolation, shrinkage compensation, undercut classification, target dimensions, visible cap winding, binary STL structure, positive volume, and closed two-manifold topology for vessel, former, case, ring, and natch exports.
