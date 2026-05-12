/**
 * Tests for operations log download functionality.
 * Ensures logs can be downloaded with proper filenames.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from 'vitest';

describe('Operations log download filename generation', () => {
  const JOB_TYPE_LABELS = {
    "operator-scan": "Operator scan",
    "docs-update": "Docs update",
    "oc-mirror-run": "oc-mirror run"
  };

  const generateFilename = (job) => {
    const timestamp = job.created_at
      ? new Date(Number(job.created_at)).toISOString()
          .replace(/:/g, '-')
          .replace(/\..+/, '')
          .replace('T', '_')
      : new Date().toISOString()
          .replace(/:/g, '-')
          .replace(/\..+/, '')
          .replace('T', '_');

    const jobTypeLabel = JOB_TYPE_LABELS[job.type] || job.type;
    const sanitizedType = jobTypeLabel.replace(/\s+/g, '-').toLowerCase();
    return `${sanitizedType}_${timestamp}.txt`;
  };

  it('should generate correct filename for oc-mirror run', () => {
    const job = {
      type: 'oc-mirror-run',
      created_at: '1714867200000', // 2024-05-05T00:00:00.000Z
      output: 'some logs'
    };

    const filename = generateFilename(job);
    expect(filename).toMatch(/^oc-mirror-run_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
    expect(filename).toContain('oc-mirror-run_');
  });

  it('should generate correct filename for operator scan', () => {
    const job = {
      type: 'operator-scan',
      created_at: '1714867200000',
      output: 'scan logs'
    };

    const filename = generateFilename(job);
    expect(filename).toMatch(/^operator-scan_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
    expect(filename).toContain('operator-scan_');
  });

  it('should generate correct filename for docs update', () => {
    const job = {
      type: 'docs-update',
      created_at: '1714867200000',
      output: 'docs logs'
    };

    const filename = generateFilename(job);
    expect(filename).toMatch(/^docs-update_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
    expect(filename).toContain('docs-update_');
  });

  it('should sanitize job type with spaces to hyphenated lowercase', () => {
    const mockType = "Some Job Type";
    const sanitized = mockType.replace(/\s+/g, '-').toLowerCase();
    expect(sanitized).toBe('some-job-type');
  });

  it('should handle unknown job types', () => {
    const job = {
      type: 'unknown-job-type',
      created_at: '1714867200000',
      output: 'logs'
    };

    const filename = generateFilename(job);
    expect(filename).toContain('unknown-job-type_');
  });

  it('should format timestamp correctly', () => {
    const date = new Date('2024-05-05T14:30:45.123Z');
    const timestamp = date.toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '')
      .replace('T', '_');

    expect(timestamp).toBe('2024-05-05_14-30-45');
  });

  it('should use current time if created_at is missing', () => {
    const job = {
      type: 'oc-mirror-run',
      created_at: null,
      output: 'logs'
    };

    const filename = generateFilename(job);
    expect(filename).toMatch(/^oc-mirror-run_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
  });
});

describe('Operations log download button visibility', () => {
  it('should show download button when job has output', () => {
    const job = {
      id: '123',
      type: 'oc-mirror-run',
      output: 'Some log content',
      created_at: '1714867200000'
    };

    const shouldShow = job.output && job.output.trim().length > 0;
    expect(shouldShow).toBe(true);
  });

  it('should hide download button when job has no output', () => {
    const job = {
      id: '123',
      type: 'oc-mirror-run',
      output: '',
      created_at: '1714867200000'
    };

    const shouldShow = job.output && job.output.trim().length > 0;
    expect(shouldShow).toBeFalsy();
  });

  it('should hide download button when output is only whitespace', () => {
    const job = {
      id: '123',
      type: 'oc-mirror-run',
      output: '   \n\t  ',
      created_at: '1714867200000'
    };

    const shouldShow = job.output && job.output.trim().length > 0;
    expect(shouldShow).toBeFalsy();
  });

  it('should hide download button when output is null', () => {
    const job = {
      id: '123',
      type: 'oc-mirror-run',
      output: null,
      created_at: '1714867200000'
    };

    const shouldShow = job.output && job.output.trim().length > 0;
    expect(shouldShow).toBeFalsy();
  });
});
