import { Link } from 'react-router-dom';

/** Shown to an admin looking at something students can't see yet. */
export function PreviewBar({ what, section }: { what: string; section: string }) {
  return (
    <p className="m-0 mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-marigold-soft px-4 py-3 text-[14px] text-marigold-text">
      <span>
        <strong>Admin preview.</strong> Students can't see this {what} yet; buying is off.
      </span>
      <Link
        to={`/admin?section=${section}`}
        className="font-semibold text-marigold-text underline underline-offset-4"
      >
        Publish it in Admin
      </Link>
    </p>
  );
}
