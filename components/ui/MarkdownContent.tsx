// components/ui/MarkdownContent.tsx
// The ONE Markdown renderer for every free-text field that accepts Markdown (Phase 8):
// profile bio, club/ruleset/tournament descriptions, part-request notes, rating comments.
// Used by all read-side call sites AND by MarkdownEditor's live preview, so preview and
// render can never drift apart.
//
// SECURITY (non-negotiable): react-markdown parses Markdown syntax only — embedded HTML
// (e.g. a <script> tag in a comment) is rendered as inert literal text, never executed.
// Never add rehype-raw or any other raw-HTML pass-through here: every rendered field is
// attacker-reachable free text from authenticated users, and raw HTML would reopen the
// stored-XSS bug class the platform has avoided so far. Changing this posture requires a
// fresh security review.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Minimal typographic defaults for rendered Markdown (the platform has no prose plugin).
const TYPOGRAPHY =
  '[&_p]:my-2 [&_a]:underline [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-current/10 [&_code]:px-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-current/10 [&_pre]:p-3 [&_pre]:text-sm [&_table]:my-2 [&_th]:border [&_th]:border-current/30 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-current/30 [&_td]:px-2 [&_td]:py-1'

export function MarkdownContent({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`${TYPOGRAPHY} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Markdown-authored links: no window.opener exploits, no SEO credit for user spam.
          // react-markdown v10 hands custom components the mdast `node` as a prop — it must
          // not reach the DOM element.
          a: (props) => {
            const anchorProps = { ...props }
            delete anchorProps.node
            return <a {...anchorProps} rel="noopener noreferrer nofollow" />
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
