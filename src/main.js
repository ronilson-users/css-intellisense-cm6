import plugin from "../plugin.json";

/**
 * CSS Intellisense
 * Suggests CSS/SCSS/LESS/Stylus classes and IDs from project stylesheets.
 */

const cm = acode.require("codemirror");

const { autocompletion } = cm.autocomplete;
const { StateEffect, Compartment, EditorState } = cm.state;

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".styl"];
const VALID_EXTENSIONS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "html",
  "htm",
  "vue",
  "svelte",
  "astro",
  "php",
  "mdx",
  "njk",
  "twig",
  "hbs",
  "ejs",
  "erb",
];

const IGNORED_PATH =
  /(^|\/)(node_modules|dist|build|coverage|\.git|\.next|\.nuxt)(\/|$)/i;
const MINIFIED = /\.min\.(css|scss|less|styl)$/i;
const COMMAND_REFRESH = "cssIntellisense.refresh";
const COMMAND_STATUS = "cssIntellisense.status";

const isCssFile = (name = "") =>
  CSS_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

const isIgnored = (url = "") => {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch (_) {}
  return IGNORED_PATH.test(decoded) || MINIFIED.test(decoded);
};

const decodeSafe = (text) => {
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text;
  }
};

class CSSIntellisense {
  constructor() {
    this.fileIndex = null;
    this.extensions = new Compartment();
    this.cssCache = new Map();
    this._cmExtensions = null;
    this._extensionWatcher = null;
    this._handlers = {};
    this._loadToken = 0;
    this._initAttempts = 0;
    this._destroyed = false;
    this.cssCompletionSource = this.cssCompletionSource.bind(this);
  }

  //----------------------------------------------------------------- */
  // Lifecycle                                                          */
  // ------------------------------------------------------------------ */

  async init() {
    if (this._destroyed) return;

    if (!editorManager.editor) {
      if (this._initAttempts++ < 10) {
        this._initTimer = setTimeout(() => this.init(), 500);
      } else {
        console.warn("[CSS Intellisense] Editor never became ready.");
      }
      return;
    }

    this.fileIndex = acode.require("fileIndex");
    if (!this.fileIndex?.query) {
      console.warn(
        "[CSS Intellisense] fileIndex unavailable; using fileList fallback.",
      );
    }

    this.setupEventListeners();
    this.injectStyles();
    this.setupCommands();

    // Do NOT use `override` here: it replaces every completion source of the
    // editor (including those registered by other plugins). Registering the
    // source through languageData lets CodeMirror merge it with the others.
    this._cmExtensions = [
      autocompletion({
        closeOnBlur: true,
        defaultKeymap: true,
        optionClass: (completion) =>
          `cm-completion-${completion.type || "default"}`,
      }),
      EditorState.languageData.of(() => [
        { autocomplete: this.cssCompletionSource },
      ]),
    ];

    this.ensureExtensionActive();

    // Safety net for tabs created without a "switch-file" event.
    this._extensionWatcher = setInterval(
      () => this.ensureExtensionActive(),
      3000,
    );

    window.toast?.("🔄 Loading CSS cache...", 1500);
    try {
      await this.refreshCssCache({ retries: 3 });
      window.toast?.(`✅ CSS cache loaded (${this.cssCache.size} files)`, 2000);
    } catch (error) {
      console.error("[CSS Intellisense] Error loading CSS files:", error);
      window.toast?.("❌ Failed to load CSS cache", 3000);
    }
  }

  async destroy() {
    this._destroyed = true;
    this._loadToken++;

    if (this._initTimer) {
      clearTimeout(this._initTimer);
      this._initTimer = null;
    }

    if (this._extensionWatcher) {
      clearInterval(this._extensionWatcher);
      this._extensionWatcher = null;
    }

    for (const [event, handler] of Object.entries(this._handlers)) {
      editorManager.off?.(event, handler);
    }
    this._handlers = {};

    try {
      acode.require("commands")?.removeCommand?.(COMMAND_REFRESH);
      acode.require("commands")?.removeCommand?.(COMMAND_STATUS);
    } catch (_) {}

    try {
      const editor = editorManager.editor;
      // reconfigure() throws if the compartment was never added to this state.
      if (editor?.state && this.extensions.get(editor.state) !== undefined) {
        editor.dispatch({ effects: this.extensions.reconfigure([]) });
      }
    } catch (error) {
      console.warn("[CSS Intellisense] Could not remove extension:", error);
    }

    document.getElementById("css-intellisense-styles")?.remove();
    this.cssCache.clear();
  }

