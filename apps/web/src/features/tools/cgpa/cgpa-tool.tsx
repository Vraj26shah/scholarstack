import { useState } from 'react';
import { Tabs, ToolHeader } from '../core/ui';
import { NeedTab } from './components/need-tab';
import { OverallTab } from './components/overall-tab';
import { SemesterTab } from './components/semester-tab';

type Section = 'semester' | 'overall' | 'need';

/** Composes the three sections; each section owns its own data and rules. */
export default function CgpaTool() {
  const [section, setSection] = useState<Section>('semester');
  return (
    <div className="flex flex-col gap-6">
      <ToolHeader
        number="01"
        title="CGPA calculator"
        lead="Your semester GPA, your overall CGPA, and the GPA you need next semester to reach a target."
      />
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          ['semester', 'This semester'],
          ['overall', 'Overall CGPA'],
          ['need', 'What I need next'],
        ]}
      />
      {section === 'semester' && <SemesterTab />}
      {section === 'overall' && <OverallTab />}
      {section === 'need' && <NeedTab />}
    </div>
  );
}
