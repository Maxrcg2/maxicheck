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

            if (requestUrl.pathname === "/search") {
                const query = requestUrl.searchParams.get("query")?.trim();

                if (!query) {
                    return jsonResponse(
                        { error: "Debes indicar una película." },
                        400,
                        corsOrigin
                    );
                }

                tmdbUrl = new URL("https://api.themoviedb.org/3/search/movie");
                tmdbUrl.searchParams.set("query", query);
                tmdbUrl.searchParams.set("language", "es-ES");
            } else {
                const route = requestUrl.pathname.match(
                    /^\/movie\/(\d+)\/release-dates$/
                );

                if (!route) {
                    return jsonResponse({ error: "Ruta no encontrada." }, 404, corsOrigin);
                }

                tmdbUrl = new URL(
                    `https://api.themoviedb.org/3/movie/${route[1]}/release_dates`
                );
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
