import { DEFAULT_ROYALTY_PERCENT } from '@ss/contracts';
import { LABEL } from '../../shared/copy';
import { StackWord } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { Upload } from '../../shared/ui/icons';

/** The home-page invitation to share notes. */
export function ContributeBand() {
  return (
    <section
      aria-labelledby="contribute-title"
      className="mx-auto max-w-[1280px] px-5 sm:px-9 py-16 sm:py-20"
    >
      <div className="ruled rounded-[22px] px-6 sm:px-10 py-10 sm:py-12 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)] flex flex-wrap items-end justify-between gap-8">
        <div className="flex-[1_1_520px] min-w-0 flex flex-col gap-4">
          <span className="font-mono text-[12px] text-ink2">CONTRIBUTE · GET PAID FOR YOUR NOTES</span>
          <h2
            id="contribute-title"
            className="m-0 font-display font-extrabold text-[clamp(36px,5vw,60px)] leading-[0.95] tracking-[-0.05em]"
          >
            Your notes can <StackWord className="text-teal-text">pay you.</StackWord>
          </h2>
          <p className="m-0 max-w-[620px] text-[16px] sm:text-[17px] leading-relaxed text-ink2">
            Upload notes, past papers or slides. We pay for what we use, and if your notes become a course,
            you get {DEFAULT_ROYALTY_PERCENT}% of every sale.
          </p>
        </div>
        <LinkButton to="/contribute" variant="brand" size="lg">
          <Upload size={18} /> {LABEL.upload}
        </LinkButton>
      </div>
    </section>
  );
}
