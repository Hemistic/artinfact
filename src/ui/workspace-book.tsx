import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PerspectiveBook } from './components/perspective-book.js';

export function mountWorkspaceBook(element: HTMLElement, title: string, author: string) {
  const root = createRoot(element);
  flushSync(() => root.render(
    <PerspectiveBook size="sm" className="workspace-book-cover">
      <div className="spell-perspective-book-content">
        <div className="spell-perspective-book-title" title={title}>{title}</div>
        {author && <div className="spell-perspective-book-author" title={author}>{author}</div>}
      </div>
    </PerspectiveBook>
  ));
  return () => root.unmount();
}
