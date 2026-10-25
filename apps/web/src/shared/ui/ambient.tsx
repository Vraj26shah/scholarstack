import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Margin doodles: the marks students leave in their notes (a star, an arrow, ∑, an ER sketch,
 * a little tree). Each one writes itself in, stays a while, fades and is written again, on its
 * own long rhythm, so the margin always feels like someone is still studying in it. They never
 * move or react to the pointer: ink stays where it was written.
 * Positions are % of the host; sizes in px. viewBox is 0 0 120 120 for every doodle.
 */
const DOODLES = {
  star: [
    'M60 16 C 63 34, 66 42, 71 47 C 83 49, 94 51, 103 54 C 93 62, 85 68, 79 74 C 81 87, 83 98, 85 107 C 75 99, 67 93, 60 88 C 52 94, 44 100, 36 106 C 38 96, 40 86, 42 74 C 33 67, 25 60, 17 54 C 28 51, 39 49, 50 47 C 54 39, 57 29, 60 16',
  ],
  arrow: [
    'M12 92 C 30 58, 58 100, 70 66 C 79 40, 50 33, 49 53 C 48 72, 86 74, 106 40',
    'M91 38 L 106 40 L 103 55',
  ],
  sigma: ['M88 24 C 66 22, 46 23, 30 24 C 42 38, 52 50, 63 60 C 52 72, 41 84, 30 97 C 50 96, 70 96, 90 98'],
  er: [
    'M8 47 L 42 46 L 43 71 L 9 72 Z',
    'M43 59 L 55 59',
    'M55 59 L 67 46 L 79 59 L 67 72 Z',
    'M79 59 L 89 59',
    'M89 47 L 114 47 L 114 71 L 89 71 Z',
  ],
  tree: [
    'M60 18 m -7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0',
    'M55 24 L 34 52',
    'M65 24 L 86 52',
    'M34 58 m -7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0',
    'M86 58 m -7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0',
    'M81 64 L 70 90',
    'M91 64 L 102 90',
  ],
  root: [
    'M12 70 L 25 63 L 40 97 L 58 26 L 110 25',
    'M70 45 C 78 56, 88 70, 97 83',
    'M97 45 C 88 57, 79 70, 70 83',
  ],
  circle: ['M28 62 C 22 34, 92 22, 100 54 C 106 84, 40 98, 24 70 C 20 62, 26 52, 36 48'],
  squiggle: ['M8 66 C 22 46, 34 88, 50 66 S 76 46, 90 66 S 108 82, 114 62'],
  aplus: ['M18 98 L 42 24 L 66 98', 'M28 72 L 57 71', 'M86 50 L 86 84', 'M70 67 L 102 67'],
  spiral: [
    'M62 60 C 62 56, 56 55, 55 60 C 54 67, 66 69, 69 60 C 72 49, 57 43, 49 51 C 39 62, 48 79, 63 78 C 81 77, 87 56, 78 44 C 67 30, 40 33, 33 52',
  ],
} as const;
type DoodleName = keyof typeof DOODLES;
type Placement = [DoodleName, number, number, number, number, string?]; // name, x%, y%, size, rotate, extra class

/** Handwritten margin notes: text, x%, y%, px size, rotate, extra class. */
type Note = [string, number, number, number, number, string?];
const NOTES: Record<'hero' | 'panel' | 'card' | 'paper', Note[]> = {
  hero: [
    ['imp!!', 46, 8, 28, -8, 'hidden md:block'],
    ['revise b4 exam', 12, 93, 22, -3, 'hidden sm:block'],
    ['PYQ ✓', 77, 93, 24, 4, 'hidden lg:block'],
  ],
  panel: [
    ['Σ notes = less panic', 70, 90, 22, -3, 'hidden md:block'],
    ['ch. 3 → exam fav', 8, 10, 22, 4, 'hidden lg:block'],
  ],
  card: [],
  paper: [['tap a unit → peek', 30, 88, 22, -4, 'hidden lg:block']],
};

const LAYOUTS: Record<'hero' | 'panel' | 'card' | 'paper', Placement[]> = {
  hero: [
    ['star', 44, 16, 54, -8],
    ['arrow', 47, 58, 92, 6, 'hidden md:block'],
    ['sigma', 3, 84, 60, -6, 'hidden sm:block'],
    ['root', 88, 10, 84, 4, 'hidden md:block'],
    ['tree', 90, 70, 92, -4, 'hidden lg:block'],
    ['circle', 52, 30, 64, 10, 'hidden lg:block'],
    ['aplus', 70, 86, 58, -10, 'hidden lg:block'],
  ],
  panel: [
    ['er', 80, 9, 130, -3, 'hidden md:block'],
    ['spiral', 2, 72, 76, 8],
    ['star', 92, 78, 50, 12, 'hidden sm:block'],
    ['squiggle', 52, 88, 110, -2, 'hidden lg:block'],
  ],
  paper: [
    ['spiral', 4, 74, 60, 8, 'hidden md:block'],
    ['star', 49, 12, 40, -10, 'hidden lg:block'],
    ['squiggle', 52, 94, 96, -2, 'hidden lg:block'],
  ],
  card: [
    ['star', 84, 6, 40, 10],
    ['squiggle', 4, 88, 90, -4],
  ],
};

