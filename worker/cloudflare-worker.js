/**
 * Proxy seguro entre MaxiCheck y TMDB.
 * Unifica películas, series y documentales sin exponer TMDB_API_KEY al navegador.
 */
export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("Origin") || "";
        const isLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isProductionOrigin = origin === env.ALLOWED_ORIGIN;
        const corsOrigin = isLocalOrigin || isProductionOrigin ? origin : "";

        if (request.method === "OPTIONS") {
            return corsOrigin
                ? new Response(null, { headers: corsHeaders(corsOrigin) })
                : jsonResponse({ error: "Origen no autorizado." }, 403, "null");
        }
        if (request.method !== "GET") {
            return jsonResponse({ error: "Método no permitido." }, 405, corsOrigin || "null");
        }
        if (!corsOrigin) {
            return jsonResponse({ error: "Origen no autorizado." }, 403, "null");
        }

        try {
            const tmdbApiKey = env.TMDB_API_KEY?.trim();
            if (!tmdbApiKey) {
                return jsonResponse({ error: "TMDB_API_KEY no está disponible." }, 500, corsOrigin);
            }
            if (!/^[a-f0-9]{32}$/i.test(tmdbApiKey)) {
                return jsonResponse({ error: "TMDB_API_KEY no tiene un formato válido." }, 500, corsOrigin);
            }

            if (requestUrl.pathname === "/search") {
                return await handleSearch(requestUrl, tmdbApiKey, corsOrigin);
            }
            if (requestUrl.pathname === "/discover") {
                return await handleAgeDiscovery(requestUrl, tmdbApiKey, corsOrigin);
            }
            if (requestUrl.pathname === "/catalog") {
                return await handleCatalog(requestUrl, tmdbApiKey, corsOrigin);
            }

            const collectionRoute = requestUrl.pathname.match(/^\/collection\/(\d+)$/);
            if (collectionRoute) {
                const response = await fetchTmdb(`/collection/${collectionRoute[1]}`, tmdbApiKey, {
                    language: "es-ES"
                });
                response.data.parts = (response.data.parts || []).map(function(item) {
                    return normalizeSummary(item, "movie");
                });
                return jsonResponse(response.data, response.status, corsOrigin);
            }

            const personCreditsRoute = requestUrl.pathname.match(/^\/person\/(\d+)\/(movie-credits|combined-credits)$/);
            if (personCreditsRoute) {
                const response = await fetchTmdb(
                    `/person/${personCreditsRoute[1]}/combined_credits`,
                    tmdbApiKey,
                    { language: "es-ES" }
                );
                response.data.cast = normalizeResultList(response.data.cast);
                response.data.crew = normalizeResultList(response.data.crew);
                return jsonResponse(response.data, response.status, corsOrigin);
            }

            // Una temporada se consulta de forma independiente para no descargar
            // todos sus episodios al abrir por primera vez la ficha de la serie.
            const tvSeasonRoute = requestUrl.pathname.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
            if (tvSeasonRoute) {
                const seasonNumber = Number(tvSeasonRoute[2]);
                if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 1000) {
                    return jsonResponse({ error: "El número de temporada no es válido." }, 400, corsOrigin);
                }

                const response = await fetchTmdb(
                    `/tv/${tvSeasonRoute[1]}/season/${seasonNumber}`,
                    tmdbApiKey,
                    { language: "es-ES" }
                );
                return jsonResponse(response.data, response.status, corsOrigin);
            }

            const contentRoute = requestUrl.pathname.match(
                /^\/(movie|tv)\/(\d+)\/(release-dates|credits|details|translations|watch-providers|explore|videos|recommendations|similar)$/
            );
            if (contentRoute) {
                return await handleContentRoute(contentRoute, tmdbApiKey, corsOrigin);
            }

            return jsonResponse({ error: "Ruta no encontrada." }, 404, corsOrigin);
        } catch (error) {
            return jsonResponse({ error: "No fue posible comunicarse con TMDB." }, 502, corsOrigin);
        }
    }
};

