import { Link } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { ShelfIcon } from '../../shared/ui/icons';
import { AppHero, AppScreen } from './app-ui';
import { NotesBrowser } from './notes-browser';

/** /app/notes: handwritten notes from seniors. Search, or pick year and branch, then a course. */
export default function NotesPage() {
  const status = useSession((s) => s.status);
  return (
    <Page>
      <AppScreen>
        <div className="flex items-end justify-between gap-3">
          <AppHero eyebrow="Handwritten by seniors" title="Your notes" />
          {status === 'ready' && (
            <Link
              to="/shelf"
              className="flex-none mb-1 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-brand text-white text-[13.5px] font-bold no-underline press"
            >
              <ShelfIcon size={16} /> My shelf
            </Link>
          )}
        </div>
        <NotesBrowser />
      </AppScreen>
    </Page>
  );
}
