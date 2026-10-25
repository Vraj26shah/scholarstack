import { useState } from 'react';
import { type AttendanceResult, evaluate } from './domain';

/** The subject being typed in: its three fields and the live result (or the input problem). */
export function useSubjectDraft() {
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [attended, setAttended] = useState('');
  const touched = total !== '' || attended !== '';
  const evaluated = touched ? evaluate(Number(attended || 0), Number(total || 0)) : null;
  const result: AttendanceResult | null = evaluated && !('error' in evaluated) ? evaluated : null;
  const error = evaluated && 'error' in evaluated ? evaluated.error : null;
  return {
    name,
    total,
    attended,
    setName,
    setTotal,
    setAttended,
    result,
    error,
    clear: () => {
      setName('');
      setTotal('');
      setAttended('');
    },
  };
}
export type SubjectDraft = ReturnType<typeof useSubjectDraft>;
