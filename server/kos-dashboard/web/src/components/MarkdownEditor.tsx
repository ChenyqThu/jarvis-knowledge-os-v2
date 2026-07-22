import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { cn } from '@/lib/utils';

// oneDark supplies the syntax highlighting; this override realigns the editor
// chrome to the dashboard's zinc tokens (design.md §1 / §3: transparent bg so
// the surrounding card's zinc-900 shows through, mono font, sky caret). Added
// after oneDark in `extensions`, so its rules win for the properties it sets.
const zincChrome = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '13px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--primary)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--muted-foreground)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(56, 189, 248, 0.25)',
    },
  },
  { dark: true },
);

// oneDark first (syntax highlighting + base chrome), zincChrome last so its
// background/gutter/caret rules win.
const extensions = [oneDark, markdown({ base: markdownLanguage }), EditorView.lineWrapping, zincChrome];

interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** When true the buffer is shown but cannot be edited (still selectable, so
   * a locked page's content can be read/copied). */
  readOnly?: boolean;
  height?: string;
}

/** CodeMirror 6 markdown editor, dark theme aligned to zinc. Chosen over a
 * plain <textarea> per the PRD; React 19 resolved its peers cleanly on install
 * (no fallback needed). Line wrapping on; no fold gutter / autocomplete popups
 * (noise for prose). Switching pages/selection is high-frequency → no
 * animation here (design.md §3). */
export function MarkdownEditor({ value, onChange, readOnly = false, height = '60vh' }: MarkdownEditorProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-input bg-input/30',
        readOnly && 'opacity-90',
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        theme="none"
        height={height}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          autocompletion: false,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
        }}
      />
    </div>
  );
}
