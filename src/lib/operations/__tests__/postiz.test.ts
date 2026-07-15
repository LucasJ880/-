import { strict as assert } from "node:assert";
import { buildPostizPostPayload, getPostizApiBaseUrl } from "../postiz";

assert.equal(getPostizApiBaseUrl("https://api.postiz.com"), "https://api.postiz.com/public/v1");
assert.equal(getPostizApiBaseUrl("https://ops.example.com"), "https://ops.example.com/api/public/v1");
assert.equal(getPostizApiBaseUrl("https://ops.example.com/api"), "https://ops.example.com/api/public/v1");

const payload = buildPostizPostPayload({
  scheduledAt: new Date("2026-07-16T15:00:00.000Z"),
  captionText: "智能遮阳方案",
  hashtags: "#窗帘",
  platform: "instagram",
  integrationId: "ig-1",
  media: { id: "media-1", path: "https://cdn.example.com/video.mp4" },
});
assert.equal(payload?.type, "schedule");
assert.deepEqual(payload?.posts, [{
  integration: { id: "ig-1" },
  value: [{ content: "智能遮阳方案\n\n#窗帘", image: [{ id: "media-1", path: "https://cdn.example.com/video.mp4" }] }],
  settings: { __type: "instagram", post_type: "post", is_trial_reel: false, collaborators: [] },
}]);
assert.equal(buildPostizPostPayload({
  scheduledAt: null,
  captionText: "x",
  hashtags: null,
  platform: "tiktok",
  integrationId: "tt-1",
  media: { id: "media-1", path: "https://cdn.example.com/video.mp4" },
}), null);

console.log("postiz cloud integration: 6/6 passed");
