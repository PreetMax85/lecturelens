const QDRANT_URL = process.env.QDRANT_URL; // e.g. https://xyz.cloud.qdrant.io:6333
const QDRANT_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = process.env.QDRANT_COLLECTION || "course_chunks";
const VECTOR_SIZE = 384; // all-MiniLM-L6-v2 output dim (local embeddings)

function headers() {
  return { "Content-Type": "application/json", "api-key": QDRANT_KEY };
}

async function ensureCollection() {
  const check = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    headers: headers(),
  });
  if (check.ok) return; // already exists

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant create collection failed: ${res.status} ${await res.text()}`);
  }
}

async function upsertPoints(points) {
  // points: [{ id, vector, payload }]
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ points }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant upsert failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function search(vector, limit = 5) {
  const res = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Qdrant search failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.result; // array of { id, score, payload }
}

module.exports = { ensureCollection, upsertPoints, search, COLLECTION };
