import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();

const fromTinyMdeEntry = resolve(root, "node_modules/@betamark/tinymde/build/index.js");
const fromPurifyJs = resolve(root, "node_modules/dompurify/dist/purify.min.js");
const fromMarkdownItEntry = resolve(root, "node_modules/markdown-it/index.mjs");

const toVendor = resolve(root, "public/vendor");
const toTinyMdeJs = resolve(toVendor, "tinymde.js");
const toPurifyJs = resolve(toVendor, "purify.min.js");
const toMarkdownItJs = resolve(toVendor, "markdown-it.min.js");
const staleVendorEntries = [
    "marked.min.js",
    "easymde.min.css",
    "easymde.min.js",
    "fontawesome",
    "toastui-editor.css",
    "toastui-editor.js"
];

if (
    !existsSync(fromTinyMdeEntry) ||
    !existsSync(fromPurifyJs) ||
    !existsSync(fromMarkdownItEntry)
) {
    throw new Error("依赖资源不存在，请先执行 npm install");
}

mkdirSync(toVendor, { recursive: true });

await build({
    absWorkingDir: root,
    stdin: {
        contents: `import TinyMDEModule from "@betamark/tinymde";

const TinyMDEPrototype = TinyMDEModule?.default ?? TinyMDEModule;

window.TinyMDE = {
    prototype: TinyMDEPrototype,
    create(selector, options = {}) {
        if (typeof TinyMDEPrototype === "function") {
            return new TinyMDEPrototype(selector, options);
        }

        const instance = Object.create(TinyMDEPrototype);
        instance.init(selector, options);
        return instance;
    }
};`,
        resolveDir: root,
        sourcefile: "tinymde-entry.js",
        loader: "js"
    },
    outfile: toTinyMdeJs,
    bundle: true,
    format: "iife",
    platform: "browser",
    minify: true,
    legalComments: "none",
    target: ["es2019"]
});
cpSync(fromPurifyJs, toPurifyJs);

await build({
    absWorkingDir: root,
    stdin: {
        contents: `import MarkdownItModule from "markdown-it";
window.MarkdownIt = MarkdownItModule?.default ?? MarkdownItModule;`,
        resolveDir: root,
        sourcefile: "markdown-it-entry.js",
        loader: "js"
    },
    outfile: toMarkdownItJs,
    bundle: true,
    format: "iife",
    platform: "browser",
    minify: true,
    legalComments: "none",
    target: ["es2019"]
});

for (const entry of staleVendorEntries) {
    rmSync(resolve(toVendor, entry), { recursive: true, force: true });
}

console.log("Vendor assets synced to public/vendor");
