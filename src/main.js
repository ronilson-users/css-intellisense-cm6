
import plugin from "../plugin.json";

/**
 * Plugin CSS Intellisense
 * Sugere classes CSS/SCSS dos arquivos do projeto
 */

const cm = acode.require("codemirror");
const { autocompletion } = cm.autocomplete;
const { StateEffect, Compartment } = cm.state;

// CSS Parsing
import { parse as cssParse } from "@adobe/css-tools";

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".styl"];
const VALID_EXTENSIONS = [
  "js", "jsx", "ts", "tsx", "html", "htm", "vue", "svelte", "astro"
];

class CSSIntellisense {
  constructor() {
    this.editor = null;
    this.fileIndex = null;
    this.addedFolder = null;
    this.extensions = new Compartment();
    this.cssCache = new Map();
    this._debounceTimer = null;
    this.cssCompletionSource = this.cssCompletionSource.bind(this);
  }

  async init($page) {
    $page.id = plugin.id;
    this.$page = $page;

    if (!editorManager.isCodeMirror) {
      window.toast?.("Este plugin requer o motor CodeMirror do Acode.", 4000);
      return;
    }

    this.editor = editorManager.editor;
    this.fileIndex = acode.require("fileIndex");

    if (!this.fileIndex?.query) {
      console.warn("fileIndex indisponível; usando fallback fileList.");
    }

    this.setupEventListeners();
    this.injectStyles();

    // Registra o autocomplete IMEDIATAMENTE, sem esperar o CSS carregar.
    // Antes o dispatch só rodava depois de `await this.loadCssFiles()`,
    // que passa por `fileIndex.whenReady(roots)` — logo após instalar o
    // plugin (ou reload do npm run dev) o fileIndex pode ainda estar
    // indexando o projeto e esse await demora. Enquanto isso a extensão
    // de autocomplete nem existia no editor, então digitar dentro de
    // class="..." não sugeria nada; só "funcionava" depois de reiniciar
    // o plugin porque aí o fileIndex já estava pronto e o await resolvia
    // rápido. cssCompletionSource lê this.cssCache ao vivo a cada
    // chamada, então registrar cedo não perde nada.
    const cmExtensions = [
      autocompletion({
        override: [this.cssCompletionSource],
        closeOnBlur: true,
        defaultKeymap: true,
        activateOnTyping: true,
        maxRenderedOptions: 100,
        optionClass: (completion) => {
          return `cm-completion-${completion.type || "default"}`;
        },
      }),
    ];

    this.editor.dispatch({
      effects: StateEffect.appendConfig.of(this.extensions.of(cmExtensions)),
    });

    // Carrega o cache de CSS em background, sem travar a ativação do
    // autocomplete. Assim que popular, as sugestões passam a aparecer
    // sozinhas, sem precisar reiniciar nada.
    this.loadCssFiles().catch((error) =>
      console.error("Error loading CSS files:", error)
    );
  }

  async listCssFileUrls() {
    if (!this.fileIndex?.query) {
      const fileList = acode.require("fileList");
      if (!fileList) return [];
      const list = await fileList();
      return list
        .filter((item) => CSS_EXTENSIONS.some((ext) => item.name.endsWith(ext)))
        .map((item) => item.url);
    }

    const roots = this.getWorkspaceRoots();
    if (!roots.length) return [];

    await this.fileIndex.whenReady(roots);

    const urls = [];
    let cursor = 0;

    while (true) {
      const page = await this.fileIndex.query({
        roots,
        text: "",
        limit: 1000,
        cursor,
      });

      for (const entry of page.entries) {
        if (
          entry.isFile &&
          CSS_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
        ) {
          urls.push(entry.url || entry.uri);
        }
      }

      if (!page.hasMore) break;
      cursor = page.cursor;
    }

    return urls;
  }

  async loadCssFiles() {
    try {
      const urls = await this.listCssFileUrls();
      const fs = acode.require("fs") || acode.require("fsOperation");

      for (const url of urls) {
        try {
          const content = await fs(url).readFile("utf-8");
          if (!content || !content.trim()) continue;

          const fileName = url.split("/").pop();
          const { classes, ids } = this.extractCssSelectors(content, fileName);

          if (classes.length > 0 || ids.length > 0) {
            this.cssCache.set(url, {
              classes,
              ids,
              fileUrl: url,
              fileName,
            });
          }
        } catch (error) {
          console.error(`Error loading CSS file ${url}:`, error);
        }
      }
    } catch (error) {
      console.error("Error loading CSS files:", error);
    }

    // TEMP: remova este log depois de confirmar que está funcionando.
    console.log(
      `[CSS Intellisense] ${this.cssCache.size} arquivo(s) CSS carregado(s):`,
      [...this.cssCache.values()].map(
        (d) => `${d.fileName} (${d.classes.length} classes, ${d.ids.length} ids)`
      )
    );
  }

