const path = require('node:path');

const here = (...p) => path.resolve(__dirname, ...p);

// Bundles the Elysia `App` type into a single, self-contained declaration the
// frontend consumes via Eden Treaty — so the frontend can typecheck and build
// without the backend source or the backend's node_modules in scope.
//
// Regenerate after changing the API surface:  npm run gen:types
// External imports left in the output — `elysia` (Eden's peer dependency) and
// `kysely` (already a transitive dependency of `better-auth`) — are both
// already present in the frontend's own node_modules, so nothing extra needs
// installing. Inlining kysely here instead would balloon this file with its
// whole query-builder surface (~19k lines vs. ~1.3k) for no benefit.
module.exports = {
  compilationOptions: { preferredConfigPath: here('tsconfig.json') },
  entries: [
    {
      filePath: here('src/index.ts'),
      outFile: here('../frontend/src/__generated__/app.d.ts'),
      noCheck: true,
      output: { exportReferencedTypes: false },
    },
  ],
};