async function handleSearch(requestUrl, apiKey, origin) {
    const query = requestUrl.searchParams.get("query")?.trim();
    const page = parsePage(requestUrl.searchParams.get("page"));
    if (!query) return jsonResponse({ error: "Debes indicar un título." }, 400, origin);
    if (page === null) return jsonResponse({ error: "La página no es válida." }, 400, origin);

    const [moviesResponse, seriesResponse] = await Promise.all([
        fetchTmdb("/search/movie", apiKey, { query, language: "es-ES", include_adult: "false", page }),
        fetchTmdb("/search/tv", apiKey, { query, language: "es-ES", include_adult: "false", page })
    ]);
    const results = [
        ...(moviesResponse.data.results || []).map(function(item) { return normalizeSummary(item, "movie"); }),
        ...(seriesResponse.data.results || []).map(function(item) { return normalizeSummary(item, "tv"); })
    ].sort(function(first, second) {
        return (second.popularity || 0) - (first.popularity || 0);
    });
    return jsonResponse({
        page,
        results,
        total_pages: Math.max(moviesResponse.data.total_pages || 1, seriesResponse.data.total_pages || 1),
        total_results: (moviesResponse.data.total_results || 0) + (seriesResponse.data.total_results || 0)
    }, 200, origin);
}

async function handleAgeDiscovery(requestUrl, apiKey, origin) {
    const age = Number(requestUrl.searchParams.get("age"));
    const page = parsePage(requestUrl.searchParams.get("page"));
    if (!Number.isInteger(age) || age < 1 || age > 120) {
        return jsonResponse({ error: "La edad indicada no es válida." }, 400, origin);
    }
    if (page === null) return jsonResponse({ error: "La página no es válida." }, 400, origin);

    const today = new Date().toISOString().slice(0, 10);
    const movieCertification = age < 8 ? "G" : age < 13 ? "PG" : age < 17 ? "PG-13" : age < 18 ? "R" : "NC-17";
    const [moviesResponse, seriesResponse] = await Promise.all([
        fetchTmdb("/discover/movie", apiKey, {
            language: "es-ES", include_adult: "false", include_video: "false",
            sort_by: "popularity.desc", "vote_count.gte": 25,
            certification_country: "US", "certification.lte": movieCertification,
            "primary_release_date.lte": today, page
        }),
        fetchTmdb("/discover/tv", apiKey, {
            language: "es-ES", include_adult: "false", sort_by: "popularity.desc",
            "vote_count.gte": 25, "first_air_date.lte": today, page
        })
    ]);

    const candidates = [
        ...(moviesResponse.data.results || []).map(function(item) { return normalizeSummary(item, "movie"); }),
        ...(seriesResponse.data.results || []).map(function(item) { return normalizeSummary(item, "tv"); })
    ];
    const verified = await Promise.all(candidates.map(function(item) {
        return verifyContentAge(item, age, apiKey);
    }));
    const results = verified.filter(Boolean).sort(function(first, second) {
        return (second.popularity || 0) - (first.popularity || 0);
    });

    return jsonResponse({
        page,
        results,
        total_pages: Math.max(moviesResponse.data.total_pages || 1, seriesResponse.data.total_pages || 1),
        total_results: results.length,
        candidate_total_results: (moviesResponse.data.total_results || 0) + (seriesResponse.data.total_results || 0),
        results_are_age_verified: true
    }, 200, origin);
}

