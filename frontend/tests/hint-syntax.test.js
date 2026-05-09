/**
 * Test to ensure hint attributes are properly formatted as template literals
 * This prevents JSX parsing errors from long hint strings with special characters
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Hint attribute syntax validation', () => {
  const platformSpecificsPath = join(__dirname, '../src/steps/PlatformSpecificsStep.jsx');

  it('should not have any hint attributes using double-quote strings', () => {
    const content = readFileSync(platformSpecificsPath, 'utf8');

    // Check for hint=" pattern (should use hint={` instead)
    const doubleQuoteHints = content.match(/hint="/g);

    if (doubleQuoteHints) {
      throw new Error(
        `Found ${doubleQuoteHints.length} hint attribute(s) using double-quote strings instead of template literals. ` +
        `Long hints with special characters must use template literal syntax: hint={\`...\`} not hint="..."`
      );
    }
  });

  it('should not have double closing braces after template literals', () => {
    const content = readFileSync(platformSpecificsPath, 'utf8');

    // Check for `}} pattern (common bug when converting from hint="..."}  )
    const lines = content.split('\n');
    const problematicLines = [];

    lines.forEach((line, index) => {
      // Look for hint={`...`}} pattern (double closing brace)
      if (line.includes('hint={`') && line.match(/`\}\}/)) {
        problematicLines.push({
          lineNumber: index + 1,
          content: line.trim().substring(0, 100) + '...'
        });
      }
    });

    if (problematicLines.length > 0) {
      const details = problematicLines
        .map(({ lineNumber, content }) => `  Line ${lineNumber}: ${content}`)
        .join('\n');

      throw new Error(
        `Found ${problematicLines.length} hint attribute(s) with double closing braces:\n${details}\n` +
        `This is likely from converting hint="..."}  to hint={\`...\`}} - should be hint={\`...\`}`
      );
    }
  });

  it('should have properly escaped special characters in template literals', () => {
    const content = readFileSync(platformSpecificsPath, 'utf8');

    // Find all hint={`...`} blocks
    const hintPattern = /hint=\{`([^`]*(?:\\`[^`]*)*)`\}/g;
    let match;
    const issues = [];

    while ((match = hintPattern.exec(content)) !== null) {
      const hintContent = match[1];

      // Check for unescaped backticks (these would break the template literal)
      // Look for ` that's not preceded by \
      const unescapedBacktick = hintContent.match(/(?<!\\)`/);
      if (unescapedBacktick) {
        issues.push({
          type: 'unescaped backtick',
          preview: match[0].substring(0, 100) + '...'
        });
      }

      // Check for ${ that's not escaped (would cause interpolation)
      const unescapedInterpolation = hintContent.match(/(?<!\\)\$\{/);
      if (unescapedInterpolation) {
        issues.push({
          type: 'unescaped ${',
          preview: match[0].substring(0, 100) + '...'
        });
      }
    }

    if (issues.length > 0) {
      const details = issues
        .map(({ type, preview }) => `  ${type}: ${preview}`)
        .join('\n');

      throw new Error(
        `Found ${issues.length} hint(s) with improperly escaped special characters:\n${details}`
      );
    }
  });
});
