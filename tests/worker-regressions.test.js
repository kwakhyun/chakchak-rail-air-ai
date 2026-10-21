import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Execute the real deployment API handler. Only the unrelated page renderer is
// replaced; request parsing, rate limiting, prediction and errors stay intact.
test('배포 Worker도 과도한 탐색을 거부하고 최대 허용 입력을 정상 처리한다', async (t) => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../worker/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
    plugins: [{
      name: 'page-renderer-stub',
      setup(builder) {
        builder.onResolve({ filter: /^vinext\/server\/app-router-entry$/ }, () => ({ path: 'page-renderer', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default { fetch() { throw new Error("Unexpected page rendering"); } };' }));
      }
    }]
  });
  const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  // Host scheduling is unrelated to the input contract. Test deadline failure
  // explicitly below rather than depending on the load of the developer machine.
  let exceedDeadline = false;
  let elapsed = 0;
  t.mock.method(performance, 'now', () => exceedDeadline ? (elapsed += 201) : 0);
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    id: `A${i}`, departureTime: '2030-09-05T20:00:00+09:00', destinationArrivalTime: '2030-09-05T22:00:00+09:00'
  }));
  const activities = Array.from({ length: 4 }, (_, i) => ({
    id: `P${i}`, openingTime: '2030-09-06T09:00:00+09:00', closingTime: '2030-09-06T18:00:00+09:00', durationMinutes: 30
  }));
  const input = { scheduledArrival: '2030-09-05T17:05:00+09:00', candidates, activities };
  const predict = data => worker.fetch(new Request('https://chakchak.test/api/chakchak/predict', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
  }), {}, {});
  for (const invalid of [{ ...input, activities: [...activities, ...activities] }, { ...input, candidates: [...candidates, candidates[0]] }]) {
    const response = await predict(invalid);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'TOO_MANY_CANDIDATES_OR_ACTIVITIES');
  }
  const valid = await predict(input);
  assert.equal(valid.status, 200);
  const result = await valid.json();
  assert.equal(result.candidates.length, 12);
  assert.equal(result.optimization.search.complete, true);
  assert.ok(result.optimization.search.visitedNodes <= 780);
  exceedDeadline = true;
  const exhausted = await predict(input);
  assert.equal(exhausted.status, 503);
  assert.equal((await exhausted.json()).code, 'OPTIMIZATION_BUDGET_EXCEEDED');
});
