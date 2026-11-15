// check-compose (Axle, app-kolibri-studio#1): refuse an x-app.version the Engine reads as unversioned.
// engineIsUnversioned is a verbatim copy of agent-engine-dev src/data/Version.ts isUnversioned (main 721f0fa).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YAML } from 'zx';
import { checkComposeVersion, engineIsUnversioned } from '../../lib/check-compose.mjs';

const compose = (v) => YAML.parse(`x-app:\n  name: demo\n  version: "${v}"\nservices:\n  app:\n    image: x/y:1\n    labels:\n      x-app-version: "${v}"\n`);

it('the Engine rule, case by case (same answers as Version.ts on 721f0fa)', () => {
  for (const v of ['1.1', '1.0', '1.5-31.0.1', '1.6-31.0.1', '1.1-0.19.5', '1.3-3.8.2', '1.0-smoke', 'v1.2', '0.19.5', '999.0'])
    assert.equal(engineIsUnversioned(v), false, v);
  for (const v of ['1.1-2024.12.03', '1.0-2024.12.03', '1.1-2024-12-03', '1.1-v2024.12.03', 'zimbabwe-2026-10-20',
    '1.1-20241203', '1.0-5ab9f64', '1.0-g5ab9f64', '0.0-dev+abcdef123456', 'main', '', '1000.0', '2024.12'])
    assert.equal(engineIsUnversioned(v), true, v);
});

it('x-app.version that reads as unversioned is refused; proper versions and dev bundles pass', () => {
  const errs = checkComposeVersion(compose('1.1-2024.12.03'));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /'1\.1-2024\.12\.03' reads as unversioned to the Engine .* e\.g\. '1\.1'/);
  assert.equal(checkComposeVersion(compose('1.0-5ab9f64')).length, 1);
  assert.equal(checkComposeVersion(compose('2024.12')).length, 1);
  for (const ok of ['1.1', '1.6-31.0.1', '1.1-0.19.5', '0.0-dev+abcdef1234567']) assert.deepEqual(checkComposeVersion(compose(ok)), [], ok);
  assert.deepEqual(checkComposeVersion(compose('1.1'), '1.1'), []);
});