  async refreshCssCache() {
    this.cssCache.clear();
    await this.loadCssFiles();
  }

  injectStyles() {
    if (document.getElementById("css-intellisense-styles")) return;

    const style = document.createElement("style");
    style.id = "css-intellisense-styles";
    style.innerHTML = `
      .cm-tooltip-autocomplete {
        background-color: var(--popup-background-color) !important;
        border: 1px solid var(--secondary-text-color) !important;
        border-radius: var(--popup-border-radius) !important;
        box-shadow: 0 4px 20px var(--box-shadow-color) !important;
        max-height: 350px !important;
        overflow-y: auto !important;
      }

      .cm-tooltip-autocomplete > ul {
        padding: 2px 0 !important;
      }

      .cm-tooltip-autocomplete > ul > li {
        padding: 3px 6px !important;
        font-size: 12px !important;
        color: var(--primary-text-color) !important;
        border-radius: 2px !important;
        margin: 1px 2px !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
      }

      .cm-tooltip-autocomplete > ul > li:hover {
        background-color: var(--secondary-color) !important;
      }

      .cm-tooltip-autocomplete > ul > li[aria-selected] {
        background-color: var(--active-color) !important;
        color: var(--active-text-color) !important;
      }

      .cm-tooltip-autocomplete .cm-completionDetail {
        color: var(--secondary-text-color) !important;
        font-size: 10px !important;
        margin-left: auto !important;
        opacity: 0.3 !important;
      }

      .cm-tooltip-autocomplete .cm-completionLabel {
        font-weight: 100 !important;
      }

      .cm-completionIcon-class {
        color: var(--secondary-text-color) !important;
        opacity: 0.75;
      }

      .cm-completionIcon-id {
        color: var(--secondary-text-color) !important;
        opacity: 0.75;
      }
    `;
    document.head.append(style);
  }

  getActiveExtension() {
    const { activeFile } = editorManager;
    return activeFile?.filename?.split(".").pop() ?? "";
  }

  setupEventListeners() {
    const debouncedRefresh = this.debounce(async () => {
      await this.refreshCssCache();
    }, 500);

    editorManager.on("switch-file", debouncedRefresh);
    editorManager.on("save-file", debouncedRefresh);

    editorManager.on("remove-file", (file) => {
      const removedUrl = file?.uri || file?.url;
      if (removedUrl && this.cssCache.has(removedUrl)) {
        this.cssCache.delete(removedUrl);
      }
    });
  }

  cssCompletionSource(context) {
    const ext = this.getActiveExtension();

    if (!VALID_EXTENSIONS.includes(ext)) {
      return null;
    }

    const pos = context.pos;
    const line = context.state.doc.lineAt(pos);
    const lineText = line.text;
    const column = pos - line.from;

    const textBefore = lineText.substring(0, column);
    const hasClassAttribute =
      textBefore.includes("className=") || textBefore.includes("class=");

    if (!hasClassAttribute) {
      return null;
    }

    const word = context.matchBefore(/[a-zA-Z0-9_-]*/);
    if (!word) return null;

    if (word.from === word.to && !context.explicit) {
      return null;
    }

    const prefix = word.text || "";
    const suggestions = this.getAllSuggestions(prefix);

    if (suggestions.length === 0) {
      return null;
    }

    return {
      from: word.from,
      to: word.to,
      options: suggestions,
      validFor: /^[a-zA-Z0-9_-]*$/,
    };
  }

  getAllSuggestions(prefix) {
    const suggestions = [];
    const seen = new Set();

    for (const [, data] of this.cssCache) {
      for (const cls of data.classes) {
        const name = cls.name;
        if (!prefix || name.toLowerCase().startsWith(prefix.toLowerCase())) {
          if (!seen.has(name)) {
            seen.add(name);
            suggestions.push({
              label: cls.display,
              type: "class",
              detail: `📄 ${data.fileName}`,
              info: `Classe CSS: ${cls.display}`,
              apply: cls.name,
              boost: 100 - suggestions.length,
            });
          }
        }
      }

      for (const id of data.ids) {
        const name = id.name;
        if (!prefix || name.toLowerCase().startsWith(prefix.toLowerCase())) {
          if (!seen.has(name)) {
            seen.add(name);
            suggestions.push({
              label: id.display,
              type: "id",
              detail: `📄 ${data.fileName}`,
              info: `ID CSS: ${id.display}`,
              apply: id.name,
              boost: 90 - suggestions.length,
            });
          }
        }
      }
    }

    suggestions.sort((a, b) => {
      const order = { class: 0, id: 1 };
      return (
        (order[a.type] ?? 2) - (order[b.type] ?? 2) ||
        a.label.localeCompare(b.label)
      );
    });

    return suggestions;
  }

