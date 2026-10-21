import defectGate from './defect-gate.mjs'

// Meta-assertion for CI: the deterministic gate must agree with the expected
// label for every synthetic fixture. This tests the gate itself and costs no
// model calls. Product replies are evaluated separately with the same gate.
export default function gateSelfCheck(output, context) {
  const vars = context?.vars ?? {}
  const expected = vars.expectPass === true || vars.expectPass === 'true'
  const actual = defectGate(output, {vars}).pass
  return {
    pass: actual === expected,
    score: actual === expected ? 1 : 0,
    reason: `gate=${actual} expected=${expected}`,
  }
}
