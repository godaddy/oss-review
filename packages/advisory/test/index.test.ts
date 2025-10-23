import { describe, it } from 'node:test';
import assume from 'assume';

import {
  applyIgnoreRules,
  createEmptySummary,
  loadIgnoreRules,
  mergeIgnoreRules,
  meetsSeverityThreshold,
  normaliseSeverity,
  summariseFindings
} from '../index.ts';

import type { AdvisoryFinding } from '../index.ts';

const sampleFindings: AdvisoryFinding[] = [
  { id: 'GHSA-001', packageName: 'left-pad', severity: 'high', source: 'npm-audit' },
  { id: 'GHSA-002', packageName: 'uuid', severity: 'low', source: 'npm-audit' },
  { id: 'CVE-003', packageName: 'lodash', severity: 'critical', source: 'npm-audit' }
];

describe('packages/advisory', () => {
  it('normalises severities', () => {
    assume(normaliseSeverity('High')).equals('high');
    assume(normaliseSeverity('moderate')).equals('medium');
    assume(normaliseSeverity('informational')).equals('info');
    assume(normaliseSeverity(undefined)).equals('unknown');
  });

  it('summarises findings by severity', () => {
    const summary = summariseFindings(sampleFindings);
    assume(summary.total).equals(3);
    assume(summary.high).equals(1);
    assume(summary.low).equals(1);
    assume(summary.critical).equals(1);
    assume(summary.medium).equals(0);
  });

  it('checks severity thresholds', () => {
    assume(meetsSeverityThreshold('high', 'medium')).equals(true);
    assume(meetsSeverityThreshold('low', 'medium')).equals(false);
  });

  it('creates empty summaries', () => {
    const summary = createEmptySummary();
    assume(summary.total).equals(0);
    assume(summary.high).equals(0);
  });

  it('applies ignore rules', () => {
    const { findings, ignored, warnings } = applyIgnoreRules(sampleFindings, [{ id: 'GHSA-002' }]);
    assume(findings.length).equals(2);
    assume(ignored.length).equals(1);
    assume(warnings.length).equals(0);
  });

  it('merges ignore rules by id and package', () => {
    const merged = mergeIgnoreRules(
      [{ id: 'GHSA-001', packageName: 'left-pad' }],
      [{ id: 'GHSA-001', packageName: 'left-pad', reason: 'duplicate' }],
      [{ id: 'GHSA-009' }]
    );
    assume(merged.length).equals(2);
  });

  it('loads ignore files', async () => {
    const rules = await loadIgnoreRules(new URL('./fixtures/ignore.json', import.meta.url).pathname);
    assume(rules.length).equals(1);
    assume(rules[0].id).equals('GHSA-example');
  });
});