async function handleCatalog(requestUrl, apiKey, origin) {
    const mode = requestUrl.searchParams.get("mode") || "popular";
    const mediaType = requestUrl.searchParams.get("mediaType") || "all";
    const page = parsePage(requestUrl.searchParams.get("page"));
    if (!["top", "popular", "advanced"].includes(mode)) {
        return jsonResponse({ error: "El catálogo solicitado no es válido." }, 400, origin);
    }
    if (!["all", "movie", "tv", "documentary"].includes(mediaType)) {
        return jsonResponse({ error: "El tipo de contenido no es válido." }, 400, origin);
    }
    if (page === null) return jsonResponse({ error: "La página no es válida." }, 400, origin);

    const validation = validateCatalogFilters(requestUrl);
    if (validation.error) return jsonResponse({ error: validation.error }, 400, origin);

    const types = mediaType === "movie" ? ["movie"] : mediaType === "tv" ? ["tv"] : ["movie", "tv"];
    const forcedGenre = mediaType === "documentary" ? "99" : validation.genre;
    const responses = await Promise.all(types.map(function(type) {
        const params = buildCatalogParameters(type, mode, page, { ...validation, genre: forcedGenre });
        return fetchTmdb(`/discover/${type}`, apiKey, params).then(function(response) {
            return { ...response, mediaType: type };
        });
    }));

    let results = responses.flatMap(function(response) {
        return (response.data.results || []).map(function(item) {
            return normalizeSummary(item, response.mediaType);
        });
    });
    // TV no ofrece un filtro Discover equivalente a certification.lte; se valida título por título.
    if (mode === "advanced" && validation.certification) {
        const maximumAge = getMinimumAge(validation.certification);
        const verified = await Promise.all(results.map(function(item) {
            return verifyContentAge(item, maximumAge, apiKey);
        }));
        results = verified.filter(Boolean);
    }
    sortCatalogResults(results, mode, validation.sort);

    return jsonResponse({
        page,
        results,
        total_pages: Math.max(...responses.map(function(response) { return response.data.total_pages || 1; })),
        total_results: mode === "advanced" && validation.certification
            ? results.length
            : responses.reduce(function(total, response) { return total + (response.data.total_results || 0); }, 0)
    }, 200, origin);
}

function validateCatalogFilters(requestUrl) {
    const allowedGenres = new Set(["12", "14", "16", "18", "27", "28", "35", "36", "53", "80", "99", "878", "9648", "10749", "10751", "10752"]);
    const allowedCertifications = new Set(["G", "PG", "PG-13", "R", "NC-17"]);
    const genre = requestUrl.searchParams.get("genre") || "";
    const country = (requestUrl.searchParams.get("country") || "").trim().toUpperCase();
    const certification = requestUrl.searchParams.get("certification") || "";
    const sort = requestUrl.searchParams.get("sort") || "popularity";
    const score = requestUrl.searchParams.get("score") ? Number(requestUrl.searchParams.get("score")) : null;
    const yearFrom = requestUrl.searchParams.get("yearFrom") ? Number(requestUrl.searchParams.get("yearFrom")) : null;
    const yearTo = requestUrl.searchParams.get("yearTo") ? Number(requestUrl.searchParams.get("yearTo")) : null;
    const maximumYear = new Date().getUTCFullYear() + 5;

    if (genre && !allowedGenres.has(genre)) return { error: "El género no es válido." };
    if (country && !/^[A-Z]{2}$/.test(country)) return { error: "El país no es válido." };
    if (certification && !allowedCertifications.has(certification)) return { error: "La clasificación no es válida." };
    if (!["popularity", "rating", "newest"].includes(sort)) return { error: "El orden no es válido." };
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) return { error: "La puntuación no es válida." };
    if (yearFrom !== null && (!Number.isInteger(yearFrom) || yearFrom < 1880 || yearFrom > maximumYear)) return { error: "El año inicial no es válido." };
    if (yearTo !== null && (!Number.isInteger(yearTo) || yearTo < 1880 || yearTo > maximumYear)) return { error: "El año final no es válido." };
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) return { error: "El año inicial supera al final." };
    return { genre, country, certification, sort, score, yearFrom, yearTo };
}

