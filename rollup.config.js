import copy from "rollup-plugin-copy";
import dts from "rollup-plugin-dts";
import esbuild from "rollup-plugin-esbuild";

const externalRegex = /^[./]/;

// package.json "main" is build/index.cjs: this package is
// "type": "module", so a CommonJS bundle written to a .js file is
// loaded by Node as ESM and dies on its `exports` references
// ("exports is not defined") for every require() consumer. The bundle
// base name is derived from "main" with whatever extension it carries.
const name = require("./package.json").main.replace(/\.[^.]+$/, "");

const bundle = (config) => ({
  ...config,
  input: "src/index.ts",
  external: (id) => !externalRegex.test(id),
});

export default [
  bundle({
    plugins: [
      esbuild(),
      copy({
        targets: [{ src: "src/tokens/**/*", dest: "build/tokens" }],
      }),
    ],
    output: [
      {
        file: `${name}.cjs`,
        format: "cjs",
        sourcemap: true,
      },
      {
        file: `${name}.es.js`,
        format: "es",
        sourcemap: true,
      },
    ],
  }),
  bundle({
    plugins: [dts()],
    output: {
      file: `${name}.d.ts`,
      format: "es",
    },
  }),
];
