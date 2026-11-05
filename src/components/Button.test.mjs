import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "@astrojs/compiler-rs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ts from "typescript";

test("Button's native tag attributes type-check", async () => {
  const source = await readFile(new URL("./Button.astro", import.meta.url), "utf8");
  const [, script, template] = source.split("---");
  const markup = template.slice(0, template.indexOf("<style>"));
  const filename = new URL("./Button.typecheck.tsx", import.meta.url).pathname;
  const code = `${script}\ndeclare const Astro: { props: Props };\n<>${markup}</>;`;
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    module: ts.ModuleKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "astro",
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...rest) =>
    file === filename
      ? ts.createSourceFile(file, code, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(file, languageVersion, ...rest);
  const program = ts.createProgram([filename], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(
    errors.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
});

test("Button renders variants, children, native attributes, and loading state", async () => {
  const { code } = transform(await readFile(new URL("./Button.astro", import.meta.url), "utf8"), {
    filename: "src/components/Button.astro",
    internalURL: import.meta.resolve("astro/compiler-runtime"),
    resultScopedSlot: true,
    resolvePath: (specifier) => specifier,
  });
  const compiled = code.replace(/^import ".*\.css";$/gm, "");
  const { default: Button } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  const container = await AstroContainer.create();
  const render = (props = {}) =>
    container.renderToString(Button, { props, slots: { default: "<strong>Save</strong>" } });

  const normal = await render();
  assert.match(normal, /brush-link/);
  assert.match(normal, /type="button"/);
  assert.match(normal, /<strong>Save<\/strong>/);
  assert.match(normal, /aria-busy="false"/);
  assert.doesNotMatch(normal, / disabled|class="spinner/);

  for (const variant of ["brush", "paper", "link"]) {
    const html = await render({ variant, loading: true, class: "custom", type: "submit" });
    assert.match(html, new RegExp(variant === "link" ? "\\blink\\b" : `${variant}-link`));
    assert.match(html, /custom/);
    assert.match(html, /type="submit"/);
    assert.match(html, / disabled/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /class="spinner[^"]*" aria-hidden="true"/);
    assert.match(html, /<strong>Save<\/strong>/);
  }
  assert.match(await render({ disabled: true }), / disabled/);

  const anchor = await render({ as: "a", href: "/about", target: "_blank", hidden: true });
  assert.match(anchor, /<a\b/);
  assert.match(anchor, /href="\/about"/);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, / hidden/);
  assert.doesNotMatch(anchor, / type=| disabled/);
  assert.match(
    await render({ as: "a", href: "/art.svg", type: "image/svg+xml" }),
    /type="image\/svg\+xml"/,
  );

  for (const props of [{ loading: true }, { disabled: true }]) {
    const html = await render({ as: "a", href: "/about", ...props });
    assert.match(html, /<a\b/);
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /role="link"/);
    assert.match(html, /tabindex="-1"/);
    assert.doesNotMatch(html, / href=| disabled/);
  }
});
