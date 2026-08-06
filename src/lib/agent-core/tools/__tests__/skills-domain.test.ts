import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSkillDomainFilter } from "../skills";

test("marketing and growth aliases resolve to the operations skill pack", () => {
  assert.equal(normalizeSkillDomainFilter("marketing"), "operations");
  assert.equal(normalizeSkillDomainFilter(" Growth "), "operations");
  assert.equal(normalizeSkillDomainFilter("营销"), "operations");
  assert.equal(normalizeSkillDomainFilter("增长"), "operations");
});

test("existing skill domains remain unchanged", () => {
  assert.equal(normalizeSkillDomainFilter("sales"), "sales");
  assert.equal(normalizeSkillDomainFilter(" OPERATIONS "), "operations");
  assert.equal(normalizeSkillDomainFilter(""), undefined);
  assert.equal(normalizeSkillDomainFilter(undefined), undefined);
});
