import { newId, useToolState } from '../core/storage';
import { ToolHeader } from '../core/ui';
import { AttendanceResultPanel } from './components/attendance-result';
import { RulesCard } from './components/rules-card';
import { type SavedSubject, SavedSubjects } from './components/saved-subjects';
import { SubjectForm } from './components/subject-form';
import { useSubjectDraft } from './use-subject-draft';

/** Composes the form, the live result and the saved list. */
export default function AttendanceTool() {
  const draft = useSubjectDraft();
  const [subjects, setSubjects] = useToolState<SavedSubject[]>('attendance_subjects', []);
  const save = () => {
    if (!draft.result) return;
    setSubjects((xs) => [
      ...xs,
      {
        id: newId(),
        name: draft.name.trim() || `Subject ${xs.length + 1}`,
        attended: Number(draft.attended),
        total: Number(draft.total),
      },
    ]);
    draft.clear();
  };
  return (
    <div className="flex flex-col gap-6">
      <ToolHeader
        number="02"
        title="Attendance calculator"
        lead="Whether you can sit the exam, how many classes you can still miss, and your attendance marks."
      />
      {/* Phone order: form, result, saved, rules. Desktop: form and saved on the left, the
          result and rules on the right, staying in view. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <div className="min-w-0 lg:col-start-1">
          <SubjectForm draft={draft} onSave={save} />
        </div>
        <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6">
          <AttendanceResultPanel result={draft.result} />
          <div className="hidden lg:block">
            <RulesCard />
          </div>
        </div>
        <div className="min-w-0 lg:col-start-1">
          <SavedSubjects subjects={subjects} onChange={setSubjects} />
        </div>
        <div className="lg:hidden">
          <RulesCard />
        </div>
      </div>
    </div>
  );
}
