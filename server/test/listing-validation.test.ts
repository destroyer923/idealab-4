import assert from "node:assert/strict";
import { test } from "node:test";
import { validateListingContent } from "../src/listing/validation.js";

const validNeed = {
  title: "Basic computer lessons",
  category: "Education",
  type: "Skill",
  description: "I can teach basic computer skills including MS Word and Excel to beginners",
  details: "Beginner-friendly lessons",
};

test("meaningful Need and Offer descriptions pass the shared backend validation", () => {
  assert.deepEqual(validateListingContent(validNeed, "need"), {});
  assert.deepEqual(validateListingContent({
    ...validNeed,
    title: "Water pump repair",
    category: "Construction & Repair",
    type: "Service",
    description: "I repair hand pumps and water lines for nearby farms",
    details: "Pump and pipe repairs",
  }, "offer"), {});
});

test("random text, empty fields, and repeated spam are rejected", () => {
  assert.equal(validateListingContent({ ...validNeed, description: "vnhsiruhezuyb" }, "need").description, "err.descriptionWords");
  assert.equal(validateListingContent({ ...validNeed, description: "asdfasdfasdf" }, "need").description, "err.repetitiveContent");
  assert.equal(validateListingContent({ ...validNeed, description: "" }, "need").description, "err.descriptionShort");
  assert.equal(validateListingContent({ ...validNeed, title: "" }, "need").title, "err.titleShort");
});

test("short, useful and multilingual descriptions remain acceptable", () => {
  assert.equal(validateListingContent({ ...validNeed, description: "Need water" }, "need").description, undefined);
  assert.equal(validateListingContent({ ...validNeed, description: "मैं गाँव में कंप्यूटर सिखा सकता हूँ" }, "need").description, undefined);
});

test("the selected category and listing type must belong to the requested listing kind", () => {
  assert.equal(validateListingContent({ ...validNeed, category: "Unknown" }, "need").category, "err.category");
  assert.equal(validateListingContent({ ...validNeed, type: "Transport" }, "need").type, "err.type");
});

test("abusive language and repeated character spam are rejected", () => {
  assert.equal(validateListingContent({ ...validNeed, description: "I can teach useful skills, but this is shit for everyone" }, "need").description, "err.abusiveContent");
  assert.equal(validateListingContent({ ...validNeed, description: "Pleeeeease help me with this useful farm project" }, "need").description, "err.repetitiveContent");
});
