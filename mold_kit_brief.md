# Mold-kit CAD brief

- Model: configurable plaster case-mold tooling generated in the browser from the current Formwheel profile or a user-supplied watertight STL.
- Task type: new multi-part printable tooling workflow and secondary STL outputs.
- Units: millimeters.
- Coordinate convention: browser preview is Y-up; downloaded STL files are converted to slicer-standard Z-up with the source centered on XY and based at Z = 0.
- Source handling: the current Formwheel source uses its wet-to-fired shrinkage compensation and receives an automatic flared slip well; uploaded STL sources can add shrinkage compensation and are normalized without changing proportions.
- Required parts: inner former with slip well, reusable left and right outer case halves, removable bottom ring, and four rounded registration natches for split plaster molds.
- Mold-making orientation: the former is inverted so its slip well seats in the bottom ring; plaster fills the circular space between the former and the close-fitting case.
- Default plaster envelope: 25 mm radial wall and 25 mm base above the inverted former.
- Default printed tooling: 2.4 mm case wall, 4 mm bottom ring, 14 mm clamp flanges, and 1.8 mm tongue-and-groove guide rails.
- Case form: circular two-piece open-top shell sized from the compensated radial envelope. Flat external flanges accept binder clips or bolts; guided seam rails control alignment and a gasket prevents leaks.
- Split plaster workflow: the horizontal parting plane is placed at the widest radial section. Four 12 mm rounded natches are pressed halfway into the clay bed so the first plaster half receives sockets and the second pour forms matching bumps.
- Output paths: runtime browser downloads named `<design>-inner-former.stl`, `<design>-case-left.stl`, `<design>-case-right.stl`, `<design>-bottom-ring.stl`, `<design>-registration-natches.stl`, plus a Markdown build sheet.
- Validation targets: every generated part is a closed two-manifold mesh with positive volume; STL export has Z as the height axis; plaster and case clearances match the configured values; each part fits the entered printer build volume or presents a visible warning.
- Assumptions: uploaded STL is repaired, watertight, and oriented with its intended mold mouth toward +Z. Arbitrary uploaded shapes receive the case envelope and conservative split-workflow guidance, but automatic parting-surface, slip-well, and undercut classification are limited to axial Formwheel profiles.
