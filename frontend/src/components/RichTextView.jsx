// Formatted text as it was written in RichTextEditor. The HTML is cleaned
// every time it is shown, since notes come back from the database and are not
// trusted (lib/richText.js).

import { useMemo } from 'react'
import { sanitizeNotesHtml } from '../lib/richText'

const RichTextView = ({ html, className = '' }) => {
  const clean = useMemo(() => sanitizeNotesHtml(html), [html])
  // Safe to set as HTML: cleaned by sanitizeNotesHtml just above.
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />
}

export default RichTextView
