// Returns a preformatted memory-check block from vars.block. The block carries
// the prior conversation, the current user turn, and the assistant reply so the
// llm-rubric grader can judge memory consistency without any product call.
export default class PrecomputedBlockProvider {
  id = () => 'precomputed-block';

  callApi = async (_prompt, context) => {
    const block = context?.vars?.block;
    if (typeof block !== 'string') return {error: 'missing vars.block'};
    return {output: block};
  };
}
