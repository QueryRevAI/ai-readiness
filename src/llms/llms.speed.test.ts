import { describe, expect, it } from 'vitest';
import { validateLlmsTxt } from './index';

// Timing tests: they run alone, in the gate's speed stage (`*.speed.test.*`), because under the
// parallel load of the other tests a linear check was once measured above its 100 ms limit.

describe('adversarial llms.txt at the cap', () => {
  const MIB = 1024 * 1024;
  // The fastest of three runs, so a busy machine does not fail a linear parser; a
  // super-linear one takes seconds to minutes on these inputs.
  const timed = (work: () => unknown) => {
    let fastest = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      work();
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  };

  it.each([
    ['a line of [', '['.repeat(MIB)],
    ['[ then one ] far away', `${'['.repeat(MIB - 1)}]`],
    ['link starts with no target', '[a]('.repeat(MIB / 4)],
    ['unclosed titles', '[a](x "'.repeat(MIB / 7)],
    ['list items of [', `## A\n${'- ['.repeat(MIB / 3)}`],
    ['images', '![a](b)'.repeat(MIB / 7)],
  ])('checks a file of %s quickly', (_name, body) => {
    expect(
      timed(() =>
        validateLlmsTxt({
          status: 200,
          contentType: 'text/plain',
          body: `# T\n${body}`,
          truncated: true,
        }),
      ),
    ).toBeLessThan(100);
  });
});
