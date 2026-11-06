import { describe, expect, it } from 'vitest';
import { fileFormatLabel } from './format';

describe('fileFormatLabel', () => {
  it('shows text imports as TXT even though they use the document conversion path', () => {
    expect(fileFormatLabel('docx', 'Unit 1 short notes.txt')).toBe('TXT');
  });

  it('keeps regular document labels unchanged', () => {
    expect(fileFormatLabel('docx', 'lecture-notes.docx')).toBe('DOC');
  });
});