function buildCatalogParameters(type, mode, page, filters) {
    const today = new Date().toISOString().slice(0, 10);
    const dateField = type === "tv" ? "first_air_date" : "primary_release_date";
    const parameters = { language: "es-ES", include_adult: "false", page };
    parameters[`${dateField}.lte`] = today;

    if (mode === "top") {
        parameters.sort_by = "vote_average.desc";
        parameters["vote_count.gte"] = 500;
    } else if (mode === "popular") {
        parameters.sort_by = "popularity.desc";
        parameters["vote_count.gte"] = 25;
    } else {
        parameters.sort_by = filters.sort === "rating" ? "vote_average.desc" : filters.sort === "newest" ? `${dateField}.desc` : "popularity.desc";
        if (filters.genre) parameters.with_genres = mapGenreForType(filters.genre, type);
        if (filters.country) parameters.with_origin_country = filters.country;
        if (filters.score !== null) parameters["vote_average.gte"] = filters.score;
        if (filters.yearFrom !== null) parameters[`${dateField}.gte`] = `${filters.yearFrom}-01-01`;
        if (filters.yearTo !== null) parameters[`${dateField}.lte`] = `${filters.yearTo}-12-31` < today ? `${filters.yearTo}-12-31` : today;
        if (filters.sort === "rating") parameters["vote_count.gte"] = 100;

        if (filters.certification && type === "movie") {
            parameters.certification_country = "US";
            parameters["certification.lte"] = filters.certification;
        }
    }
    return parameters;
}

// Algunos géneros equivalentes usan identificadores distintos en películas y televisión.
function mapGenreForType(genre, type) {
    if (type !== "tv") return genre;
    const tvGenreMap = {
        "12": "10759", "28": "10759", "14": "10765", "878": "10765",
        "27": "9648", "53": "9648", "36": "18", "10749": "18", "10752": "10768"
    };
    return tvGenreMap[genre] || genre;
}

function sortCatalogResults(results, mode, advancedSort) {
    const sort = mode === "top" ? "rating" : mode === "popular" ? "popularity" : advancedSort;
    results.sort(function(first, second) {
        if (sort === "rating") return (second.vote_average || 0) - (first.vote_average || 0);
        if (sort === "newest") return String(second.release_date || "").localeCompare(String(first.release_date || ""));
        return (second.popularity || 0) - (first.popularity || 0);
    });
}

async function handleContentRoute(route, apiKey, origin) {
    const type = route[1];
    const id = route[2];
    const action = route[3];
    let path = `/${type}/${id}`;
    const parameters = {};

    if (action === "release-dates") path += type === "tv" ? "/content_ratings" : "/release_dates";
    if (action === "credits") { path += "/credits"; parameters.language = "es-ES"; }
    if (action === "details") { parameters.language = "es-ES"; parameters.append_to_response = "external_ids"; }
    if (action === "translations") path += "/translations";
    if (action === "watch-providers") path += "/watch/providers";
    if (action === "videos") path += "/videos";
    if (action === "recommendations" || action === "similar") {
        path += `/${action}`;
        parameters.language = "es-ES";
    }
    if (action === "explore") {
        parameters.language = "es-ES";
        parameters.append_to_response = "images,videos,keywords,external_ids,alternative_titles";
        parameters.include_image_language = "es,en,null";
    }

    const response = await fetchTmdb(path, apiKey, parameters);
    if (action === "release-dates" && type === "tv") response.data = normalizeTvRatings(response.data);
    if (action === "translations") response.data = normalizeTranslations(response.data);
    if (["recommendations", "similar"].includes(action)) response.data.results = normalizeResultList(response.data.results, type);
    if (["details", "explore"].includes(action)) response.data = normalizeDetails(response.data, type);
    return jsonResponse(response.data, response.status, origin);
}

