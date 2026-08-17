/**
 * Proxy seguro entre MaxiCheck y TMDB.
 * La clave se obtiene del secreto TMDB_API_KEY configurado en Cloudflare.
 */
export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("Origin") || "";

        // Durante el desarrollo se permite Live Server; en producción se usa ALLOWED_ORIGIN.
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
            // Normaliza y valida el formato sin revelar nunca el valor recibido.
            const tmdbApiKey = env.TMDB_API_KEY?.trim();

            if (!tmdbApiKey) {
                return jsonResponse(
                    { error: "El secreto TMDB_API_KEY no está disponible en este despliegue." },
                    500,
                    corsOrigin
                );
            }

            if (!/^[a-f0-9]{32}$/i.test(tmdbApiKey)) {
                return jsonResponse(
                    { error: "TMDB_API_KEY no tiene el formato de una API Key v3 válida." },
                    500,
                    corsOrigin
                );
            }

            let tmdbUrl;

            if (requestUrl.pathname === "/discover") {
                const age = Number(requestUrl.searchParams.get("age"));
                const requestedPage = Number(requestUrl.searchParams.get("page") || "1");

                if (!Number.isInteger(age) || age < 1 || age > 120) {
                    return jsonResponse({ error: "La edad indicada no es válida." }, 400, corsOrigin);
                }

                if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 500) {
                    return jsonResponse({ error: "La página solicitada no es válida." }, 400, corsOrigin);
                }

                const maximumCertification = age < 8
                    ? "G"
                    : age < 13
                        ? "PG"
                        : age < 17
                            ? "PG-13"
                            : age < 18 ? "R" : "NC-17";

                tmdbUrl = new URL("https://api.themoviedb.org/3/discover/movie");
                tmdbUrl.searchParams.set("language", "es-ES");
                tmdbUrl.searchParams.set("certification_country", "US");
                tmdbUrl.searchParams.set("certification.lte", maximumCertification);
                tmdbUrl.searchParams.set("include_adult", "false");
                tmdbUrl.searchParams.set("include_video", "false");
                tmdbUrl.searchParams.set("sort_by", "popularity.desc");
                tmdbUrl.searchParams.set("vote_count.gte", "25");
                tmdbUrl.searchParams.set("primary_release_date.lte", new Date().toISOString().slice(0, 10));
                tmdbUrl.searchParams.set("page", String(requestedPage));
            } else if (requestUrl.pathname === "/search") {
                const query = requestUrl.searchParams.get("query")?.trim();
                const requestedPage = Number(requestUrl.searchParams.get("page") || "1");

                if (!query) {
                    return jsonResponse(
                        { error: "Debes indicar una película." },
                        400,
                        corsOrigin
                    );
                }

                if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 500) {
                    return jsonResponse(
                        { error: "La página solicitada no es válida." },
                        400,
                        corsOrigin
                    );
                }

                tmdbUrl = new URL("https://api.themoviedb.org/3/search/movie");
                tmdbUrl.searchParams.set("query", query);
                tmdbUrl.searchParams.set("language", "es-ES");
                tmdbUrl.searchParams.set("page", String(requestedPage));
            } else {
                const releaseDatesRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/release-dates$/
                );
                const creditsRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/credits$/
                );
                const detailsRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/details$/
                );
                const translationsRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/translations$/
                );
                const watchProvidersRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/watch-providers$/
                );
                const exploreRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/explore$/
                );
                const videosRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/videos$/
                );
                const recommendationsRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/recommendations$/
                );
                const similarRoute = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/similar$/
                );
                const collectionRoute = requestUrl.pathname.match(
                    /^\/collection\/(\d+)$/
                );

                if (releaseDatesRoute) {
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${releaseDatesRoute[1]}/release_dates`
                    );
                } else if (creditsRoute) {
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${creditsRoute[1]}/credits`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                } else if (detailsRoute) {
                    // Aporta duración, géneros, idiomas, países y colección.
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${detailsRoute[1]}`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                } else if (translationsRoute) {
                    // Permite diferenciar los títulos en inglés y español de España.
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${translationsRoute[1]}/translations`
                    );
                } else if (watchProvidersRoute) {
                    // Devuelve disponibilidad territorial de suscripción, alquiler y compra.
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${watchProvidersRoute[1]}/watch/providers`
                    );
                } else if (exploreRoute) {
                    // Carga bajo demanda imágenes, videos, palabras clave, títulos e IDs externos.
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${exploreRoute[1]}`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                    tmdbUrl.searchParams.set(
                        "append_to_response",
                        "images,videos,keywords,external_ids,alternative_titles"
                    );
                    tmdbUrl.searchParams.set("include_image_language", "es,en,null");
                } else if (videosRoute) {
                    // Sin filtro regional para conservar tráileres internacionales disponibles.
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${videosRoute[1]}/videos`
                    );
                } else if (recommendationsRoute) {
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${recommendationsRoute[1]}/recommendations`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                } else if (similarRoute) {
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/movie/${similarRoute[1]}/similar`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                } else if (collectionRoute) {
                    tmdbUrl = new URL(
                        `https://api.themoviedb.org/3/collection/${collectionRoute[1]}`
                    );
                    tmdbUrl.searchParams.set("language", "es-ES");
                } else {
                    return jsonResponse({ error: "Ruta no encontrada." }, 404, corsOrigin);
                }
            }

            // La credencial se añade únicamente en el servidor de Cloudflare.
            tmdbUrl.searchParams.set("api_key", tmdbApiKey);

            const tmdbResponse = await fetch(tmdbUrl, {
                headers: { Accept: "application/json" }
            });
            const data = await tmdbResponse.json();

            return jsonResponse(data, tmdbResponse.status, corsOrigin);
        } catch (error) {
            return jsonResponse(
                { error: "No fue posible comunicarse con TMDB." },
                502,
                corsOrigin
            );
        }
    }
};

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
    };
}

function jsonResponse(data, status, origin) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            ...corsHeaders(origin)
        }
    });
}
