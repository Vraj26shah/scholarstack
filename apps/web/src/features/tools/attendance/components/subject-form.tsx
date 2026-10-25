import { Button } from '../../../../shared/ui/button';
import { Labelled, ToolCard, field } from '../../core/ui';
import type { SubjectDraft } from '../use-subject-draft';

/** The inputs for one subject. Shows the draft; saving is the parent's decision. */
export function SubjectForm({ draft, onSave }: { draft: SubjectDraft; onSave: () => void }) {
  return (
    <ToolCard title="One subject">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Subject (optional)" className="sm:col-span-2">
          <input
            className={field}
            value={draft.name}
            onChange={(e) => draft.setName(e.target.value)}
            placeholder="e.g. Data Structures"
          />
        </Labelled>
        <Labelled label="Classes held">
          <input
            className={field}
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.total}
            onChange={(e) => draft.setTotal(e.target.value)}
          />
        </Labelled>
        <Labelled label="Classes you attended">
          <input
            className={field}
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.attended}
            onChange={(e) => draft.setAttended(e.target.value)}
          />
        </Labelled>
      </div>
      {draft.error && (
        <p role="alert" className="m-0 text-sm text-blush-text font-semibold">
          {draft.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="brand" disabled={!draft.result} onClick={onSave}>
          Save this subject
        </Button>
        <Button variant="ghost" onClick={draft.clear}>
          Clear
        </Button>
      </div>
    </ToolCard>
  );
}
