import { formatClock } from '../desk/format.js';

export type BubbleVariant = 'visitor' | 'agent' | 'system';

export function MessageBubble({
  body,
  createdAt,
  variant,
  author,
  testId,
}: {
  body: string;
  createdAt: string;
  variant: BubbleVariant;
  author?: string;
  testId?: string;
}) {
  return (
    <article data-testid={testId} className={`bubble ${variant}`}>
      {author ? <p className="bubble__author">{author}</p> : null}
      <p>{body}</p>
      <time dateTime={createdAt}>{formatClock(createdAt)}</time>
    </article>
  );
}
