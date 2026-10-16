// A formatted-text editor with a toolbar: headings, bold, italic, underline,
// strike, text colour and highlight from the palettes, lists, quotes and
// dividers.
// Used for recipe notes. Its output is HTML, cleaned by lib/richText.js on the
// way out and shown with RichTextView. The usual shortcuts work too (Ctrl+B,
// Ctrl+I, Ctrl+U, Ctrl+Shift+H for highlight, "# " for a heading, "- " for a
// list).
//
// Uncontrolled after it mounts: `value` is the starting content, and every
// change is reported through onChange ('' when empty). Remount it (a `key`)
// to load different content.

import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { HIGHLIGHT_COLORS, TEXT_COLORS, sanitizeNotesHtml } from '../lib/richText'

const ToolbarButton = ({ active, disabled, onClick, label, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onMouseDown={(e) => e.preventDefault()} // keep the selection in the text
    onClick={onClick}
    className={`h-8 min-w-8 px-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-40 ${
      active ? 'bg-accent/20 text-accent' : 'text-foreground hover:bg-muted/70'
    }`}
  >
    {children}
  </button>
)

const Divider = () => <span className="w-px h-6 bg-border mx-1" aria-hidden="true" />

const RichTextEditor = ({ value, onChange, disabled = false, placeholder = 'Write notes…' }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        link: false,
      }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
    ],
    content: sanitizeNotesHtml(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'rich-text min-h-[10rem] px-4 py-3 focus:outline-none',
        'aria-label': 'Notes',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor: current }) => onChange?.(current.isEmpty ? '' : current.getHTML()),
  })

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? {
      paragraph: current.isActive('paragraph'),
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      color: (current.getAttributes('textStyle').color || '').toLowerCase() || null,
      highlight: HIGHLIGHT_COLORS.find((color) => current.isActive('highlight', { color: color.value }))?.value || null,
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      empty: current.isEmpty,
    } : null),
  })

  if (!editor || !state) return null
  const chain = () => editor.chain().focus()
  const off = disabled

  return (
    <div className={`rounded-lg border border-border bg-input focus-within:ring-2 focus-within:ring-ring ${off ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5 sticky top-0 bg-input rounded-t-lg z-10">
        <ToolbarButton label="Normal text" active={state.paragraph} disabled={off} onClick={() => chain().setParagraph().run()}>¶</ToolbarButton>
        <ToolbarButton label="Heading 1" active={state.h1} disabled={off} onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
        <ToolbarButton label="Heading 2" active={state.h2} disabled={off} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
        <ToolbarButton label="Heading 3" active={state.h3} disabled={off} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
        <Divider />
        <ToolbarButton label="Bold (Ctrl+B)" active={state.bold} disabled={off} onClick={() => chain().toggleBold().run()}>
          <span className="font-black">B</span>
        </ToolbarButton>
        <ToolbarButton label="Italic (Ctrl+I)" active={state.italic} disabled={off} onClick={() => chain().toggleItalic().run()}>
          <span className="italic font-serif">I</span>
        </ToolbarButton>
        <ToolbarButton label="Underline (Ctrl+U)" active={state.underline} disabled={off} onClick={() => chain().toggleUnderline().run()}>
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" active={state.strike} disabled={off} onClick={() => chain().toggleStrike().run()}>
          <span className="line-through">S</span>
        </ToolbarButton>
        <Divider />
        {TEXT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            title={`${color.name} text`}
            aria-label={`${color.name} text`}
            aria-pressed={state.color === color.value}
            disabled={off}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (state.color === color.value ? chain().unsetColor().run() : chain().setColor(color.value).run())}
            className={`h-8 w-7 rounded-md flex flex-col items-center justify-center transition-colors disabled:opacity-40 ${
              state.color === color.value ? 'bg-muted' : 'hover:bg-muted/70'
            }`}
          >
            <span className="text-sm font-black leading-none" style={{ color: color.value }}>A</span>
            <span className="mt-0.5 h-1 w-4 rounded-sm" style={{ backgroundColor: color.value }} />
          </button>
        ))}
        <ToolbarButton label="Default text colour" disabled={off || !state.color} onClick={() => chain().unsetColor().run()}>
          <span className="text-sm font-black underline decoration-2">A</span>
        </ToolbarButton>
        <Divider />
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            title={`Highlight ${color.name.toLowerCase()}`}
            aria-label={`Highlight ${color.name.toLowerCase()}`}
            aria-pressed={state.highlight === color.value}
            disabled={off}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().toggleHighlight({ color: color.value }).run()}
            className={`h-6 w-6 mx-0.5 rounded-full border-2 transition-transform disabled:opacity-40 ${
              state.highlight === color.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-110'
            }`}
            style={{ backgroundColor: color.value }}
          />
        ))}
        <ToolbarButton label="Remove highlight" disabled={off || !state.highlight} onClick={() => chain().unsetHighlight().run()}>
          <span className="text-xs">✕</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Bullet list" active={state.bulletList} disabled={off} onClick={() => chain().toggleBulletList().run()}>• ≡</ToolbarButton>
        <ToolbarButton label="Numbered list" active={state.orderedList} disabled={off} onClick={() => chain().toggleOrderedList().run()}>1.</ToolbarButton>
        <ToolbarButton label="Quote" active={state.blockquote} disabled={off} onClick={() => chain().toggleBlockquote().run()}>❝</ToolbarButton>
        <ToolbarButton label="Divider line" disabled={off} onClick={() => chain().setHorizontalRule().run()}>―</ToolbarButton>
        <Divider />
        <ToolbarButton label="Undo (Ctrl+Z)" disabled={off || !state.canUndo} onClick={() => chain().undo().run()}>↶</ToolbarButton>
        <ToolbarButton label="Redo (Ctrl+Shift+Z)" disabled={off || !state.canRedo} onClick={() => chain().redo().run()}>↷</ToolbarButton>
      </div>
      <EditorContent editor={editor} className={state.empty ? 'rich-text-empty' : ''} />
    </div>
  )
}

export default RichTextEditor