  ensureExtensionActive() {
    const editor = editorManager.editor;
    if (!editor || !this._cmExtensions) return;

    const state = editor.state;
    if (!state) return;

    // Already part of this state's config: nothing to do (and it can't be
    // injected twice).
    if (this.extensions.get(state) !== undefined) return;

    editor.dispatch({
      effects: StateEffect.appendConfig.of(
        this.extensions.of(this._cmExtensions),
      ),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Commands, events and styles                                        */
  /* ------------------------------------------------------------------ */

  setupCommands() {
    const commands = acode.require("commands");

    commands.addCommand({
      name: COMMAND_REFRESH,
      description: "Refresh CSS Cache",
      bindKey: { win: "Ctrl-Alt-R", mac: "Cmd-Alt-R" },
      exec: async () => {
        window.toast?.("🔄 Reloading CSS cache...", 1500);
        await this.refreshCssCache();
        window.toast?.(`✅ Cache reloaded (${this.cssCache.size} files)`, 2000);
        return true;
      },
    });

    commands.addCommand({
      name: COMMAND_STATUS,
      description: "Show CSS Cache Status",
      exec: () => {
        const entries = [...this.cssCache.values()];
        const totalClasses = entries.reduce(
          (sum, d) => sum + d.classes.length,
          0,
        );
        const totalIds = entries.reduce((sum, d) => sum + d.ids.length, 0);

        const MAX_SHOW = 10;
        const fileList = entries.map((d) => d.fileName);
        const shown = fileList.slice(0, MAX_SHOW);
        const more = fileList.length - shown.length;
        const filesText =
          shown.join(", ") + (more > 0 ? `, ... +${more} more` : "");

        acode.alert(
          "CSS Intellisense Status",
          [
            `📦 ${entries.length} CSS file(s) loaded`,
            `📝 ${totalClasses} classes`,
            `🏷️ ${totalIds} IDs`,
            `📂 ${filesText}`,
          ].join("\n"),
        );
        return true;
      },
    });
  }

  setupEventListeners() {
    // Switching tabs only needs the extension re-applied; no CSS reload.
    this._handlers["switch-file"] = () => this.ensureExtensionActive();

    // Saving a stylesheet only reloads that one file.
    this._handlers["save-file"] = this.debouncePerKey(async (file) => {
      const url = file?.uri || file?.url;
      const name = file?.filename || url || "";
      if (!url || !isCssFile(name) || isIgnored(url)) return;
      await this.loadSingleFile(url);
    }, 500);

    for (const [event, handler] of Object.entries(this._handlers)) {
      editorManager.on(event, handler);
    }
  }

  injectStyles() {
    if (document.getElementById("css-intellisense-styles")) return;

    const style = document.createElement("style");
    style.id = "css-intellisense-styles";
    style.textContent = `
      .cm-completionIcon-class {
        background-color: rgba(93, 249, 165, 0.565) !important;
        color: var(--text-color, #04281b) !important;
      }
      .cm-completionIcon-class::after {
        content: "." !important;
        color: inherit !important;
        margin-left: 4px !important;
        font-weight: 700 !important;
      }
      .cm-completionIcon-id {
        background-color: rgba(250, 10, 10, 0.61) !important;
        color: var(--text-color, #04281b) !important;
      }
      .cm-completionIcon-id::after {
        content: "#" !important;
        color: inherit !important;
        margin-left: 4px !important;
        font-weight: 700 !important;
      }
    `;
    document.head.append(style);
  }

  /* ------------------------------------------------------------------ */
  /* File discovery and cache                                           */
  /* ------------------------------------------------------------------ */

  getWorkspaceRoots() {
    const folders = acode.require("addedfolder") || [];
    return folders
      .filter(
        (folder) => folder.listFiles && this.fileIndex?.supports?.(folder.url),
      )
      .map((folder) => folder.url);
  }

  async listCssFileUrls() {
    if (!this.fileIndex?.query) return this.listCssFileUrlsFallback();

    const roots = this.getWorkspaceRoots();
    if (!roots.length) return this.listCssFileUrlsFallback();

    try {
      await this.fileIndex.whenReady(roots, 2000);
    } catch (error) {
      console.warn("[CSS Intellisense] fileIndex not ready, using fallback.");
      return this.listCssFileUrlsFallback();
    }

    const urls = [];
    let cursor = 0;

    while (true) {
      try {
        const page = await this.fileIndex.query({
          roots,
          text: "",
          limit: 1000,
          cursor,
        });
        if (!page || !page.entries) break;

        for (const entry of page.entries) {
          const url = entry.url || entry.uri;
          if (entry.isFile && isCssFile(entry.name) && url && !isIgnored(url)) {
            urls.push(url);
          }
        }

        if (!page.hasMore) break;
        cursor = page.cursor;
      } catch (error) {
        console.error("[CSS Intellisense] Error querying fileIndex:", error);
        break;
      }
    }

    return urls;
  }

  async listCssFileUrlsFallback() {
    try {
      const fileList = acode.require("fileList");
      if (!fileList) return [];

      const list = await fileList();
      if (!list || !list.length) return [];

      return list
        .filter((item) => isCssFile(item.name))
        .map((item) => item.url || item.uri)
        .filter((url) => url && !isIgnored(url));
    } catch (error) {
      console.warn("[CSS Intellisense] fileList fallback failed:", error);
      return [];
    }
  }

  async readCssEntry(url) {
    const fsMod = acode.require("fs") || acode.require("fsOperation");

    try {
      if (!fsMod) {
        throw new Error("fs module unavailable");
      }

      let content;
      // Support different fs APIs used in Acode environments
      if (typeof fsMod === "function") {
        // fs(url).readFile
        const maybe = fsMod(url);
        if (maybe && typeof maybe.readFile === "function") {
          content = await maybe.readFile("utf-8");
        } else if (typeof fsMod.readFile === "function") {
          content = await fsMod.readFile(url, "utf-8");
        } else {
          throw new Error("Unsupported fs function API");
        }
      } else if (typeof fsMod.readFile === "function") {
        content = await fsMod.readFile(url, "utf-8");
      } else {
        throw new Error("Unsupported fs API");
      }

      if (!content || !content.trim()) return null;

      const fileName = decodeSafe(url.split("/").pop());
      const label = decodeSafe(url).split("/").slice(-2).join("/");
      const { classes, ids } = this.extractCssSelectors(content, fileName);

      if (!classes.length && !ids.length) return null;
      return { classes, ids, fileUrl: url, fileName: label };
    } catch (error) {
      console.error(`[CSS Intellisense] Error loading ${url}:`, error);
      return null;
    }
  }

  /**
   * Reloads every stylesheet. The new cache is built aside and swapped at the
   * end, so autocomplete never sees an empty cache while loading.
   * `retries` only makes sense at startup, when the file index may not be
   * ready yet; later refreshes should not wait for projects without CSS.
   */
  async refreshCssCache({ retries = 0 } = {}) {
    const token = ++this._loadToken;

    let urls = await this.listCssFileUrls();
    for (let attempt = 1; !urls.length && attempt <= retries; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      if (token !== this._loadToken) return;
      urls = await this.listCssFileUrls();
    }

    const next = new Map();
    for (const url of urls) {
      const entry = await this.readCssEntry(url);
      if (entry) next.set(url, entry);
    }

    if (token !== this._loadToken) return; // a newer refresh/destroy won

    this.cssCache = next;
  }

  async loadSingleFile(url) {
    const entry = await this.readCssEntry(url);
    if (entry) this.cssCache.set(url, entry);
    else this.cssCache.delete(url);
  }

  /* ------------------------------------------------------------------ */
  /* Autocomplete                                                       */
  /* ------------------------------------------------------------------ */

  getActiveExtension() {
    const { activeFile } = editorManager;
    return (activeFile?.filename?.split(".").pop() ?? "").toLowerCase();
  }

  cssCompletionSource(context) {
    if (!VALID_EXTENSIONS.includes(this.getActiveExtension())) return null;

    // Look back a few hundred characters so attributes spanning several lines
    // are detected. The regex only matches while the quote is still open.
    const pos = context.pos;
    const from = Math.max(0, pos - 500);
    const textBefore = context.state.doc.sliceString(from, pos);

    const attr = /(?<![\w-])(class|className|id)\s*=\s*(?:\{\s*)?(["'`])[^"'`]*$/.exec(
      textBefore,
    );
    if (!attr) return null;

    const isId = attr[1] === "id";

    const word = context.matchBefore(/[\w-]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;

    const options = this.getSuggestions(isId ? "id" : "class");
    if (!options.length) return null;

    // No manual prefix filter: CodeMirror filters/ranks (including fuzzy
    // matches such as "primary" -> "btn-primary").
    return {
      from: word.from,
      to: word.to,
      options,
      validFor: /^[\w-]*$/,
    };
  }

  getSuggestions(type) {
    const options = [];
    const seen = new Set();
    const key = type === "id" ? "ids" : "classes";

    // Sort cssCache entries to prefer those near the active file.
    // Acode's EditorFile exposes the location as `uri` (the rest of this
    // file already reads `uri || url`); `url` stays as a fallback.
    const activeFile = editorManager.activeFile;
    const activeUrl = activeFile?.uri || activeFile?.url || "";
    const entries = [...this.cssCache.values()];

    const scoreFor = (fileUrl) => {
      if (!fileUrl || !activeUrl) return 0;
      if (fileUrl === activeUrl) return 3;
      try {
        const activeDir = activeUrl.replace(/\/[^/]+$/, "/");
        if (fileUrl.startsWith(activeDir)) return 2;
      } catch (_) {}
      // prefer files that share some path segment
      if (
        activeUrl &&
        fileUrl.includes(activeUrl.split("/").slice(0, -1).join("/"))
      )
        return 1;
      return 0;
    };

    entries.sort((a, b) => scoreFor(b.fileUrl) - scoreFor(a.fileUrl));

    for (const data of entries) {
      // Closer stylesheets get a slightly higher boost (50..53).
      const boost = 50 + scoreFor(data.fileUrl);
      for (const item of data[key]) {
        if (seen.has(item.name)) continue;
        seen.add(item.name);
        options.push({
          label: item.name,
          type,
          detail: data.fileName,
          apply: item.name,
          // Other sources (buffer words, snippets) answer in the same
          // popup. `boost` keeps the real CSS ids/classes above them
          // instead of mixed in with words like "testar" or "menu".
          boost,
        });
      }
    }

    return options;
  }

  /* ------------------------------------------------------------------ */
  /* Selector extraction                                                */
  /* ------------------------------------------------------------------ */

  extractCssSelectors(cssContent, fileName = "") {
    const classes = [];
    const ids = [];
    const seenClasses = new Set();
    const seenIds = new Set();

    const add = (list, seen, name, prefix) => {
      if (seen.has(name)) return;
      seen.add(name);
      list.push({ name, selector: prefix + name, display: prefix + name });
    };

    for (const prelude of this.getSelectorPreludes(cssContent, fileName)) {
      for (const m of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        add(classes, seenClasses, m[1], ".");
      }
      for (const m of prelude.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) {
        add(ids, seenIds, m[1], "#");
      }
    }

    return { classes, ids };
  }

  /**
   * Returns only the text that precedes each `{` (the selectors), after
   * removing comments, strings, url(...) and SCSS interpolation. This avoids
   * false positives such as `url(img.png)` -> class "png".
   */
  getSelectorPreludes(content, fileName) {
    // Order matters: url(...) and strings go first so a `//` inside them
    // (e.g. url(//cdn.com/a.png)) is not mistaken for a line comment.
    // `//` comments only exist in SCSS/Less/Stylus, never in plain CSS.
    let cleaned = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/gi, "")
      .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, "");

    if (/\.(scss|less|styl)$/i.test(fileName)) {
      cleaned = cleaned.replace(/(^|[^:])\/\/.*$/gm, "$1");
    }

    cleaned = cleaned.replace(/#\{[^}]*\}/g, "");

    // Stylus has no braces: selectors are lines starting with . or #.
    if (/\.styl$/i.test(fileName)) {
      return cleaned
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[.#]/.test(line));
    }

    const preludes = [];
    for (const m of cleaned.matchAll(/([^{};]+)\{/g)) {
      const text = m[1].trim();
      if (text && !text.startsWith("@")) preludes.push(text);
    }
    return preludes;
  }

  /* ------------------------------------------------------------------ */
  /* Utils                                                              */
  /* ------------------------------------------------------------------ */

  debouncePerKey(func, wait) {
    const timers = new Map();
    return (file) => {
      const key =
        file?.uri || file?.url || file?.filename || JSON.stringify(file);
      if (!key) return;
      if (timers.has(key)) clearTimeout(timers.get(key));
      const t = setTimeout(() => {
        timers.delete(key);
        try {
          func.call(this, file);
        } catch (e) {
          console.error("[CSS Intellisense] Error in debounced handler:", e);
        }
      }, wait);
      timers.set(key, t);
    };
  }
}

// Plugin registration
if (window.acode) {
  const pluginInstance = new CSSIntellisense();

  acode.setPluginInit(plugin.id, async () => {
    await pluginInstance.init();
  });

  acode.setPluginUnmount(plugin.id, () => {
    pluginInstance.destroy();
  });
}