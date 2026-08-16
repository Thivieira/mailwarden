/**
 * Compiles `src/ui/**\/*.tsx` through babel-preset-solid in SSR mode into sibling
 * `*.gen.js` files, which the Elysia routes import.
 *
 * Wrangler bundles with esbuild and exposes no plugin hook, so Solid's JSX compiler
 * cannot run inside the Worker build. Precompiling here ships the pages as compiled SSR
 * templates - string concatenation with no runtime JSX factory - which is both the
 * fastest option and the only one wrangler can consume.
 *
 * Output lands beside each source so relative imports of plain `.ts` helpers resolve
 * identically before and after compilation.
 */
import { transformAsync } from "@babel/core";
// @ts-expect-error - babel-preset-solid ships no types
import solid from "babel-preset-solid";
import typescript from "@babel/preset-typescript";
import { Glob } from "bun";
import { dirname, join, relative, resolve } from "node:path";
import { mkdir, unlink } from "node:fs/promises";

const UI_DIR = import.meta.dir;

export async function buildUi() {
  const sources = [...new Glob("**/*.tsx").scanSync({ cwd: UI_DIR })];
  const compiled = new Set(sources.map((s) => resolve(UI_DIR, s)));

  // Drop stale output so a deleted component cannot keep shipping.
  for (const stale of new Glob("**/*.gen.js").scanSync({ cwd: UI_DIR })) {
    await unlink(join(UI_DIR, stale));
  }

  for (const source of sources) {
    const absolute = join(UI_DIR, source);
    const code = await Bun.file(absolute).text();

    const result = await transformAsync(code, {
      filename: absolute,
      babelrc: false,
      configFile: false,
      presets: [typescript, [solid, { generate: "ssr", hydratable: false }]],
    });

    if (!result?.code) throw new Error(`babel produced no output for ${source}`);

    // A relative specifier that names another compiled component must point at its
    // generated sibling; specifiers naming plain .ts helpers are left alone.
    const emitted = result.code.replace(
      /(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g,
      (match, head: string, spec: string, tail: string) => {
        const bare = spec.replace(/\.(tsx|jsx)$/, "");
        return compiled.has(resolve(dirname(absolute), `${bare}.tsx`))
          ? `${head}${bare}.gen.js${tail}`
          : match;
      }
    );

    const target = join(UI_DIR, source.replace(/\.tsx$/, ".gen.js"));
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, emitted);
  }

  return { count: sources.length, dir: relative(process.cwd(), UI_DIR) };
}

if (import.meta.main) {
  const { count, dir } = await buildUi();
  console.log(`ui: compiled ${count} component${count === 1 ? "" : "s"} -> ${dir}/*.gen.js`);
}
