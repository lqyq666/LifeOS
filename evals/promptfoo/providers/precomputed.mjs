// Returns a precomputed reply from the test case vars. This keeps the eval
// read-only: no LifeOS server call, no new product generation, no model spend
// beyond the grader assertions that promptfoo runs.
export default class PrecomputedProvider {
  id = () => 'precomputed';

  callApi = async (_prompt, context) => {
    const output = context?.vars?.output;
    if (typeof output !== 'string') return {error: 'missing vars.output'};
    return {output};
  };
}
