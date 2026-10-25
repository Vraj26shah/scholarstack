/** Five boxes, like marks on an answer sheet. */
export function MarksBar({ marks }: { marks: number }) {
  return (
    <div className="flex gap-1.5" role="img" aria-label={`${marks} of 5 attendance marks`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-9 flex-1 grid place-items-center rounded-lg font-mono text-[13px] font-semibold border ${
            n <= marks ? 'bg-teal text-white border-teal' : 'border-white/25 text-on-brand2'
          }`}
        >
          {n}
        </span>
      ))}
    </div>
  );
}
