import { describe, expect, it } from 'vitest';
import { engineFor, isMatchup, matchupTitle } from '../src/match';
describe('matchup selection', () => {
  it('preserves the original game and selects Luna only for the right player', () => {
    expect(engineFor('jev-vs-jev', 'left')).toBe('jev');expect(engineFor('jev-vs-jev', 'right')).toBe('jev');
    expect(engineFor('jev-vs-luna', 'left')).toBe('jev');expect(engineFor('jev-vs-luna', 'right')).toBe('luna');
    expect(matchupTitle('jev-vs-luna')).toBe('Jev vs Luna Pong');
  });
  it('rejects arbitrary models and unknown matchups', () => {
    expect(isMatchup('jev-vs-luna')).toBe(true);expect(isMatchup('jev-vs-jev')).toBe(true);
    for(const value of ['gpt-6-astra','luna-vs-luna',null,undefined,{}])expect(isMatchup(value)).toBe(false);
  });
});
