import assert from "node:assert/strict";
import test from "node:test";
import worker, { normalizeEpisodes } from "../public/_worker.js";

const series = "tt23112594";
const url = "https://butaca.example/api/episode-ratings/" + series;
const env = { OMDB_API_KEY: "clave-de-prueba" };

test("consulta IMDb por serie y temporada sin recurrir a las notas de TMDB", async t => {
  const upstream = t.mock.method(globalThis, "fetch", async request => {
    assert.equal(request.origin, "https://www.omdbapi.com");
    assert.equal(request.searchParams.get("i"), series);
    if (!request.searchParams.has("Season")) {
      return Response.json({ Response: "True", Type: "series", imdbID: series, totalSeasons: "2" });
    }
    assert.equal(request.searchParams.get("Season"), "1");
    return Response.json({ Response: "True", Season: "1", Episodes: [
      { Episode: "8", imdbID: "tt38934502", imdbRating: "9.5", vote_average: 7.5, Title: "Forever" },
      { Episode: "7", imdbID: "tt38934500", imdbRating: "9.0", Title: "Immolation" },
      { Episode: "4", imdbID: "tt38934485", imdbRating: "N/A", vote_average: 7.7 },
    ] });
  });
  assert.deepEqual(await (await worker.fetch(new Request(url), env)).json(),
    { source: "imdb", provider: "omdb", seasons: [1, 2] });
  const response = await worker.fetch(new Request(url + "/1"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).episodes.map(({ number, rating }) => [number, rating]),
    [[4, null], [7, 9.0], [8, 9.5]]);
  assert.equal(upstream.mock.callCount(), 2);
});

test("deja vacías las notas inválidas y los números de episodio ambiguos", () => {
  const rows = [
    { number: "1", imdbId: "tt23134204", rating: 10 },
    { number: 2, imdbId: "tt38934465", rating: true },
    { number: 3, imdbId: "tt38934479", rating: "11" },
    { number: 4, imdbId: "tt38934485", rating: "8.4" },
    { number: 4, imdbId: "tt38934491", rating: "7.6" },
    { number: 0, imdbId: "tt38934495", rating: "8.1" },
  ];
  assert.deepEqual(normalizeEpisodes(rows).map(({ number, rating }) => [number, rating]),
    [[1, 10], [2, null], [3, null], [4, null]]);
});

test("rechaza identificadores, temporadas y métodos inválidos antes de consultar el proveedor", async () => {
  assert.equal((await worker.fetch(new Request(url + "/0"), env)).status, 400);
  assert.equal((await worker.fetch(new Request(url.replace(series, "213375")), env)).status, 400);
  assert.equal((await worker.fetch(new Request(url, { method: "POST" }), env)).status, 405);
  assert.equal((await worker.fetch(new Request(url), {})).status, 503);
});

test("distingue una temporada ausente de un error del proveedor", async t => {
  const upstream = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ Response: "False", Error: "Series or episode not found!" }));
  const absent = await worker.fetch(new Request(url + "/2"), env);
  assert.equal(absent.status, 200);
  assert.deepEqual((await absent.json()).episodes, []);
  upstream.mock.mockImplementation(async () => Response.json({ Response: "True", Season: "1", Episodes: [] }));
  assert.equal((await worker.fetch(new Request(url + "/2"), env)).status, 502);
  upstream.mock.mockImplementation(async () => Response.json({ Response: "False", Error: "Request limit reached!" }));
  assert.equal((await worker.fetch(new Request(url + "/2"), env)).status, 502);
});

test("las consultas existentes conservan su ruta y parámetros", async t => {
  const endpoint = "/api/search?q=VisionQuest&type=tv";
  t.mock.method(globalThis, "fetch", async request => {
    assert.equal(request, "https://b96bba2f.butaca-personal.pages.dev" + endpoint);
    return Response.json({ results: [{ id: 213375 }] });
  });
  const response = await worker.fetch(new Request("https://butaca.example" + endpoint), env);
  assert.deepEqual(await response.json(), { results: [{ id: 213375 }] });
});
