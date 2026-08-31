import { copyFile, mkdir, rm } from "node:fs/promises";

const outputDirectory = new URL("./dist/", import.meta.url);
const appFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "geometry.js",
  "mold.js",
  "mold-geometry.js",
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all(
  appFiles.map((file) =>
    copyFile(new URL(`./${file}`, import.meta.url), new URL(file, outputDirectory)),
  ),
);

console.log(`Built Formwheel into dist/ (${appFiles.length} files).`);
