import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const stub = pathToFileURL(path.join(root, "scripts", "vue-stub.mjs")).href;
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".vue")) return { url: stub, shortCircuit: true };
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(src, specifier.slice(2));
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))
    base = path.resolve(
      path.dirname(fileURLToPath(context.parentURL)),
      specifier,
    );
  if (base) {
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`])
      if (isFile(candidate))
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return next(specifier);
}
