import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import './monaco-widgets.css';

// All editor code and workers are served by this app. The loader never uses a CDN.
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Monaco 0.52's word highlighter leaves a debounce promise unobserved when an
// editor closes. Match Monaco's CancellationError contract, and only handle the
// cancel/dispose path. Actual worker, provider, and application errors still surface.
const handleDisposedHighlightCancellation = (event: PromiseRejectionEvent) => {
  const reason: unknown = event.reason;
  const fromMonaco = reason instanceof Error && (reason.stack?.includes(new URL(import.meta.url).pathname)
    || /\/node_modules\/(?:\.vite\/deps\/monaco-editor[^/]*\.js|monaco-editor\/)/.test(reason.stack || ''));
  if (reason instanceof Error && reason.name === 'Canceled' && reason.message === 'Canceled'
    && fromMonaco && reason.stack?.includes('.cancel') && reason.stack.includes('.dispose')) event.preventDefault();
};
window.addEventListener('unhandledrejection', handleDisposedHighlightCancellation);
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('unhandledrejection', handleDisposedHighlightCancellation));

monaco.editor.defineTheme('codex-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'delimiter', foreground: 'D4D4D4' },
  ],
  colors: {
    'editor.background': '#111111',
    'editor.foreground': '#ECECEC',
    'editorLineNumber.foreground': '#7D7D7D',
    'editorLineNumber.activeForeground': '#A3A3A3',
    'editorCursor.foreground': '#ECECEC',
    'editor.selectionBackground': '#FFFFFF33',
    'editor.inactiveSelectionBackground': '#2C2C2C',
    'editor.lineHighlightBackground': '#191919',
    'editorIndentGuide.background1': '#2C2C2C',
    'editorIndentGuide.activeBackground1': '#525252',
    'editorGutter.background': '#111111',
    'editorWidget.background': '#191919',
    'editorWidget.foreground': '#ECECEC',
    'editorWidget.border': '#424242',
    'editorWidget.resizeBorder': '#A3A3A3',
    'widget.border': '#424242',
    'editorSuggestWidget.background': '#191919',
    'editorSuggestWidget.foreground': '#ECECEC',
    'editorSuggestWidget.border': '#424242',
    'editorSuggestWidget.selectedBackground': '#2C2C2C',
    'editorSuggestWidget.selectedForeground': '#FFFFFF',
    'editorSuggestWidget.selectedIconForeground': '#ECECEC',
    'editorSuggestWidget.highlightForeground': '#FFFFFF',
    'editorSuggestWidget.focusHighlightForeground': '#FFFFFF',
    'editorSuggestWidgetStatus.foreground': '#A3A3A3',
    'editorHoverWidget.background': '#191919',
    'editorHoverWidget.foreground': '#ECECEC',
    'editorHoverWidget.border': '#424242',
    'editorHoverWidget.statusBarBackground': '#232323',
    'input.background': '#111111',
    'input.foreground': '#ECECEC',
    'input.border': '#424242',
    'input.placeholderForeground': '#858585',
    'inputOption.activeBackground': '#2C2C2C',
    'inputOption.activeForeground': '#FFFFFF',
    'inputOption.activeBorder': '#A3A3A3',
    'inputOption.hoverBackground': '#2C2C2C',
    'inputValidation.errorBackground': '#211715',
    'inputValidation.errorForeground': '#F48771',
    'inputValidation.errorBorder': '#F48771',
    'inputValidation.warningBackground': '#211E17',
    'inputValidation.warningForeground': '#D7BA7D',
    'inputValidation.warningBorder': '#D7BA7D',
    'inputValidation.infoBackground': '#232323',
    'inputValidation.infoForeground': '#ECECEC',
    'inputValidation.infoBorder': '#A3A3A3',
    'toolbar.hoverBackground': '#2C2C2C',
    'toolbar.activeBackground': '#333333',
    'toolbar.hoverOutline': '#424242',
    'menu.background': '#191919',
    'menu.foreground': '#ECECEC',
    'menu.border': '#424242',
    'menu.selectionBackground': '#2C2C2C',
    'menu.selectionForeground': '#FFFFFF',
    'menu.selectionBorder': '#424242',
    'menu.separatorBackground': '#2C2C2C',
    'list.focusBackground': '#2C2C2C',
    'list.focusForeground': '#FFFFFF',
    'list.focusOutline': '#9E9E9E',
    'list.activeSelectionBackground': '#2C2C2C',
    'list.activeSelectionForeground': '#FFFFFF',
    'list.activeSelectionIconForeground': '#ECECEC',
    'list.inactiveSelectionBackground': '#232323',
    'list.inactiveSelectionForeground': '#ECECEC',
    'list.inactiveSelectionIconForeground': '#A3A3A3',
    'list.hoverBackground': '#1B1B1B',
    'list.hoverForeground': '#ECECEC',
    'list.highlightForeground': '#FFFFFF',
    'list.focusHighlightForeground': '#FFFFFF',
    'quickInput.background': '#191919',
    'quickInput.foreground': '#ECECEC',
    'quickInputList.focusBackground': '#2C2C2C',
    'quickInputList.focusForeground': '#FFFFFF',
    'quickInputList.focusIconForeground': '#ECECEC',
    'disabledForeground': '#6F6F6F',
    'editor.findMatchBackground': '#FFFFFF29',
    'editor.findMatchBorder': '#ECECEC',
    'editor.findMatchHighlightBackground': '#FFFFFF12',
    'editor.findMatchHighlightBorder': '#5C5C5C',
    'editor.findRangeHighlightBackground': '#FFFFFF08',
    'editor.findRangeHighlightBorder': '#424242',
    'editorOverviewRuler.findMatchForeground': '#A3A3A3',
    'textLink.foreground': '#ECECEC',
    'textLink.activeForeground': '#FFFFFF',
    'textCodeBlock.background': '#111111',
    'minimap.background': '#111111',
    'widget.shadow': '#00000000',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#FFFFFF18',
    'scrollbarSlider.hoverBackground': '#FFFFFF28',
    'scrollbarSlider.activeBackground': '#FFFFFF35',
    'diffEditor.insertedTextBackground': '#89D18520',
    'diffEditor.removedTextBackground': '#F4877120',
    'focusBorder': '#9E9E9E',
  },
});

monaco.editor.setTheme('codex-dark');

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  allowJs: true,
  strict: true,
  esModuleInterop: true,
  noEmit: true,
});
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  noEmit: true,
});
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

export function documentUri(workspaceId: string, path: string): string {
  return `file:///workspaces/${encodeURIComponent(workspaceId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function comparisonUri(workspaceId: string, path: string): string {
  return `codex-original://${encodeURIComponent(workspaceId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function disposeWorkspaceModels(workspaceId: string) {
  const prefix = documentUri(workspaceId, '');
  const originalPrefix = `codex-original://${encodeURIComponent(workspaceId)}/`;
  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString();
    if (uri.startsWith(prefix) || uri.startsWith(originalPrefix)) model.dispose();
  }
}

export { monaco };
