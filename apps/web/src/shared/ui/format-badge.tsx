import type { FileFormat } from '@ss/contracts';
import { FORMAT_LABEL, type FormatKind, formatKind } from '../../lib/format';

/** A page, a slide or a picture. */
function FormatGlyph({ kind }: { kind: FormatKind }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (kind === 'pptx')
    return (
      <svg {...common}>
        <rect x="1.75" y="4" width="12.5" height="8.25" rx="1.2" />
        <path d="M4.25 6.75h5.5" />
        <path d="M4.25 9.5h7.5" strokeWidth={1.3} />
      </svg>
    );
  if (kind === 'image')
    return (
      <svg {...common}>
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.2" />
        <circle cx="5.6" cy="6.4" r="1.15" />
        <path d="M3.5 12l3-3 2.1 2.1 1.9-1.9 2.2 2.2" strokeWidth={1.3} />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 1.75h5.25l2.75 2.75v9.75H4z" />
      <path d="M9.25 1.75v2.75H12" strokeWidth={1.3} />
      <path d="M6 8.25h4M6 10.75h4" strokeWidth={1.3} />
    </svg>
  );
}

/** Format chip: label + glyph, each format in its own colour. `sm` fits quiet meta lines. */
export function FormatBadge({
  format,
  name,
  sm = false,
  className = '',
}: {
  format: FileFormat;
  name?: string;
  sm?: boolean;
  className?: string;
}) {
  const kind = formatKind(format, name ?? '');
  const label = kind === 'txt' ? 'TXT' : FORMAT_LABEL[kind];
  return (
    <span className={`fmt-${kind} fmt-badge font-mono ${sm ? 'fmt-sm' : ''} ${className}`}>
      <FormatGlyph kind={kind} />
      {label}
    </span>
  );
}

/** "PDF + PPT" for card meta lines, each label in its own colour. */
export function FormatsLine({ formats, className = '' }: { formats: FileFormat[]; className?: string }) {
  if (!formats.length) return <span className={className}>—</span>;
  return (
    <span className={className}>
      {formats.map((f, i) => (
        <span key={f}>
          {i > 0 && <span className="text-ink2"> + </span>}
          <span className={`fmt-${f} fmt-ink`}>{FORMAT_LABEL[f]}</span>
        </span>
      ))}
    </span>
  );
}