async function verifyContentAge(content, age, apiKey) {
    try {
        const path = content.media_type === "tv"
            ? `/tv/${content.id}/content_ratings`
            : `/movie/${content.id}/release_dates`;
        const response = await fetchTmdb(path, apiKey);
        if (response.status < 200 || response.status >= 300) return null;
        const ratings = content.media_type === "tv"
            ? (response.data.results || []).filter(function(item) { return item.iso_3166_1 === "US"; }).map(function(item) { return item.rating; })
            : (response.data.results || []).filter(function(item) { return item.iso_3166_1 === "US"; }).flatMap(function(item) { return (item.release_dates || []).map(function(release) { return release.certification; }); });
        const recognized = ratings.map(normalizeCertification).filter(function(rating) { return getMinimumAge(rating) !== null; });
        if (recognized.length === 0) return null;
        const certification = recognized.reduce(function(current, next) {
            return getMinimumAge(next) > getMinimumAge(current) ? next : current;
        });
        if (getMinimumAge(certification) > age) return null;
        return { ...content, maxicheck_certification: certification, maxicheck_minimum_age: getMinimumAge(certification) };
    } catch (error) {
        return null;
    }
}

function normalizeResultList(items, fallbackType) {
    return (Array.isArray(items) ? items : [])
        .filter(function(item) { return ["movie", "tv"].includes(item.media_type || fallbackType); })
        .map(function(item) { return normalizeSummary(item, item.media_type || fallbackType); });
}

function normalizeSummary(item, mediaType) {
    const type = mediaType === "tv" ? "tv" : "movie";
    const genreIds = Array.isArray(item.genre_ids)
        ? item.genre_ids
        : Array.isArray(item.genres) ? item.genres.map(function(genre) { return genre.id; }) : [];
    return {
        ...item,
        media_type: type,
        title: item.title || item.name || "Título no disponible",
        original_title: item.original_title || item.original_name || item.title || item.name || "",
        release_date: item.release_date || item.first_air_date || "",
        genre_ids: genreIds,
        maxicheck_is_documentary: genreIds.includes(99)
    };
}

function normalizeDetails(data, type) {
    const normalized = normalizeSummary(data, type);
    return {
        ...normalized,
        runtime: type === "tv" ? data.episode_run_time?.[0] || data.last_episode_to_air?.runtime || null : data.runtime,
        imdb_id: data.imdb_id || data.external_ids?.imdb_id || "",
        maxicheck_number_of_seasons: data.number_of_seasons || null,
        maxicheck_number_of_episodes: data.number_of_episodes || null
    };
}

function normalizeTranslations(data) {
    return {
        ...data,
        translations: (data.translations || []).map(function(translation) {
            return { ...translation, data: { ...translation.data, title: translation.data?.title || translation.data?.name || "" } };
        })
    };
}

function normalizeTvRatings(data) {
    return {
        id: data.id,
        results: (data.results || []).map(function(item) {
            return {
                iso_3166_1: item.iso_3166_1,
                release_dates: [{ certification: item.rating, release_date: null, type: "TV" }]
            };
        })
    };
}

async function fetchTmdb(path, apiKey, parameters = {}) {
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    Object.entries(parameters).forEach(function([key, value]) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    return { data: await response.json(), status: response.status };
}

function parsePage(value) {
    const page = Number(value || "1");
    return Number.isInteger(page) && page >= 1 && page <= 500 ? page : null;
}

function normalizeCertification(certification) {
    return String(certification || "").trim().toUpperCase();
}

function getMinimumAge(certification) {
    const minimumAges = {
        G: 0, PG: 8, "PG-13": 13, R: 17, "NC-17": 18,
        "TV-Y": 0, "TV-Y7": 7, "TV-G": 0, "TV-PG": 8, "TV-14": 14, "TV-MA": 17
    };
    const normalized = normalizeCertification(certification);
    return Object.prototype.hasOwnProperty.call(minimumAges, normalized) ? minimumAges[normalized] : null;
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin"
    };
}

function jsonResponse(data, status, origin) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=UTF-8", ...corsHeaders(origin) }
    });
}
