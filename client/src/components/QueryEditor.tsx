import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import {
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
} from "@codemirror/language";
import {
  autocompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { useMemo, useRef } from "react";
import { usePreferences } from "../app/Preferences";
const logsql = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (
      stream.match(
        /^(?:stats|by|count|sum|avg|min|max|sort|desc|asc|limit|offset|fields|filter|uniq|top|AND|OR|NOT|in|math|format|extract|replace|as|unroll|join)\b/i,
      )
    )
      return "keyword";
    if (stream.match(/^\d+(?:\.\d+)?(?:ns|ms|s|m|h|d|w)?\b/)) return "number";
    if (stream.match(/^[\w.]+(?=\s*:)/)) return "propertyName";
    if (stream.match(/^[|:=!<>()[\],]+/)) return "operator";
    stream.next();
    return null;
  },
});
export function QueryEditor({
  value,
  onChange,
  onRun,
  fields,
  wrap,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  fields: string[];
  wrap: boolean;
}) {
  const { theme, language, t } = usePreferences();
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const extensions = useMemo(() => {
    const complete = (context: CompletionContext) => {
      const word = context.matchBefore(/[\w._]*/);
      if (!word || (!word.text && !context.explicit)) return null;
      return {
        from: word.from,
        options: [
          ...fields.map((label) => ({ label, type: "property" })),
          ...[
            "stats",
            "count()",
            "sum()",
            "avg()",
            "sort",
            "by",
            "limit",
            "fields",
            "uniq",
            "top",
            "filter",
            "AND",
            "OR",
            "NOT",
          ].map((label) => ({ label, type: "keyword" })),
        ],
      };
    };
    const nonce =
      document.querySelector<HTMLMetaElement>("meta[name=csp-nonce]")
        ?.content || "";
    return [
      logsql,
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.keyword, color: "var(--accent)" },
          { tag: tags.string, color: "var(--success)" },
          { tag: tags.number, color: "var(--info)" },
          { tag: tags.propertyName, color: "var(--text)" },
          { tag: tags.operator, color: "var(--muted)" },
        ]),
      ),
      EditorView.contentAttributes.of({ "aria-label": t("query") }),
      autocompletion({ override: [complete] }),
      Prec.highest(
        keymap.of(
          ["Ctrl-Enter", "Meta-Enter"].map((key) => ({
            key,
            preventDefault: true,
            run: () => {
              runRef.current();
              return true;
            },
          })),
        ),
      ),
      EditorView.cspNonce.of(nonce),
      EditorView.theme(
        {
          "&": {
            backgroundColor: "var(--surface)",
            color: "var(--text)",
            fontSize: "13px",
          },
          "&.cm-focused": { outline: "1px solid var(--accent)" },
          ".cm-scroller": { backgroundColor: "var(--surface)" },
          ".cm-content": {
            fontFamily: "var(--font)",
            lineHeight: "1.9",
            padding: "12px 0",
            caretColor: "var(--text)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--bg)",
            color: "var(--muted)",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLine,.cm-activeLineGutter": {
            backgroundColor: "var(--surface-2)",
          },
          ".cm-selectionBackground,&.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--border)",
          },
          ".cm-cursor": { borderLeftColor: "var(--text)" },
          ".cm-tooltip": {
            backgroundColor: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          },
          ".cm-completionIcon": { display: "none" },
          ".cm-searchMatch": { backgroundColor: "var(--border)" },
          ".cm-panels": {
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          },
        },
        { dark: theme === "dark" },
      ),
      EditorState.phrases.of(
        language === "tr"
          ? {
              Find: "Bul",
              Replace: "Değiştir",
              "Replace all": "Tümünü değiştir",
              next: "sonraki",
              previous: "önceki",
              all: "tümü",
              "match case": "büyük/küçük harf",
              "by word": "tam sözcük",
              regexp: "düzenli ifade",
              close: "kapat",
              "No diagnostics": "Tanı yok",
            }
          : {},
      ),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ];
  }, [theme, language, fields, wrap]);
  return (
    <CodeMirror
      theme="none"
      value={value}
      onChange={onChange}
      minHeight="108px"
      maxHeight="360px"
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
        searchKeymap: true,
      }}
      aria-label={t("query")}
    />
  );
}
