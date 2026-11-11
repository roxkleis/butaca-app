const LEGACY_DEPLOYMENT = "https://b96bba2f.butaca-personal.pages.dev";
const IMDB_PATH = "/api/episode-ratings";
const IMDB_ROUTE = /^\/api\/episode-ratings\/(tt[0-9]{7,12})(?:\/([1-9][0-9]{0,3}))?$/;
const IMDB_ID = /^tt[0-9]{7,12}$/;
const RATING_TTL = 900;

function json(data, status = 200, cacheControl = "no-store") {
  return Response.json(data, { status, headers: { "Cache-Control": cacheControl } });
}

export function normalizeEpisodes(rows) {
  const episodes = new Map();
  for (const row of rows) {
    const number = Number(row.number);
    if (!/^[0-9]+$/.test(String(row.number)) || !Number.isSafeInteger(number) || number < 1 ||
        !IMDB_ID.test(row.imdbId ?? "")) continue;

    const previous = episodes.get(number);
    if (previous && previous.imdbId !== row.imdbId) {
      episodes.set(number, { number, imdbId: null, title: "", rating: null });
      continue;
    }

    const score = Number(row.rating);
    const rating = /^[0-9]+(?:\.[0-9]+)?$/.test(String(row.rating)) && score >= 1 && score <= 10
      ? Math.round(score * 10) / 10
      : null;
    episodes.set(number, { number, imdbId: row.imdbId, title: row.title ?? "", rating });
  }
  return [...episodes.values()].sort((a, b) => a.number - b.number);
}

async function omdbRatings(apiKey, imdbId, season) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("i", imdbId);
  if (season) url.searchParams.set("Season", String(season));
  else url.searchParams.set("type", "series");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "manual" });
  if (!response.ok) throw new Error("OMDb no está disponible.");
  const data = await response.json();

  if (data.Response === "False" && /^(?:movie|series|series or episode) not found[!.]?$/i.test(data.Error)) {
    return season ? { episodes: [] } : { seasons: [] };
  }
  if (data.Response !== "True") throw new Error("Respuesta inválida de OMDb.");

  if (season) {
    if (Number(data.Season) !== season || !Array.isArray(data.Episodes)) {
      throw new Error("OMDb devolvió una temporada distinta.");
    }
    const episodes = normalizeEpisodes(data.Episodes.map(episode => ({
      number: episode.Episode,
      imdbId: episode.imdbID,
      title: episode.Title,
      rating: episode.imdbRating,
    })));
    return { episodes };
  }

  if (data.imdbID !== imdbId || data.Type !== "series") throw new Error("OMDb devolvió otro título.");
  const total = Number(data.totalSeasons);
  if (!Number.isInteger(total) || total < 1 || total > 9999) return { seasons: [] };
  return { seasons: Array.from({ length: total }, (_, index) => index + 1) };
}

async function episodeRatings(request, url, env, context) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const match = url.pathname.match(IMDB_ROUTE);
  if (!match) return json({ error: "Identificador de IMDb o temporada inválidos." }, 400);
  const [, imdbId, seasonParam] = match;
  const season = seasonParam ? Number(seasonParam) : null;
  const previewRatings = env.previewRatings;
  if (!previewRatings && !env.OMDB_API_KEY) {
    return json({ error: "Las puntuaciones de IMDb no están configuradas." }, 503);
  }

  const cache = previewRatings ? null : globalThis.caches?.default;
  const cacheKey = new Request(url.origin + url.pathname);
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;

  try {
    const data = previewRatings
      ? await previewRatings(imdbId, season)
      : await omdbRatings(env.OMDB_API_KEY, imdbId, season);
    const ratings = json({ source: "imdb", provider: previewRatings ? "dataset" : "omdb", ...data }, 200,
      previewRatings ? "no-store" : `public, max-age=0, s-maxage=${RATING_TTL}`);
    if (cache) context.waitUntil(cache.put(cacheKey, ratings.clone()).catch(() => {}));
    return ratings;
  } catch {
    return json({ error: "No se pudieron consultar las puntuaciones de IMDb." }, 502);
  }
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === IMDB_PATH || url.pathname.startsWith(IMDB_PATH + "/")) {
      return episodeRatings(request, url, env, context);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    }

    try {
      // La versión publicada sigue atendiendo las funciones ya existentes.
      const response = await fetch(LEGACY_DEPLOYMENT + url.pathname + url.search, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status >= 300 && response.status < 400) throw new Error("Respuesta redirigida.");
      return response;
    } catch {
      return json({ error: "No se pudo consultar Butaca." }, 502);
    }
  },
};