function Doodle({ placement, index }: { placement: Placement; index: number }) {
  const [name, x, y, size, rotate, extra = ''] = placement;
  // Each doodle gets its own long tempo, so only one or two change at any moment
  // (everything pulsing together is what feels machine-made).
  const start = 0.5 + index * 1.1;
  const cycle = 22 + ((index * 5) % 9);
  return (
    <svg
      viewBox="0 0 120 120"
      className={`doodle doodle-${name} ${extra}`}
      style={
        {
          left: `${x}%`,
          top: `${y}%`,
          width: size,
          height: size,
          transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
          '--cycle': `${cycle}s`,
        } as CSSProperties
      }
    >
      {DOODLES[name].map((d, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed stroke order of a drawing
          key={i}
          d={d}
          pathLength={1}
          style={{ '--delay': `${start + i * 0.35}s` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

/**
 * The live layer behind blue bands: printed-paper grain plus hand-drawn margin doodles.
 * Decorative only (aria-hidden), stroke-dash animation only, and fully drawn but still when
 * reduced motion is on.
 */
export function Ambient({
  tone = 'navy',
  dust = true,
  layout,
  plane = false,
}: {
  tone?: 'navy' | 'paper';
  dust?: boolean;
  layout?: 'hero' | 'panel' | 'card' | 'paper';
  /** A paper plane that flies a slow loop round the band, on a dotted route. */
  plane?: boolean;
}) {
  const name = layout ?? (dust ? 'hero' : 'panel');
  const set = LAYOUTS[name];
  const ref = useRef<HTMLDivElement>(null);
  // The ink is drawn the first time this part of the page comes into view, then stays.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) return void el.setAttribute('data-shown', '');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.setAttribute('data-shown', '');
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} aria-hidden="true" className={`ambient ambient-${tone}`}>
      <span className="ambient-grain" />
      {set.map((placement, i) => (
        <Doodle key={`${placement[0]}-${i}`} placement={placement} index={i} />
      ))}
      {NOTES[name].map(([text, x, y, size, rotate, extra = ''], i) => (
        <span
          key={text}
          className={`margin-note ${extra}`}
          style={
            {
              left: `${x}%`,
              top: `${y}%`,
              fontSize: size,
              transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
              '--delay': `${1.2 + i * 2.1}s`,
              '--cycle': `${26 + ((i * 4) % 9)}s`,
            } as CSSProperties
          }
        >
          {text}
        </span>
      ))}
      {plane && <PaperPlane />}
    </div>
  );
}

/**
 * Flights, as fractions of the band. Each one starts off-screen and ends off-screen on the far
 * side, through the open space under the navigation or below the buttons, so the plane is
 * thrown across the room rather than circling it. One has a little loop-the-loop.
 */
type Pt = [number, number];
const FLIGHTS: { start: Pt; curves: [Pt, Pt, Pt][] }[] = [
  // Left to right, high: in the gap under the navigation, a soft dip in the middle.
  {
    start: [-0.08, 0.17],
    curves: [
      [
        [0.18, 0.12],
        [0.34, 0.22],
        [0.55, 0.16],
      ],
      [
        [0.74, 0.12],
        [0.9, 0.18],
        [1.1, 0.15],
      ],
    ],
  },
  // Right to left, low, under the buttons.
  {
    start: [1.08, 0.86],
    curves: [
      [
        [0.82, 0.97],
        [0.63, 0.8],
        [0.46, 0.92],
      ],
      [
        [0.28, 1.01],
        [0.12, 0.9],
        [-0.1, 0.95],
      ],
    ],
  },
  // Left to right along the bottom, with a loop-the-loop clear of the buttons.
  {
    start: [-0.08, 0.92],
    curves: [
      [
        [0.12, 0.96],
        [0.3, 0.87],
        [0.46, 0.91],
      ],
      [
        [0.58, 0.94],
        [0.6, 0.74],
        [0.52, 0.75],
      ],
      [
        [0.44, 0.76],
        [0.46, 0.95],
        [0.62, 0.92],
      ],
      [
        [0.78, 0.89],
        [0.92, 0.97],
        [1.1, 0.93],
      ],
    ],
  },
  // Right to left, high and slowly sinking, still under the navigation.
  {
    start: [1.08, 0.14],
    curves: [
      [
        [0.82, 0.19],
        [0.62, 0.12],
        [0.44, 0.18],
      ],
      [
        [0.26, 0.22],
        [0.1, 0.16],
        [-0.1, 0.2],
      ],
    ],
  },
];
const flightPath = (f: (typeof FLIGHTS)[number], w: number, h: number) => {
  const p = ([x, y]: Pt) => `${(x * w).toFixed(1)} ${(y * h).toFixed(1)}`;
  return `M${p(f.start)} ${f.curves.map((c) => `C${c.map(p).join(' ')}`).join(' ')}`;
};

/**
 * A paper plane thrown across the hero, again and again, never on the same route twice in a
 * row. It speeds up a touch on the dips and eases on the climbs, rocks gently on the air, and
 * leaves a pencil-dot trail that fades a moment behind it. Moved with transforms only.
 */
function PaperPlane() {
  const box = useRef<HTMLSpanElement>(null);
  const trailSvg = useRef<SVGSVGElement>(null);
  const route = useRef<SVGPathElement>(null);
  const plane = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = box.current;
    const path = route.current;
    const el = plane.current;
    const svg = trailSvg.current;
    if (!host || !path || !el || !svg || reduced()) return;
    let raf = 0;
    let visible = true;
    let last = -1;
    let flight: { len: number; dur: number; t0: number; lastDot: number } | null = null;
    let restUntil = performance.now() + 900;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((e) => {
            visible = e.some((x) => x.isIntersecting);
          })
        : null;
    io?.observe(host);

    const launch = (now: number) => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      let next = Math.floor(Math.random() * FLIGHTS.length);
      if (next === last) next = (next + 1) % FLIGHTS.length;
      last = next;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      path.setAttribute('d', flightPath(FLIGHTS[next]!, width, height));
      const len = path.getTotalLength();
      // A phone gets a slower plane than a monitor, so it reads as the same throw.
      const speed = Math.min(150, Math.max(80, width * 0.11));
      flight = { len, dur: (len / speed) * 1000, t0: now, lastDot: 0 };
    };

    const dot = (x: number, y: number) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
      c.setAttribute('r', '1.6');
      c.setAttribute('class', 'trail-dot');
      c.addEventListener('animationend', () => c.remove());
      svg.appendChild(c);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        if (flight) flight.t0 += 16;
        return;
      }
      if (!flight) {
        el.style.opacity = '0';
        if (now >= restUntil) launch(now);
        return;
      }
      const t = (now - flight.t0) / flight.dur;
      if (t >= 1) {
        flight = null;
        // A short breath, then the next throw: there is nearly always a plane in the air.
        restUntil = now + 700 + Math.random() * 1300;
        return;
      }
      // Never-reversing speed wobble: quicker on the way down, gentler on the way up.
      const p = Math.min(1, t + 0.03 * Math.sin(t * Math.PI * 4));
      const at = path.getPointAtLength(p * flight.len);
      const ahead = path.getPointAtLength(Math.min(flight.len, p * flight.len + 2));
      const heading = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
      const rock = Math.sin(now / 420) * 5;
      el.style.opacity = '1';
      // Flying right to left, mirror it so the plane stays the right way up instead of upside down.
      const flip = Math.abs(heading) > 90 ? ' scaleY(-1)' : '';
      el.style.transform = `translate(${(at.x - 17).toFixed(1)}px, ${(at.y - 17).toFixed(1)}px) rotate(${(heading + rock).toFixed(1)}deg)${flip}`;
      const travelled = p * flight.len;
      if (travelled - flight.lastDot > 13) {
        flight.lastDot = travelled;
        dot(at.x, at.y);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);
  return (
    <span ref={box} className="plane-flight">
      <svg ref={trailSvg} className="plane-trail">
        <path ref={route} fill="none" stroke="none" />
      </svg>
      <span ref={plane} className="paper-plane">
        <svg viewBox="0 0 32 32" width="34" height="34">
          <path d="M2 15 L30 3 L20 29 L15 18 Z" className="paper-plane-wing" />
          <path d="M15 18 L30 3 L13 22 Z" className="paper-plane-fold" />
        </svg>
      </span>
    </span>
  );
}

export function Marquee({ items, className = '' }: { items: string[]; className?: string }) {
  if (!items.length) return null;
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="marquee-row">
      {items.map((item) => (
        <li key={item} className="marquee-item">
          <span className="marquee-dot" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={`marquee ${className}`} style={{ '--n': items.length } as CSSProperties}>
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
