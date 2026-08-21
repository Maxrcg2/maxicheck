import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./cloudflare-worker.js";

const ORIGIN = "http://localhost:8787";
const ENV = {
    TMDB_API_KEY: "a".repeat(32),
    ALLOWED_ORIGIN: ORIGIN
};

async function requestWorker(path, fetchImpl) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
        return await worker.fetch(new Request(`https://worker.test${path}`, {
            headers: { Origin: ORIGIN }
        }), ENV);
    } finally {
        globalThis.fetch = previousFetch;
    }
}

test("forwards recommendation and similar page numbers to TMDB", async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ page: 3, results: [], total_pages: 8 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    };

    const recommendations = await requestWorker("/movie/550/recommendations?page=3", fetchImpl);
    const similar = await requestWorker("/tv/1396/similar?page=4", fetchImpl);

    assert.equal(recommendations.status, 200);
    assert.equal(similar.status, 200);
    assert.match(requestedUrls[0], /\/movie\/550\/recommendations\?/);
    assert.match(requestedUrls[0], /[?&]page=3(?:&|$)/);
    assert.match(requestedUrls[1], /\/tv\/1396\/similar\?/);
    assert.match(requestedUrls[1], /[?&]page=4(?:&|$)/);
});

test("rejects an invalid recommendation page before calling TMDB", async () => {
    let calledTmdb = false;
    const response = await requestWorker("/movie/550/recommendations?page=0", async () => {
        calledTmdb = true;
        return new Response("{}", { status: 200 });
    });

    assert.equal(calledTmdb, false);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "La página no es válida." });
});
