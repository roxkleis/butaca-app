import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import worker, { normalizeEpisodes } from "./public/_worker.js";

const directory = join(tmpdir(), "butaca-imdb-preview");
const day = 24 * 60 * 60 * 1000;
const downloads = new Map();
const catalogs = new Map();
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/assets/butaca-logo.jpg", ["assets/butaca-logo.jpg", "image/jpeg"]],
  ["/assets/ratings/imdb.svg", ["assets/ratings/imdb.svg", "image/svg+xml"]],
  ["/assets/ratings/letterboxd.svg", ["assets/ratings/letterboxd.svg", "image/svg+xml"]],
  ["/assets/ratings/rottentomatoes.svg", ["assets/ratings/rottentomatoes.svg", "image/svg+xml"]],
]);

async function fetchDataset(name) {
  const path = join(directory, name);
  const current = await stat(path).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (current && Date.now() - current.mtimeMs < day) return path;

  await mkdir(directory, { recursive: true });
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  try {
    const response = await fetch("https://datasets.imdbws.com/" + name, { signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error("No se pudo descargar el archivo de IMDb.");
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await rename(temporary, path);
    return path;
  } finally {
    await rm(temporary, { force: true });
  }
}

function dataset(name) {
  if (!downloads.has(name)) downloads.set(name, fetchDataset(name).finally(() => downloads.delete(name)));
  return downloads.get(name);
}

async function scanDataset(path, visit) {
  await pipeline(createReadStream(path), createGunzip(), async source => {
    let remainder = "";
    for await (const chunk of source) {
      const lines = (remainder + chunk.toString("utf8")).split("\n");
      remainder = lines.pop();
      for (const line of lines) visit(line);
    }
    if (remainder) visit(remainder);
  });
}

async function readCatalog(imdbId) {
  const [episodePath, ratingPath] = await Promise.all([
    dataset("title.episode.tsv.gz"),
    dataset("title.ratings.tsv.gz"),
  ]);
  const matchingSeries = "\t" + imdbId + "\t";
  const episodes = new Map();
  const seasons = new Map();
  await scanDataset(episodePath, line => {
    if (!line.includes(matchingSeries)) return;
    const [id, parent, seasonNumber, number] = line.trimEnd().split("\t");
    if (parent !== imdbId || !/^[1-9][0-9]{0,3}$/.test(seasonNumber) || !/^[0-9]+$/.test(number)) return;
    const season = Number(seasonNumber);
    if (!seasons.has(season)) seasons.set(season, []);
    const episode = { imdbId: id, number, rating: null };
    seasons.get(season).push(episode);
    episodes.set(id, episode);
  });
  if (episodes.size) {
    await scanDataset(ratingPath, line => {
      const episode = episodes.get(line.slice(0, line.indexOf("\t")));
      if (!episode) return;
      const [, rating, votes] = line.split("\t");
      if (Number(votes) > 0) episode.rating = rating;
    });
  }
  return seasons;
}

async function previewRatings(imdbId, season) {
  let entry = catalogs.get(imdbId);
  if (!entry || Date.now() >= entry.expires) {
    if (catalogs.size >= 50) catalogs.delete(catalogs.keys().next().value);
    entry = { expires: Date.now() + 60 * 60 * 1000, result: readCatalog(imdbId) };
    catalogs.set(imdbId, entry);
    entry.result.catch(() => { if (catalogs.get(imdbId) === entry) catalogs.delete(imdbId); });
  }
  const seasons = await entry.result;
  return season ? { episodes: normalizeEpisodes(seasons.get(season) ?? []) }
    : { seasons: [...seasons.keys()].sort((a, b) => a - b) };
}

async function staticAsset(request) {
  const asset = assets.get(new URL(request.url).pathname);
  if (!asset) return new Response(null, { status: 404 });
  const [path, contentType] = asset;
  const body = request.method === "HEAD" ? null : await readFile(new URL("./public/" + path, import.meta.url));
  return new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": "no-cache" } });
}

const port = Number(process.env.BUTACA_PREVIEW_PORT ?? 4310);
const origin = "http://127.0.0.1:" + port;
const env = {
  ASSETS: { fetch: staticAsset },
  OMDB_API_KEY: process.env.OMDB_API_KEY,
  previewRatings: process.env.OMDB_API_KEY ? undefined : previewRatings,
};
createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(origin + incoming.url, { method: incoming.method });
    const response = await worker.fetch(request, env);
    for (const header of ["Content-Type", "Cache-Control", "Allow"]) {
      const value = response.headers.get(header);
      if (value) outgoing.setHeader(header, value);
    }
    outgoing.statusCode = response.status;
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    if (outgoing.headersSent) outgoing.destroy();
    else {
      outgoing.statusCode = 500;
      outgoing.end("Error en la vista previa de Butaca.");
    }
  }
}).listen(port, "127.0.0.1", () => console.log("Butaca disponible en " + origin));
