import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import tasks from "markdown-it-task-lists";
import katex from "katex";
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const EXTERNAL_LINK = /^(https?:|mailto:|obsidian:)/;
export function renderer() {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true })
    .use(footnote)
    .use(mark)
    .use(tasks, { enabled: false });
  md.inline.ruler.before("emphasis", "obsidian", (state, silent) => {
    const start = state.pos,
      rest = state.src.slice(start);
    const wiki = /^(!?)\[\[([^\]\n]+)\]\]/.exec(rest);
    const comment = /^%%[\s\S]*?%%/.exec(rest);
    const math = /^\$([^$\n]+)\$/.exec(rest);
    if (!wiki && !comment && !math) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      if (wiki) {
        const [target, label] = wiki[2].split("|");
        // 外部網址改走 href，交給 DOMPurify 驗證協定；data-note 只代表 vault 內部連結。
        token.content = wiki[1]
          ? `<span class="embed" data-embed="${escapeHtml(target)}">${escapeHtml(label || target)}</span>`
          : EXTERNAL_LINK.test(target)
            ? `<a href="${escapeHtml(target)}">${escapeHtml(label || target)}</a>`
            : `<a href="#" data-note="${escapeHtml(target)}">${escapeHtml(label || target)}</a>`;
      } else if (math) {
        try {
          token.content = katex.renderToString(math[1], {
            throwOnError: false,
            trust: false,
          });
        } catch {
          token.content = escapeHtml(math[0]);
        }
      } else token.content = "";
    }
    state.pos += (wiki?.[0] || comment?.[0] || math?.[0] || "").length;
    return true;
  });
  md.block.ruler.before("fence", "math_block", (state, start, end, silent) => {
    const line = state.getLines(start, start + 1, 0, false).trim();
    if (!line.startsWith("$$")) return false;
    let next = start + 1,
      body = "";
    if (line.length > 4 && line.endsWith("$$")) body = line.slice(2, -2);
    else {
      for (; next < end; next++) {
        const l = state.getLines(next, next + 1, 0, false);
        if (l.trim() === "$$") break;
        body += l + "\n";
      }
      if (next === end) return false;
      next++;
    }
    if (!silent) {
      const t = state.push("html_block", "", 0);
      t.content = katex.renderToString(body, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
      t.map = [start, next];
    }
    state.line = next;
    return true;
  });
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) =>
    tokens[idx].info.trim() === "mermaid"
      ? `<pre class="mermaid">${escapeHtml(tokens[idx].content)}</pre>`
      : fence(tokens, idx, options, env, self);
  const heading = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
    tokens[i].attrSet("id", tokens[i + 1].content);
    return heading
      ? heading(tokens, i, options, env, self)
      : self.renderToken(tokens, i, options);
  };
  return md;
}
export function renderMarkdown(md: MarkdownIt, source: string) {
  let properties = "";
  source = source.replace(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
    (_, yaml) => {
      properties = `<details class="properties"><summary>Properties</summary><pre>${escapeHtml(yaml)}</pre></details>`;
      return "";
    },
  );
  return properties + md.render(source);
}
