import { summariseUnread } from './unreadSummary';

describe('summariseUnread', () => {
  it('leaves a single reason alone', () => {
    expect(summariseUnread(["Couldn't read this screenshot"])).toEqual([
      "Couldn't read this screenshot",
    ]);
  });

  it('collapses a repeated reason into one line with a count', () => {
    // Four unreadable files used to print the same sentence four times, which is a wall rather
    // than a report. The count is appended rather than folded into the sentence because the
    // sentence is the server's, and pluralising someone else's prose is how copy goes wrong.
    expect(
      summariseUnread([
        "Couldn't read this screenshot",
        "Couldn't read this screenshot",
        "Couldn't read this screenshot",
        "Couldn't read this screenshot",
      ]),
    ).toEqual(["Couldn't read this screenshot (4 of them)"]);
  });

  it('keeps different reasons apart and counts each', () => {
    expect(
      summariseUnread([
        "Couldn't read this screenshot",
        "Couldn't open this link",
        "Couldn't read this screenshot",
      ]),
    ).toEqual(["Couldn't read this screenshot (2 of them)", "Couldn't open this link"]);
  });

  it('keeps the order the server reported them in', () => {
    expect(summariseUnread(['b', 'a', 'b'])).toEqual(['b (2 of them)', 'a']);
  });

  it('has nothing to say about an empty list', () => {
    expect(summariseUnread([])).toEqual([]);
  });
});