  getWorkspaceRoots() {
    this.addedFolder = acode.require("addedfolder") || [];
    return this.addedFolder
      .filter(
        (folder) => folder.listFiles && this.fileIndex?.supports(folder.url)
      )
      .map((folder) => folder.url);
  }

  extractCssSelectors(cssContent, fileName = "") {
    // AST (@adobe/css-tools) só entende CSS puro. Para .scss/.less/.styl
    // (nesting, variáveis, @mixin, interpolação etc.) o parser falha e
    // retornava silenciosamente { classes: [], ids: [] }. Por isso:
    // - .css tenta o AST primeiro (mais preciso) e cai no regex se falhar
    //   ou não achar nada;
    // - .scss/.less/.styl usam direto o extrator por regex, que é
    //   tolerante a qualquer sintaxe de pré-processador.
    const isPlainCss = /\.css$/i.test(fileName);

    if (isPlainCss) {
      const astResult = this.extractCssSelectorsAst(cssContent);
      if (astResult.classes.length > 0 || astResult.ids.length > 0) {
        return astResult;
      }
    }

    return this.extractCssSelectorsRegex(cssContent);
  }

  extractCssSelectorsAst(cssContent) {
    const classes = [];
    const ids = [];
    const seenClasses = new Set();
    const seenIds = new Set();

    try {
      const ast = cssParse(cssContent, { silent: true });
      if (!ast || !ast.stylesheet) return { classes, ids };

      const rules = ast.stylesheet.rules || [];

      for (const rule of rules) {
        if (rule.type !== "rule" || !rule.selectors) continue;

        for (const selector of rule.selectors) {
          const classMatches = selector.match(/\.([a-zA-Z0-9_-]+)/g);
          if (classMatches) {
            for (const match of classMatches) {
              const className = match.substring(1);
              if (!seenClasses.has(className)) {
                seenClasses.add(className);
                classes.push({
                  name: className,
                  selector: match,
                  display: `.${className}`,
                });
              }
            }
          }

          const idMatches = selector.match(/#([a-zA-Z0-9_-]+)/g);
          if (idMatches) {
            for (const match of idMatches) {
              const idName = match.substring(1);
              if (!seenIds.has(idName)) {
                seenIds.add(idName);
                ids.push({
                  name: idName,
                  selector: match,
                  display: `#${idName}`,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error parsing CSS (AST):", error);
    }

    return { classes, ids };
  }

  // Extrai classes/IDs varrendo o texto inteiro por regex, sem depender de
  // uma AST válida. Funciona com CSS, SCSS (nesting, &, interpolação),
  // LESS (@var, mixins) e Stylus (sem chaves/ponto-e-vírgula).
  extractCssSelectorsRegex(cssContent) {
    const classes = [];
    const ids = [];
    const seenClasses = new Set();
    const seenIds = new Set();

    // Remove comentários /* */ e // para reduzir falsos positivos
    const cleaned = cssContent
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

    const isHexColor = (name) => /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(name);

    const classMatches = cleaned.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    if (classMatches) {
      for (const match of classMatches) {
        const className = match.substring(1);
        if (!seenClasses.has(className)) {
          seenClasses.add(className);
          classes.push({
            name: className,
            selector: match,
            display: `.${className}`,
          });
        }
      }
    }

    const idMatches = cleaned.match(/#([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    if (idMatches) {
      for (const match of idMatches) {
        const idName = match.substring(1);
        // Ignora falsos positivos tipo cores hex (#fff, #a1b2c3) usadas
        // dentro de valores de propriedade, não como seletor.
        if (isHexColor(idName)) continue;
        if (!seenIds.has(idName)) {
          seenIds.add(idName);
          ids.push({
            name: idName,
            selector: match,
            display: `#${idName}`,
          });
        }
      }
    }

    return { classes, ids };
  }

  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async destroy() {
    if (this.editor) {
      this.editor.dispatch({
        effects: this.extensions.reconfigure([]),
      });
    }
    document.getElementById("css-intellisense-styles")?.remove();
    this.cssCache.clear();
  }
}

// Registra o plugin
if (window.acode) {
  const pluginInstance = new CSSIntellisense();

  acode.setPluginInit(
    plugin.id,
    async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
      if (!baseUrl.endsWith("/")) {
        baseUrl += "/";
      }
      await pluginInstance.init($page, cacheFile, cacheFileUrl);
    }
  );

  acode.setPluginUnmount(plugin.id, () => {
    pluginInstance.destroy();
  });
}