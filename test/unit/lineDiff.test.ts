import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/lineDiff';

const lines = (text: string) => (text === '' ? [] : text.split(','));

describe('diffLines', () => {
  it('reports nothing for equal text', () => {
    expect(diffLines(lines('a,b,c'), lines('a,b,c'))).toEqual([]);
  });

  it('finds added lines', () => {
    expect(diffLines(lines('a,c'), lines('a,b,c'))).toEqual([{ kind: 'added', from: 1, to: 2 }]);
    expect(diffLines(lines('a'), lines('a,b,c'))).toEqual([{ kind: 'added', from: 1, to: 3 }]);
    expect(diffLines([], lines('a,b'))).toEqual([{ kind: 'added', from: 0, to: 2 }]);
  });

  it('finds changed lines', () => {
    expect(diffLines(lines('a,b,c'), lines('a,X,c'))).toEqual([
      { kind: 'modified', from: 1, to: 2 },
    ]);
    expect(diffLines(lines('a,b,c'), lines('a,X,Y,c'))).toEqual([
      { kind: 'modified', from: 1, to: 3 },
    ]);
  });

  it('finds removed lines, by the number of lines before them', () => {
    expect(diffLines(lines('a,b,c'), lines('a,c'))).toEqual([{ kind: 'deleted', at: 1 }]);
    expect(diffLines(lines('a,b'), lines('a'))).toEqual([{ kind: 'deleted', at: 1 }]);
    expect(diffLines(lines('a,b'), lines('b'))).toEqual([{ kind: 'deleted', at: 0 }]);
    expect(diffLines(lines('a,b'), [])).toEqual([{ kind: 'deleted', at: 0 }]);
  });

  it('keeps separate changes apart', () => {
    expect(diffLines(lines('a,b,c,d,e,f'), lines('a,B,c,d,e,f,g'))).toEqual([
      { kind: 'modified', from: 1, to: 2 },
      { kind: 'added', from: 6, to: 7 },
    ]);
    expect(diffLines(lines('a,b,c,d,e'), lines('a,c,d,X,e'))).toEqual([
      { kind: 'deleted', at: 1 },
      { kind: 'added', from: 3, to: 4 },
    ]);
  });

  it('copes with a large difference without a huge table', () => {
    const old = Array.from({ length: 3000 }, (_, i) => `old ${i}`);
    const next = Array.from({ length: 3000 }, (_, i) => `new ${i}`);
    expect(diffLines(old, next)).toEqual([{ kind: 'modified', from: 0, to: 3000 }]);
  });
});
