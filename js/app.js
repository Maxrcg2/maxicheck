// Todas las consultas pasan por el proxy, por lo que la clave nunca llega al navegador.
const API_BASE_URL = "https://maxicheck-api.maxwell-rcg.workers.dev";

// Referencias a los controles que la aplicación actualiza durante cada búsqueda.
const form = document.getElementById("movie-form");
const ageInput = document.getElementById("age");
const movieInput = document.getElementById("movie");
const recommendAgeButton = document.getElementById("recommend-age-button");
const homeButton = document.getElementById("home-button");
const searchResults = document.getElementById("search-results");
const resultToolbar = document.getElementById("result-toolbar");
const backButton = document.getElementById("back-button");
const recommendationSummary = document.getElementById("recommendation-summary");
const result = document.getElementById("result");
const headerResultsCount = document.getElementById("header-results-count");
const headerRecommendation = document.getElementById("header-recommendation");
const headerCertification = document.getElementById("header-certification");
const ratingGuide = document.getElementById("rating-guide");
const savedListButton = document.getElementById("saved-list-button");
const savedListCount = document.getElementById("saved-list-count");
const savedListPanel = document.getElementById("saved-list-panel");
const savedListClose = document.getElementById("saved-list-close");
const savedListContent = document.getElementById("saved-list-content");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleIcon = themeToggle.querySelector("[data-theme-icon]");
const themeToggleLabel = themeToggle.querySelector("[data-theme-label]");
const navHomeButton = document.getElementById("nav-home");
const navTopButton = document.getElementById("nav-top");
const navPopularButton = document.getElementById("nav-popular");
const navAdvancedButton = document.getElementById("nav-advanced");
const filmAffinityNavLink = document.getElementById("nav-filmaffinity");
const imdbNavLink = document.getElementById("nav-imdb");
const rottenTomatoesNavLink = document.getElementById("nav-rotten-tomatoes");
const metacriticNavLink = document.getElementById("nav-metacritic");
const advancedSearchPanel = document.getElementById("advanced-search-panel");
const advancedSearchClose = document.getElementById("advanced-search-close");
const advancedSearchForm = document.getElementById("advanced-search-form");
let currentResultsCount = 0;
let openedFromSavedList = false;
let currentNavigationId = "nav-home";
let catalogRequestVersion = 0;
const SAVED_MOVIES_KEY = "maxicheck-saved-movies";
const THEME_STORAGE_KEY = "maxicheck-theme";
const THEME_OPTIONS = [
    { id: "dark", label: "Oscuro", icon: "☾" },
    { id: "dim", label: "Penumbra", icon: "◐" },
    { id: "light", label: "Claro", icon: "☀" }
];
let savedListRecommendations = [];
let savedRecommendationsCacheKey = "";
let savedListRenderVersion = 0;

// Cambia el tema sin recargar y mantiene sincronizados icono, texto y accesibilidad.
function applyTheme(themeId, persist = true) {
    const themeIndex = THEME_OPTIONS.findIndex(function(theme) { return theme.id === themeId; });
    const currentTheme = THEME_OPTIONS[themeIndex >= 0 ? themeIndex : 0];
    const nextTheme = THEME_OPTIONS[(THEME_OPTIONS.indexOf(currentTheme) + 1) % THEME_OPTIONS.length];

    document.documentElement.dataset.theme = currentTheme.id;
    document.documentElement.style.colorScheme = currentTheme.id === "light" ? "light" : "dark";
    themeToggleIcon.textContent = currentTheme.icon;
    themeToggleLabel.textContent = currentTheme.label;
    themeToggle.setAttribute(
        "aria-label",
        `Tema actual: ${currentTheme.label}. Cambiar a ${nextTheme.label}.`
    );
    themeToggle.title = `Tema ${currentTheme.label}. Siguiente: ${nextTheme.label}`;

    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, currentTheme.id);
        } catch (error) {
            // El cambio visual no depende de que el navegador permita guardar la preferencia.
        }
    }
}

// El atributo fue establecido en <head>; aquí se completa el control interactivo.
function initializeThemeToggle() {
    const initialTheme = document.documentElement.dataset.theme;
    applyTheme(initialTheme, false);

    themeToggle.addEventListener("click", function() {
        const currentIndex = THEME_OPTIONS.findIndex(function(theme) {
            return theme.id === document.documentElement.dataset.theme;
        });
        const nextTheme = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
        applyTheme(nextTheme.id);
    });
}

// El control de apariencia pertenece exclusivamente a la portada limpia de Inicio.
function showThemeToggleOnHome(isHome) {
    themeToggle.hidden = !isHome;
}

initializeThemeToggle();

// TMDB usa nombres de campos distintos para películas y series; MaxiCheck los unifica aquí.
function normalizeContent(content, fallbackType = "movie") {
    const mediaType = content?.media_type === "tv"
        ? "tv"
        : content?.media_type === "movie" ? "movie" : fallbackType === "tv" ? "tv" : "movie";
    const genreIds = Array.isArray(content?.genre_ids)
        ? content.genre_ids
        : Array.isArray(content?.genres) ? content.genres.map(function(genre) { return genre.id; }) : [];

    return {
        ...content,
        media_type: mediaType,
        title: content?.title || content?.name || "Título no disponible",
        original_title: content?.original_title || content?.original_name || content?.title || content?.name || "",
        release_date: content?.release_date || content?.first_air_date || "",
        genre_ids: genreIds,
        maxicheck_is_documentary: content?.maxicheck_is_documentary === true || genreIds.includes(99)
    };
}

function getContentKey(contentOrId, mediaType = "movie") {
    if (typeof contentOrId === "object") {
        const content = normalizeContent(contentOrId);
        return `${content.media_type}:${content.id}`;
    }
    return `${mediaType === "tv" ? "tv" : "movie"}:${contentOrId}`;
}

function getContentTypeLabel(content, short = false) {
    const normalized = normalizeContent(content);
    if (normalized.maxicheck_is_documentary) return short ? "DOC" : "Documental";
    return normalized.media_type === "tv" ? (short ? "SERIE" : "Serie de TV") : (short ? "PELÍCULA" : "Película");
}

function isSameContent(first, second) {
    return getContentKey(first) === getContentKey(second);
}

function getSavedMovies() {
    try {
        const savedMovies = JSON.parse(localStorage.getItem(SAVED_MOVIES_KEY) || "[]");
        return Array.isArray(savedMovies)
            ? savedMovies.map(function(movie) {
                const normalized = normalizeContent(movie, movie.media_type || "movie");
                return {
                    ...normalized,
                    listStatus: movie.listStatus === "watched" ? "watched" : "pending"
                };
            })
            : [];
    } catch (error) {
        return [];
    }
}

function movieIsSaved(movieId, mediaType = "movie") {
    const key = getContentKey(movieId, mediaType);
    return getSavedMovies().some(function(movie) { return getContentKey(movie) === key; });
}

function toggleSavedMovie(movie) {
    const savedMovies = getSavedMovies();
    const normalizedMovie = normalizeContent(movie);
    const existingIndex = savedMovies.findIndex(function(item) { return isSameContent(item, normalizedMovie); });

    if (existingIndex >= 0) {
        savedMovies.splice(existingIndex, 1);
    } else {
        savedMovies.unshift({ ...normalizedMovie, listStatus: "pending" });
    }

    localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(savedMovies));
    return existingIndex < 0;
}

function updateSavedListButton() {
    const total = getSavedMovies().length;
    savedListCount.textContent = String(total);
    savedListButton.setAttribute(
        "aria-label",
        `Abrir Mi lista, ${total} ${total === 1 ? "título" : "títulos"}`
    );
}

function setActiveNavigation(buttonId, rememberSelection = true) {
    document.querySelectorAll(".catalog-nav__button").forEach(function(button) {
        const isActive = button.id === buttonId;
        button.classList.toggle("catalog-nav__button--active", isActive);
        if (isActive) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });

    if (rememberSelection && buttonId !== "saved-list-button") {
        currentNavigationId = buttonId;
    }
}

function renderSavedMovieCard(movie, listStatus) {
    movie = normalizeContent(movie);
    const poster = movie.poster_path
        ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
        : "";
    const year = movie.release_date
        ? movie.release_date.substring(0, 4)
        : "Año desconocido";
    const nextStatus = listStatus === "watched" ? "pending" : "watched";
    const statusLabel = listStatus === "watched" ? "Marcar como pendiente" : "Marcar como vista";

    return `
        <article class="saved-movie-card saved-movie-card--${listStatus}">
            <button type="button" class="saved-movie-open" data-saved-id="${movie.id}" data-media-type="${movie.media_type}">
                ${poster
                    ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                    : `<span class="saved-movie-placeholder">Sin imagen</span>`
                }
                <span><strong>${escapeHtml(movie.title)}</strong><small>${getContentTypeLabel(movie)} · ${year}</small></span>
            </button>
            <div class="saved-movie-actions">
                <button type="button" class="saved-movie-status" data-status-id="${movie.id}" data-media-type="${movie.media_type}" data-next-status="${nextStatus}">${statusLabel}</button>
                <button type="button" class="saved-movie-remove" data-remove-id="${movie.id}" data-media-type="${movie.media_type}" aria-label="Eliminar ${escapeHtml(movie.title)} de Mi lista">Eliminar</button>
            </div>
        </article>
    `;
}

function renderSavedRecommendationCard(movie) {
    movie = normalizeContent(movie);
    const poster = movie.poster_path
        ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
        : "";
    const year = movie.release_date ? movie.release_date.substring(0, 4) : "Año desconocido";

    return `
        <article class="saved-movie-card saved-movie-card--recommendation">
            <button type="button" class="saved-movie-open" data-recommendation-id="${movie.id}" data-media-type="${movie.media_type}">
                ${poster
                    ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                    : `<span class="saved-movie-placeholder">Sin imagen</span>`
                }
                <span>
                    <strong>${escapeHtml(movie.title)}</strong>
                    <small>${getContentTypeLabel(movie)} · ${year} · ${escapeHtml(movie.maxicheck_reason || "Recomendada para ti")}</small>
                </span>
            </button>
            <div class="saved-movie-actions">
                <button type="button" class="saved-recommendation-add" data-add-recommendation-id="${movie.id}" data-media-type="${movie.media_type}">+ Añadir a pendientes</button>
            </div>
        </article>
    `;
}

function renderSavedSection(title, icon, movies, listStatus, emptyText) {
    return `
        <section class="saved-list-section saved-list-section--${listStatus}">
            <header class="saved-list-section__heading">
                <span aria-hidden="true">${icon}</span>
                <div><h3>${title}</h3><p>${movies.length} ${movies.length === 1 ? "título" : "títulos"}</p></div>
            </header>
            ${movies.length > 0
                ? `<div class="saved-list-grid">${movies.map(function(movie) {
                    return renderSavedMovieCard(movie, listStatus);
                }).join("")}</div>`
                : `<p class="saved-list-section__empty">${emptyText}</p>`
            }
        </section>
    `;
}

async function getRecommendationsFromWatched(watchedMovies, allSavedMovies) {
    const watchedKey = watchedMovies.map(getContentKey).sort().join("-");
    const savedKey = allSavedMovies.map(getContentKey).sort().join("-");
    const cacheKey = `${watchedKey}|saved:${savedKey}`;
    if (cacheKey === savedRecommendationsCacheKey) return savedListRecommendations;

    savedRecommendationsCacheKey = cacheKey;
    savedListRecommendations = [];
    if (watchedMovies.length === 0) return [];

    const responses = await Promise.allSettled(watchedMovies.slice(0, 6).map(async function(movie) {
        const response = await fetch(`${API_BASE_URL}/${movie.media_type}/${movie.id}/recommendations`);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.results || []).map(function(recommendation) {
            return { ...normalizeContent(recommendation, movie.media_type), maxicheck_reason: `Porque viste ${movie.title}` };
        });
    }));

    const savedIds = new Set(allSavedMovies.map(getContentKey));
    const recommendationMap = new Map();
    responses.forEach(function(response) {
        if (response.status !== "fulfilled") return;
        response.value.forEach(function(movie) {
            const contentKey = getContentKey(movie);
            if (!movie.id || !movie.title || movie.adult === true || savedIds.has(contentKey) || recommendationMap.has(contentKey)) return;
            recommendationMap.set(contentKey, movie);
        });
    });

    if (savedRecommendationsCacheKey !== cacheKey) return savedListRecommendations;

    savedListRecommendations = Array.from(recommendationMap.values())
        .sort(function(first, second) {
            return (second.vote_average || 0) - (first.vote_average || 0);
        })
        .slice(0, 12);
    return savedListRecommendations;
}

async function renderSavedList() {
    const renderVersion = ++savedListRenderVersion;
    const savedMovies = getSavedMovies();
    const pendingMovies = savedMovies.filter(function(movie) { return movie.listStatus === "pending"; });
    const watchedMovies = savedMovies.filter(function(movie) { return movie.listStatus === "watched"; });

    savedListContent.innerHTML = `
        ${renderSavedSection("Pendientes", "⏳", pendingMovies, "pending", "No tienes títulos pendientes.")}
        ${renderSavedSection("Vistas", "✓", watchedMovies, "watched", "Marca un título como visto para moverlo aquí.")}
        <section class="saved-list-section saved-list-section--recommendations">
            <header class="saved-list-section__heading">
                <span aria-hidden="true">✦</span>
                <div><h3>Recomendaciones para ti</h3><p>Basadas en tus películas y series vistas</p></div>
            </header>
            <div class="saved-recommendations-content">
                ${watchedMovies.length > 0
                    ? `<p class="saved-list-section__empty">Preparando recomendaciones…</p>`
                    : `<p class="saved-list-section__empty">Marca títulos como vistos para recibir recomendaciones.</p>`
                }
            </div>
        </section>
    `;

    if (watchedMovies.length === 0) return;

    const recommendations = await getRecommendationsFromWatched(watchedMovies, savedMovies);
    if (renderVersion !== savedListRenderVersion) return;
    const recommendationsContent = savedListContent.querySelector(".saved-recommendations-content");
    if (!recommendationsContent) return;
    recommendationsContent.innerHTML = recommendations.length > 0
        ? `<div class="saved-list-grid">${recommendations.map(renderSavedRecommendationCard).join("")}</div>`
        : `<p class="saved-list-section__empty">No encontramos recomendaciones nuevas por el momento.</p>`;
}

function openSavedList() {
    setActiveNavigation("saved-list-button", false);
    renderSavedList();
    savedListPanel.hidden = false;
    savedListButton.setAttribute("aria-expanded", "true");
    document.body.classList.add("saved-list-open");
    savedListClose.focus();
}

function closeSavedList() {
    savedListPanel.hidden = true;
    savedListButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("saved-list-open");
    setActiveNavigation(currentNavigationId, false);
    savedListButton.focus();
}

savedListButton.addEventListener("click", openSavedList);
savedListClose.addEventListener("click", closeSavedList);
savedListPanel.addEventListener("click", function(event) {
    if (event.target === savedListPanel) closeSavedList();
});

savedListContent.addEventListener("click", async function(event) {
    const removeButton = event.target.closest(".saved-movie-remove");
    const statusButton = event.target.closest(".saved-movie-status");
    const addRecommendationButton = event.target.closest(".saved-recommendation-add");
    const openButton = event.target.closest(".saved-movie-open");

    if (removeButton) {
        const movieId = Number(removeButton.dataset.removeId);
        const mediaType = removeButton.dataset.mediaType || "movie";
        const contentKey = getContentKey(movieId, mediaType);
        const updatedMovies = getSavedMovies().filter(function(movie) { return getContentKey(movie) !== contentKey; });
        localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(updatedMovies));
        updateSavedListButton();
        renderSavedList();
        return;
    }

    if (statusButton) {
        const movieId = Number(statusButton.dataset.statusId);
        const mediaType = statusButton.dataset.mediaType || "movie";
        const contentKey = getContentKey(movieId, mediaType);
        const nextStatus = statusButton.dataset.nextStatus === "watched" ? "watched" : "pending";
        const updatedMovies = getSavedMovies().map(function(movie) {
            return getContentKey(movie) === contentKey ? { ...movie, listStatus: nextStatus } : movie;
        });
        localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(updatedMovies));
        renderSavedList();
        return;
    }

    if (addRecommendationButton) {
        const movieId = Number(addRecommendationButton.dataset.addRecommendationId);
        const mediaType = addRecommendationButton.dataset.mediaType || "movie";
        const contentKey = getContentKey(movieId, mediaType);
        const recommendation = savedListRecommendations.find(function(movie) {
            return getContentKey(movie) === contentKey;
        });
        if (!recommendation) return;

        const savedMovies = getSavedMovies();
        if (!savedMovies.some(function(movie) { return getContentKey(movie) === contentKey; })) {
            savedMovies.unshift({
                id: recommendation.id,
                title: recommendation.title,
                poster_path: recommendation.poster_path,
                release_date: recommendation.release_date,
                vote_average: recommendation.vote_average,
                overview: recommendation.overview,
                media_type: recommendation.media_type,
                maxicheck_is_documentary: recommendation.maxicheck_is_documentary,
                listStatus: "pending"
            });
            localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(savedMovies));
        }
        updateSavedListButton();
        renderSavedList();
        return;
    }

    if (openButton) {
        const movieId = Number(openButton.dataset.savedId || openButton.dataset.recommendationId);
        const mediaType = openButton.dataset.mediaType || "movie";
        const contentKey = getContentKey(movieId, mediaType);
        const savedMovie = getSavedMovies().find(function(movie) {
            return getContentKey(movie) === contentKey;
        }) || savedListRecommendations.find(function(movie) {
            return getContentKey(movie) === contentKey;
        });
        if (!savedMovie) return;

        movieInput.value = savedMovie.title;
        const age = Number(ageInput.value);

        if (!Number.isFinite(age) || age < 1 || age > 120) {
            closeSavedList();
            searchResults.style.display = "grid";
            searchResults.innerHTML = `<p>Indica tu edad para comprobar el título guardado.</p>`;
            window.scrollTo({ top: 0, behavior: "smooth" });
            ageInput.focus();
            return;
        }

        closeSavedList();
        openedFromSavedList = true;
        searchResults.style.display = "none";
        resultToolbar.hidden = false;
        backButton.hidden = false;
        form.classList.add("form--detail");
        hideSearchResultsCount();
        result.innerHTML = `<p class="loading-message">Cargando título guardado…</p>`;

        try {
            const searchResponse = await fetch(
                `${API_BASE_URL}/search?query=${encodeURIComponent(savedMovie.title)}`
            );
            if (!searchResponse.ok) throw new Error("No fue posible buscar el título.");
            const searchData = await searchResponse.json();
            const completeMovie = searchData.results.find(function(movie) {
                return isSameContent(movie, savedMovie);
            }) || savedMovie;
            await showContentDetails(completeMovie, age);
        } catch (error) {
            result.innerHTML = `<p class="detail-error">No pudimos abrir este título guardado.</p>`;
        }
    }
});

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && !savedListPanel.hidden) closeSavedList();
});

updateSavedListButton();

// Conserva la preferencia de la guía durante la pestaña actual del navegador.
try {
    ratingGuide.open = sessionStorage.getItem("maxicheck-rating-guide") === "open";
    ratingGuide.addEventListener("toggle", function() {
        sessionStorage.setItem(
            "maxicheck-rating-guide",
            ratingGuide.open ? "open" : "closed"
        );
    });
} catch (error) {
    // La guía sigue funcionando aunque el navegador bloquee el almacenamiento.
}

function showSearchResultsCount(totalResults) {
    currentResultsCount = Number(totalResults) || 0;

    if (currentResultsCount === 0) {
        headerResultsCount.textContent = "Sin resultados";
    } else if (currentResultsCount === 1) {
        headerResultsCount.textContent = "1 resultado encontrado";
    } else {
        headerResultsCount.textContent = `${currentResultsCount} resultados encontrados`;
    }

    headerResultsCount.hidden = false;
}

function hideSearchResultsCount() {
    headerResultsCount.hidden = true;
    headerResultsCount.textContent = "";
}

// Mientras no hay una película abierta, los accesos externos llevan a la portada de cada servicio.
function resetExternalMovieLinks() {
    const defaultLinks = [
        [filmAffinityNavLink, "https://www.filmaffinity.com/es/", "Abrir FilmAffinity"],
        [imdbNavLink, "https://www.imdb.com/", "Abrir IMDb"],
        [rottenTomatoesNavLink, "https://www.rottentomatoes.com/", "Abrir Rotten Tomatoes"],
        [metacriticNavLink, "https://www.metacritic.com/", "Abrir Metacritic"]
    ];

    defaultLinks.forEach(function([link, url, label]) {
        link.href = url;
        link.setAttribute("aria-label", `${label} en una pestaña nueva`);
        link.title = label;
    });
}

// Limpia los datos de la película anterior al buscar o regresar a la cuadrícula.
function resetHeaderIndicators() {
    headerRecommendation.hidden = true;
    headerRecommendation.textContent = "";
    headerRecommendation.className = "header-recommendation";
    headerRecommendation.removeAttribute("title");
    headerRecommendation.removeAttribute("aria-label");

    headerCertification.hidden = true;
    headerCertification.textContent = "";
    headerCertification.className = "header-certification";
    headerCertification.removeAttribute("title");
    headerCertification.removeAttribute("aria-label");

    resetExternalMovieLinks();
}

// Restaura la misma vista limpia que encuentra una persona al abrir MaxiCheck.
function resetApplication() {
    catalogRequestVersion += 1;
    setActiveNavigation("nav-home");
    showThemeToggleOnHome(true);
    form.reset();
    form.classList.remove("form--detail");
    backButton.hidden = true;

    searchResults.innerHTML = "";
    searchResults.style.display = "grid";
    searchResults.onclick = null;
    result.innerHTML = "";

    resultToolbar.hidden = true;
    recommendationSummary.textContent = "";
    recommendationSummary.className = "";

    currentResultsCount = 0;
    openedFromSavedList = false;
    hideSearchResultsCount();
    resetHeaderIndicators();

    ratingGuide.open = false;
    try {
        sessionStorage.setItem("maxicheck-rating-guide", "closed");
    } catch (error) {
        // El reinicio visual no depende del almacenamiento del navegador.
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
    ageInput.focus({ preventScroll: true });
}

homeButton.addEventListener("click", resetApplication);
navHomeButton.addEventListener("click", resetApplication);

function prepareCatalogView() {
    showThemeToggleOnHome(false);
    openedFromSavedList = false;
    resultToolbar.hidden = true;
    backButton.hidden = true;
    form.classList.remove("form--detail");
    recommendationSummary.textContent = "";
    resetHeaderIndicators();
    result.innerHTML = "";
    searchResults.style.display = "grid";
}

// Dibuja Top MC, Populares o una búsqueda avanzada usando la misma paginación real.
async function showCatalog(configuration) {
    const requestVersion = ++catalogRequestVersion;
    prepareCatalogView();
    setActiveNavigation(configuration.navigationId);
    hideSearchResultsCount();
    searchResults.innerHTML = `<p class="catalog-loading">Cargando ${escapeHtml(configuration.title.toLowerCase())}…</p>`;

    const requestParameters = new URLSearchParams(configuration.parameters || {});
    requestParameters.set("mode", configuration.mode);
    requestParameters.set("page", "1");

    try {
        const firstResponse = await fetch(`${API_BASE_URL}/catalog?${requestParameters.toString()}`);
        const firstPage = await firstResponse.json();
        if (requestVersion !== catalogRequestVersion) return;
        if (!firstResponse.ok) throw new Error(firstPage.error || "No fue posible abrir el catálogo.");

        let movies = Array.isArray(firstPage.results) ? firstPage.results.map(normalizeContent) : [];
        const initialResultsLimit = 8;
        const totalResults = Number(firstPage.total_results) || movies.length;
        const totalPages = Number(firstPage.total_pages) || 1;
        let currentPage = Number(firstPage.page) || 1;
        let visibleResultsLimit = initialResultsLimit;
        let loadingNextPage = false;

        currentResultsCount = totalResults;
        showSearchResultsCount(totalResults);

        function renderCatalog() {
            const visibleMovies = movies.slice(0, visibleResultsLimit);
            searchResults.innerHTML = `
                <header class="catalog-heading">
                    <span>${escapeHtml(configuration.eyebrow)}</span>
                    <h2>${escapeHtml(configuration.title)}</h2>
                    <p>${escapeHtml(configuration.description)}</p>
                </header>
            `;

            if (visibleMovies.length === 0) {
                searchResults.innerHTML += `<p class="catalog-empty">No encontramos títulos con estos criterios.</p>`;
            }

            visibleMovies.forEach(function(movie) {
                const poster = movie.poster_path
                    ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
                    : "";
                const year = movie.release_date ? movie.release_date.substring(0, 4) : "Año desconocido";
                const score = movie.vote_average > 0 ? movie.vote_average.toFixed(1) : "—";

                searchResults.innerHTML += `
                    <button type="button" class="movie-option catalog-movie" data-catalog-movie-id="${movie.id}" data-media-type="${movie.media_type}">
                        ${poster
                            ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                            : `<div class="no-poster">Sin imagen</div>`
                        }
                        <div class="movie-option-info">
                            <span class="movie-option-type">${getContentTypeLabel(movie, true)}</span>
                            <span class="movie-option-title">${escapeHtml(movie.title)}</span>
                            <span class="movie-option-year">${escapeHtml(year)} · ⭐ ${score}</span>
                        </div>
                    </button>
                `;
            });

            const hasHiddenLoadedResults = visibleResultsLimit < movies.length;
            const canCollapse = visibleResultsLimit > initialResultsLimit;
            const hasMorePages = currentPage < totalPages;
            if (hasHiddenLoadedResults || canCollapse || hasMorePages) {
                searchResults.innerHTML += `
                    <div class="results-controls">
                        ${hasHiddenLoadedResults ? `<button type="button" class="toggle-results">Ver más (${movies.length - visibleResultsLimit})</button>` : ""}
                        ${canCollapse ? `<button type="button" class="collapse-results">Ver menos</button>` : ""}
                        ${hasMorePages && !hasHiddenLoadedResults ? `<button type="button" class="load-more-results">Cargar más títulos</button>` : ""}
                    </div>
                `;
            }
        }

        renderCatalog();

        searchResults.onclick = async function(event) {
            const movieButton = event.target.closest(".catalog-movie");
            const showMoreButton = event.target.closest(".toggle-results");
            const collapseButton = event.target.closest(".collapse-results");
            const loadMoreButton = event.target.closest(".load-more-results");

            if (showMoreButton) {
                visibleResultsLimit = movies.length;
                renderCatalog();
                return;
            }
            if (collapseButton) {
                visibleResultsLimit = initialResultsLimit;
                renderCatalog();
                searchResults.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
            }
            if (loadMoreButton && !loadingNextPage) {
                loadingNextPage = true;
                loadMoreButton.disabled = true;
                loadMoreButton.textContent = "Cargando…";
                try {
                    requestParameters.set("page", String(currentPage + 1));
                    const response = await fetch(`${API_BASE_URL}/catalog?${requestParameters.toString()}`);
                    const nextPage = await response.json();
                    if (requestVersion !== catalogRequestVersion) return;
                    if (!response.ok) throw new Error(nextPage.error || "No fue posible cargar más.");
                    const knownIds = new Set(movies.map(getContentKey));
                    movies = movies.concat((nextPage.results || []).map(normalizeContent).filter(function(movie) {
                        return !knownIds.has(getContentKey(movie));
                    }));
                    currentPage = nextPage.page;
                    visibleResultsLimit = movies.length;
                    renderCatalog();
                } catch (error) {
                    loadMoreButton.disabled = false;
                    loadMoreButton.textContent = "No se pudo cargar · Reintentar";
                } finally {
                    loadingNextPage = false;
                }
                return;
            }

            if (movieButton) {
                const age = Number(ageInput.value);
                if (!Number.isInteger(age) || age < 1 || age > 120) {
                    ageInput.setCustomValidity("Indica tu edad para abrir la ficha y recibir la recomendación.");
                    ageInput.reportValidity();
                    ageInput.focus();
                    ageInput.addEventListener("input", function() {
                        ageInput.setCustomValidity("");
                    }, { once: true });
                    return;
                }

                const selectedId = Number(movieButton.dataset.catalogMovieId);
                const selectedType = movieButton.dataset.mediaType || "movie";
                const selectedMovie = movies.find(function(movie) {
                    return movie.id === selectedId && movie.media_type === selectedType;
                });
                if (!selectedMovie) return;

                searchResults.style.display = "none";
                resultToolbar.hidden = false;
                backButton.hidden = false;
                form.classList.add("form--detail");
                hideSearchResultsCount();
                result.innerHTML = `<p class="loading-message">Cargando información del título…</p>`;
                try {
                    await showContentDetails(selectedMovie, age);
                } catch (error) {
                    result.innerHTML = `<p class="detail-error">No pudimos cargar este título.</p>`;
                }
            }
        };
    } catch (error) {
        currentResultsCount = 0;
        showSearchResultsCount(0);
        searchResults.innerHTML = `<p class="catalog-error">${escapeHtml(error.message)}</p>`;
    }
}

function openAdvancedSearch() {
    setActiveNavigation("nav-advanced", false);
    advancedSearchPanel.hidden = false;
    document.body.classList.add("advanced-search-open");
    advancedSearchClose.focus();
}

function closeAdvancedSearch(restoreNavigation = true) {
    advancedSearchPanel.hidden = true;
    document.body.classList.remove("advanced-search-open");
    if (restoreNavigation) setActiveNavigation(currentNavigationId, false);
    navAdvancedButton.focus();
}

navTopButton.addEventListener("click", function() {
    showCatalog({
        mode: "top", navigationId: "nav-top", eyebrow: "Selección MaxiCheck",
        title: "Top MC", description: "Las películas, series y documentales mejor valorados con un mínimo de 500 votos."
    });
});

navPopularButton.addEventListener("click", function() {
    showCatalog({
        mode: "popular", navigationId: "nav-popular", eyebrow: "Tendencias de TMDB",
        title: "Títulos populares", description: "Películas, series y documentales con mayor popularidad en este momento."
    });
});

navAdvancedButton.addEventListener("click", openAdvancedSearch);
advancedSearchClose.addEventListener("click", function() { closeAdvancedSearch(); });
advancedSearchPanel.addEventListener("click", function(event) {
    if (event.target === advancedSearchPanel) closeAdvancedSearch();
});

advancedSearchForm.addEventListener("submit", function(event) {
    event.preventDefault();
    const formData = new FormData(advancedSearchForm);
    const parameters = {};
    formData.forEach(function(value, key) {
        if (String(value).trim()) parameters[key] = String(value).trim();
    });

    if (parameters.yearFrom && parameters.yearTo && Number(parameters.yearFrom) > Number(parameters.yearTo)) {
        advancedSearchForm.elements.yearTo.setCustomValidity("El año final debe ser igual o posterior al inicial.");
        advancedSearchForm.elements.yearTo.reportValidity();
        return;
    }
    advancedSearchForm.elements.yearTo.setCustomValidity("");
    closeAdvancedSearch(false);
    showCatalog({
        mode: "advanced", navigationId: "nav-advanced", parameters,
        eyebrow: "Resultados filtrados", title: "Búsqueda avanzada",
        description: "Títulos que coinciden con los filtros seleccionados."
    });
});

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && !advancedSearchPanel.hidden) closeAdvancedSearch();
});

// Asigna un estado visual a cada clasificación sin depender del texto completo.
function getCertificationClass(certification) {
    const normalized = certification.toUpperCase();

    if (["G", "TV-Y", "TV-G"].includes(normalized)) return "header-certification--g";
    if (["PG", "TV-Y7", "TV-PG"].includes(normalized)) return "header-certification--pg";
    if (["PG-13", "TV-14"].includes(normalized)) return "header-certification--pg13";
    if (["R", "TV-MA"].includes(normalized)) return "header-certification--r";
    if (normalized === "NC-17") return "header-certification--nc17";

    return "header-certification--unknown";
}

// Presenta los minutos con un formato más natural para lectura rápida.
function formatRuntime(runtime) {
    if (!Number.isFinite(runtime) || runtime <= 0) return "No disponible";

    const hours = Math.floor(runtime / 60);
    const minutes = runtime % 60;

    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours} h`;

    return `${hours} h ${minutes} min`;
}

// Intl traduce códigos como "en" a "inglés" usando el propio navegador.
function getLanguageName(languageCode, fallbackName) {
    try {
        const displayNames = new Intl.DisplayNames(["es"], { type: "language" });
        return displayNames.of(languageCode) || fallbackName || languageCode;
    } catch (error) {
        return fallbackName || languageCode || "No disponible";
    }
}

function renderChips(items, emptyText) {
    return items.length > 0
        ? items.map(function(item) {
            return `<span class="info-chip">${item}</span>`;
        }).join("")
        : `<span class="context-value">${emptyText}</span>`;
}

// Agrupa plataformas por modalidad y evita repetir la misma en una categoría.
function renderProviderGroup(label, providers) {
    if (!Array.isArray(providers) || providers.length === 0) return "";

    const uniqueProviders = providers.filter(function(provider, index, list) {
        return list.findIndex(function(candidate) {
            return candidate.provider_id === provider.provider_id;
        }) === index;
    });

    return `
        <div class="provider-group">
            <h4>${label}</h4>
            <div class="provider-list">
                ${uniqueProviders.map(function(provider) {
                    const logoUrl = provider.logo_path
                        ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                        : "";

                    return `
                        <span class="provider-chip" title="${provider.provider_name}">
                            ${logoUrl
                                ? `<img src="${logoUrl}" alt="Logo de ${provider.provider_name}" loading="lazy">`
                                : ""
                            }
                            <span>${provider.provider_name}</span>
                        </span>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

// Protege el bloque técnico y los nuevos textos antes de insertarlos como HTML.
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getSafeExternalUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) {
        return "";
    }
}

function formatMoney(value) {
    if (!Number.isFinite(value) || value <= 0) return "No disponible";

    return new Intl.NumberFormat("es-DO", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(value);
}

const EXPLORER_PAGE_SIZE = 12;

function renderImageGallery(images) {
    if (!Array.isArray(images) || images.length === 0) {
        return `<p class="explorer-empty">No hay imágenes disponibles.</p>`;
    }

    return `
        <div class="explorer-gallery">
            ${images.map(function(image, index) {
                const previewUrl = `https://image.tmdb.org/t/p/w500${image.file_path}`;
                const originalUrl = `https://image.tmdb.org/t/p/original${image.file_path}`;
                const label = image.maxicheck_label;

                return `
                    <a href="${originalUrl}" target="_blank" rel="noopener noreferrer"
                       class="explorer-progressive-item"
                       data-explorer-group="images"
                       ${index >= EXPLORER_PAGE_SIZE ? "hidden" : ""}
                       aria-label="Abrir ${label.toLowerCase()} ${index + 1} en tamaño completo">
                        <img src="${previewUrl}" alt="${label} ${index + 1}" loading="lazy">
                        <span class="explorer-image-type">${label}</span>
                    </a>
                `;
            }).join("")}
        </div>
        ${images.length > EXPLORER_PAGE_SIZE
            ? `<button type="button" class="explorer-load-more" data-explorer-target="images" data-item-label="imágenes">
                   Cargar más imágenes (${images.length - EXPLORER_PAGE_SIZE})
               </button>`
            : ""
        }
    `;
}

// Revela el siguiente bloque de elementos ya descargados, sin repetir la consulta a TMDB.
function bindExplorerPagination(container) {
    container.addEventListener("click", function(event) {
        const loadMoreButton = event.target.closest(".explorer-load-more");
        if (!loadMoreButton) return;

        const groupName = loadMoreButton.dataset.explorerTarget;
        const hiddenItems = Array.from(
            container.querySelectorAll(`.explorer-progressive-item[data-explorer-group="${groupName}"][hidden]`)
        );

        hiddenItems.slice(0, EXPLORER_PAGE_SIZE).forEach(function(item) {
            item.hidden = false;
        });

        const remainingItems = hiddenItems.length - EXPLORER_PAGE_SIZE;
        if (remainingItems <= 0) {
            loadMoreButton.remove();
        } else {
            const itemLabel = loadMoreButton.dataset.itemLabel || "resultados";
            loadMoreButton.textContent = `Cargar más ${itemLabel} (${remainingItems})`;
        }
    });
}

// Presenta el resumen de temporadas incluido en la ficha general de una serie.
// Los episodios se solicitan después, únicamente cuando el usuario abre una temporada.
function renderSeriesSeasons(seasons) {
    if (!Array.isArray(seasons) || seasons.length === 0) {
        return `<p class="explorer-empty">No hay información de temporadas disponible.</p>`;
    }

    const orderedSeasons = [...seasons].sort(function(first, second) {
        return (first.season_number || 0) - (second.season_number || 0);
    });

    return `
        <div class="explorer-seasons">
            ${orderedSeasons.map(function(season) {
                const seasonNumber = Number(season.season_number) || 0;
                const posterUrl = season.poster_path
                    ? `https://image.tmdb.org/t/p/w300${season.poster_path}`
                    : "";
                const episodeCount = Number(season.episode_count) || 0;
                const seasonName = season.name || (seasonNumber === 0 ? "Especiales" : `Temporada ${seasonNumber}`);

                return `
                    <button type="button"
                            class="explorer-season-card"
                            data-season-number="${seasonNumber}"
                            aria-expanded="false"
                            aria-controls="explorer-season-detail">
                        ${posterUrl
                            ? `<img src="${posterUrl}" alt="Póster de ${escapeHtml(seasonName)}" loading="lazy">`
                            : `<span class="explorer-season-card__placeholder" aria-hidden="true">📺</span>`
                        }
                        <span class="explorer-season-card__content">
                            <strong>${escapeHtml(seasonName)}</strong>
                            <small>${escapeHtml(formatExplorerDate(season.air_date))}</small>
                            <span>${episodeCount} ${episodeCount === 1 ? "episodio" : "episodios"}</span>
                        </span>
                    </button>
                `;
            }).join("")}
        </div>
        <div id="explorer-season-detail"
             class="explorer-season-detail"
             role="region"
             aria-live="polite"
             hidden></div>
    `;
}

// Evita mostrar fechas inválidas y conserva un texto claro cuando TMDB no las ofrece.
function formatExplorerDate(value) {
    if (!value) return "Fecha no disponible";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? "Fecha no disponible"
        : date.toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
}

// Dibuja los datos de una temporada y limita inicialmente sus episodios a doce.
function renderSeasonEpisodes(season) {
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    const seasonNumber = Number(season.season_number) || 0;
    const groupName = `episodes-${seasonNumber}`;
    const seasonTitle = season.name || (seasonNumber === 0 ? "Especiales" : `Temporada ${seasonNumber}`);
    const overview = season.overview || "TMDB no ofrece una sinopsis para esta temporada.";

    const episodesMarkup = episodes.length > 0
        ? episodes.map(function(episode, index) {
            const stillUrl = episode.still_path
                ? `https://image.tmdb.org/t/p/w300${episode.still_path}`
                : "";
            const runtime = Number(episode.runtime) > 0 ? `${episode.runtime} min` : "Duración no disponible";
            const rating = Number(episode.vote_average) > 0
                ? `${Number(episode.vote_average).toFixed(1)}/10`
                : "Sin puntuación";

            return `
                <article class="explorer-episode explorer-progressive-item"
                         data-explorer-group="${groupName}"
                         ${index >= EXPLORER_PAGE_SIZE ? "hidden" : ""}>
                    ${stillUrl
                        ? `<img src="${stillUrl}" alt="Imagen del episodio ${episode.episode_number}" loading="lazy">`
                        : `<span class="explorer-episode__placeholder" aria-hidden="true">▶</span>`
                    }
                    <div class="explorer-episode__content">
                        <span class="explorer-episode__number">Episodio ${escapeHtml(episode.episode_number || index + 1)}</span>
                        <strong>${escapeHtml(episode.name || "Título no disponible")}</strong>
                        <small>${escapeHtml(formatExplorerDate(episode.air_date))} · ${escapeHtml(runtime)} · ${escapeHtml(rating)}</small>
                        <p>${escapeHtml(episode.overview || "Sinopsis no disponible.")}</p>
                    </div>
                </article>
            `;
        }).join("")
        : `<p class="explorer-empty">No hay episodios disponibles para esta temporada.</p>`;

    return `
        <header class="explorer-season-detail__header">
            <div>
                <span>Temporada seleccionada</span>
                <h3>${escapeHtml(seasonTitle)}</h3>
            </div>
            <strong>${episodes.length} ${episodes.length === 1 ? "episodio" : "episodios"}</strong>
        </header>
        <p class="explorer-season-overview">${escapeHtml(overview)}</p>
        <div class="explorer-episodes">${episodesMarkup}</div>
        ${episodes.length > EXPLORER_PAGE_SIZE
            ? `<button type="button"
                       class="explorer-load-more"
                       data-explorer-target="${groupName}"
                       data-item-label="episodios">
                   Cargar más episodios (${episodes.length - EXPLORER_PAGE_SIZE})
               </button>`
            : ""
        }
    `;
}

// Gestiona la carga bajo demanda y conserva en memoria las temporadas ya consultadas.
function bindSeriesSeasons(container, seriesId) {
    const seasonsSection = container.querySelector(".explorer-seasons-section");
    const seasonDetail = container.querySelector("#explorer-season-detail");
    if (!seasonsSection || !seasonDetail) return;

    const seasonCache = new Map();
    let selectedSeasonNumber = null;

    seasonsSection.addEventListener("click", async function(event) {
        const seasonButton = event.target.closest(".explorer-season-card");
        if (!seasonButton) return;

        const seasonNumber = Number(seasonButton.dataset.seasonNumber);
        if (!Number.isInteger(seasonNumber) || seasonNumber < 0) return;
        selectedSeasonNumber = seasonNumber;

        seasonsSection.querySelectorAll(".explorer-season-card").forEach(function(button) {
            button.classList.remove("explorer-season-card--active");
            button.setAttribute("aria-expanded", "false");
        });
        seasonButton.classList.add("explorer-season-card--active");
        seasonButton.setAttribute("aria-expanded", "true");

        seasonDetail.hidden = false;
        if (seasonCache.has(seasonNumber)) {
            seasonDetail.innerHTML = renderSeasonEpisodes(seasonCache.get(seasonNumber));
            seasonDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return;
        }

        seasonButton.disabled = true;
        seasonButton.classList.add("explorer-season-card--loading");
        seasonDetail.innerHTML = `<p class="explorer-season-loading">Cargando episodios de la temporada…</p>`;

        try {
            const response = await fetch(`${API_BASE_URL}/tv/${seriesId}/season/${seasonNumber}`);
            if (!response.ok) throw new Error("No fue posible cargar la temporada.");

            const season = await response.json();
            seasonCache.set(seasonNumber, season);
            // Si el usuario eligió otra temporada mientras esta cargaba, se conserva
            // la respuesta en caché sin reemplazar la temporada que está viendo.
            if (selectedSeasonNumber === seasonNumber) {
                seasonDetail.innerHTML = renderSeasonEpisodes(season);
                seasonDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        } catch (error) {
            if (selectedSeasonNumber === seasonNumber) {
                seasonDetail.innerHTML = `
                    <p class="explorer-season-error">
                        No pudimos cargar los episodios. Selecciona nuevamente la temporada para reintentar.
                    </p>
                `;
            }
        } finally {
            seasonButton.disabled = false;
            seasonButton.classList.remove("explorer-season-card--loading");
        }
    });
}

// Construye la vista extensa con cada conjunto de datos que MaxiCheck recibió de TMDB.
function renderExplorerMarkup(bundle) {
    const movie = bundle.movie;
    const mediaType = movie.media_type === "tv" ? "tv" : "movie";
    const contentLabel = getContentTypeLabel(movie);
    const credits = bundle.credits;
    const releaseDates = bundle.releaseDates;
    const translations = bundle.translations;
    const providers = bundle.providers;
    const images = movie.images || {};
    // La galería utiliza un único límite global de 12, no 12 por cada tipo de imagen.
    const galleryImages = [
        ...(Array.isArray(images.backdrops) ? images.backdrops.map(function(image) {
            return { ...image, maxicheck_label: "Fondo" };
        }) : []),
        ...(Array.isArray(images.posters) ? images.posters.map(function(image) {
            return { ...image, maxicheck_label: "Póster" };
        }) : []),
        ...(Array.isArray(images.logos) ? images.logos.map(function(image) {
            return { ...image, maxicheck_label: "Logo" };
        }) : [])
    ];
    const videos = Array.isArray(bundle.videos?.results)
        ? bundle.videos.results
        : Array.isArray(movie.videos?.results) ? movie.videos.results : [];
    const keywords = movie.keywords?.keywords || movie.keywords?.results || [];
    const backdropUrl = movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : "";

    const videosMarkup = videos.length > 0
        ? videos.map(function(video) {
            const isYouTube = video.site === "YouTube";
            const videoUrl = isYouTube
                ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`
                : "";
            const thumbnail = isYouTube
                ? `https://img.youtube.com/vi/${encodeURIComponent(video.key)}/mqdefault.jpg`
                : "";

            return `
                <article class="explorer-video explorer-progressive-item"
                         data-explorer-group="videos"
                         ${videos.indexOf(video) >= EXPLORER_PAGE_SIZE ? "hidden" : ""}>
                    ${thumbnail ? `<img src="${thumbnail}" alt="Miniatura de ${escapeHtml(video.name)}" loading="lazy">` : ""}
                    <div>
                        <strong>${escapeHtml(video.name)}</strong>
                        <span>${escapeHtml(video.type)} · ${escapeHtml(video.site)}</span>
                        ${videoUrl ? `<a href="${videoUrl}" target="_blank" rel="noopener noreferrer">Ver video</a>` : ""}
                    </div>
                </article>
            `;
        }).join("")
        : `<p class="explorer-empty">No hay videos disponibles.</p>`;

    const castMarkup = Array.isArray(credits.cast) && credits.cast.length > 0
        ? credits.cast.map(function(person) {
            const photo = person.profile_path
                ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
                : "";
            return `
                <article class="explorer-person">
                    ${photo ? `<img src="${photo}" alt="Foto de ${escapeHtml(person.name)}" loading="lazy">` : `<span class="explorer-person__placeholder">👤</span>`}
                    <strong>${escapeHtml(person.name)}</strong>
                    <small>${escapeHtml(person.character || "Personaje no disponible")}</small>
                </article>
            `;
        }).join("")
        : `<p class="explorer-empty">Reparto no disponible.</p>`;

    const crewMarkup = Array.isArray(credits.crew) && credits.crew.length > 0
        ? credits.crew.map(function(person) {
            return `<li><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.job || person.department)}</span></li>`;
        }).join("")
        : `<li>Equipo técnico no disponible.</li>`;

    const releasesMarkup = Array.isArray(releaseDates.results)
        ? releaseDates.results.map(function(country) {
            const entries = country.release_dates.map(function(release) {
                const date = release.release_date
                    ? new Date(release.release_date).toLocaleDateString("es-DO")
                    : "Sin fecha";
                return `<li>${date} · ${escapeHtml(release.certification || "Sin clasificación")} · tipo ${release.type}</li>`;
            }).join("");
            return `<details><summary>${escapeHtml(country.iso_3166_1)}</summary><ul>${entries}</ul></details>`;
        }).join("")
        : `<p class="explorer-empty">Información de estrenos no disponible.</p>`;

    const translationsMarkup = Array.isArray(translations.translations)
        ? translations.translations.map(function(item) {
            return `<li><strong>${escapeHtml(item.iso_639_1)}-${escapeHtml(item.iso_3166_1)}</strong><span>${escapeHtml(item.data?.title || "Sin título")}</span></li>`;
        }).join("")
        : `<li>Traducciones no disponibles.</li>`;

    const providerCountries = providers.results
        ? Object.entries(providers.results).map(function([countryCode, country]) {
            const names = ["flatrate", "free", "ads", "rent", "buy"]
                .flatMap(function(type) { return country[type] || []; })
                .filter(function(provider, index, list) {
                    return list.findIndex(function(item) { return item.provider_id === provider.provider_id; }) === index;
                })
                .map(function(provider) { return provider.provider_name; });
            return `<li><strong>${escapeHtml(countryCode)}</strong><span>${escapeHtml(names.join(" · ") || "Sin proveedores")}</span></li>`;
        }).join("")
        : `<li>Disponibilidad no encontrada.</li>`;

    const detailRows = [
        ["Tipo", contentLabel], ["Estado", movie.status], [mediaType === "tv" ? "Primera emisión" : "Fecha de estreno", movie.release_date],
        [mediaType === "tv" ? "Duración por episodio" : "Duración", formatRuntime(movie.runtime)],
        ["Temporadas", movie.maxicheck_number_of_seasons], ["Episodios", movie.maxicheck_number_of_episodes],
        ["Idioma original", getLanguageName(movie.original_language, movie.original_language)],
        ["Géneros", movie.genres?.map(function(item) { return item.name; }).join(" · ")],
        ["Países", movie.production_countries?.map(function(item) { return item.name; }).join(" · ")],
        ["Idiomas hablados", movie.spoken_languages?.map(function(item) { return item.name || item.english_name; }).join(" · ")],
        ["Saga", movie.belongs_to_collection?.name], ["Presupuesto", formatMoney(movie.budget)],
        ["Recaudación", formatMoney(movie.revenue)], ["Popularidad", movie.popularity],
        ["Puntuación", movie.vote_average ? `${movie.vote_average}/10` : "No disponible"],
        ["Votos", movie.vote_count], ["IMDb", movie.external_ids?.imdb_id || movie.imdb_id],
        ["Página oficial", movie.homepage]
    ].map(function([label, value]) {
        const shownValue = value || value === 0 ? value : "No disponible";
        return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(shownValue)}</dd></div>`;
    }).join("");

    const rawData = escapeHtml(JSON.stringify(bundle, null, 2));

    return `
        <section class="movie-explorer">
            <button type="button" class="explorer-back">← Volver a la ficha</button>
            <header class="explorer-hero" ${backdropUrl ? `style="background-image: linear-gradient(rgba(8,13,24,.35), rgba(8,13,24,.95)), url('${backdropUrl}')"` : ""}>
                <span>Explorar ${escapeHtml(contentLabel.toLowerCase())}</span>
                <h2>${escapeHtml(movie.title)}</h2>
                <p>${escapeHtml(movie.tagline || movie.overview || "Información completa de TMDB")}</p>
            </header>

            ${mediaType === "tv"
                ? `<details class="explorer-section explorer-seasons-section" open>
                       <summary>Temporadas y episodios (${movie.maxicheck_number_of_seasons || movie.seasons?.length || 0})</summary>
                       ${renderSeriesSeasons(movie.seasons)}
                   </details>`
                : ""
            }

            <details class="explorer-section" open><summary>Galería de imágenes</summary>
                ${renderImageGallery(galleryImages)}
            </details>

            <details class="explorer-section" open>
                <summary>Videos y tráileres</summary>
                <div class="explorer-videos">${videosMarkup}</div>
                ${videos.length > EXPLORER_PAGE_SIZE
                    ? `<button type="button" class="explorer-load-more" data-explorer-target="videos" data-item-label="videos">
                           Cargar más videos (${videos.length - EXPLORER_PAGE_SIZE})
                       </button>`
                    : ""
                }
            </details>
            <details class="explorer-section" open><summary>Ficha técnica completa</summary><dl class="explorer-details">${detailRows}</dl></details>
            <details class="explorer-section"><summary>Reparto completo (${credits.cast?.length || 0})</summary><div class="explorer-people">${castMarkup}</div></details>
            <details class="explorer-section"><summary>Equipo técnico completo (${credits.crew?.length || 0})</summary><ul class="explorer-data-list">${crewMarkup}</ul></details>
            <details class="explorer-section"><summary>${mediaType === "tv" ? "Clasificaciones televisivas por país" : "Estrenos y clasificaciones por país"}</summary><div class="explorer-releases">${releasesMarkup}</div></details>
            <details class="explorer-section"><summary>Títulos y traducciones</summary><ul class="explorer-data-list">${translationsMarkup}</ul></details>
            <details class="explorer-section"><summary>Disponibilidad internacional</summary><ul class="explorer-data-list">${providerCountries}</ul></details>
            <details class="explorer-section"><summary>Palabras clave</summary><div class="info-chip-list">${renderChips(keywords.map(function(item) { return escapeHtml(item.name); }), "No disponibles")}</div></details>
            <details class="explorer-section explorer-raw"><summary>Datos originales recibidos de TMDB</summary><p>Incluye todos los campos recibidos por MaxiCheck, sin exponer la API key.</p><pre>${rawData}</pre></details>
        </section>
    `;
}

function renderPersonFilmography(person, movies) {
    const profileUrl = person.profilePath
        ? `https://image.tmdb.org/t/p/w185${person.profilePath}`
        : "";
    const roleLabel = person.role === "actor" ? "Actuación" : person.role === "creator" ? "Creación" : "Dirección";
    const emptyMessage = person.role === "actor"
        ? "No encontramos películas o series en las que participe esta persona."
        : "No encontramos películas o series creadas o dirigidas por esta persona.";

    const movieCards = movies.length > 0
        ? movies.map(function(movie, index) {
            const posterUrl = movie.poster_path
                ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
                : "";
            const year = movie.release_date
                ? movie.release_date.substring(0, 4)
                : "Año desconocido";
            const participation = person.role === "actor"
                ? movie.character || "Reparto"
                : person.role === "creator" ? "Creación" : "Dirección";

            return `
                <button type="button"
                        class="filmography-movie explorer-progressive-item"
                        data-explorer-group="filmography"
                        data-filmography-movie-id="${movie.id}"
                        data-media-type="${movie.media_type}"
                        ${index >= EXPLORER_PAGE_SIZE ? "hidden" : ""}>
                    ${posterUrl
                        ? `<img src="${posterUrl}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                        : `<span class="filmography-movie__placeholder">🎞️</span>`
                    }
                    <span class="filmography-movie__info">
                        <strong>${escapeHtml(movie.title)}</strong>
                        <small>${getContentTypeLabel(movie)} · ${escapeHtml(year)} · ${escapeHtml(participation)}</small>
                    </span>
                </button>
            `;
        }).join("")
        : `<p class="explorer-empty">${emptyMessage}</p>`;

    return `
        <section class="person-filmography">
            <button type="button" class="filmography-back">← Volver a la ficha</button>
            <header class="person-filmography__header">
                ${profileUrl
                    ? `<img src="${profileUrl}" alt="Foto de ${escapeHtml(person.name)}">`
                    : `<span class="person-filmography__placeholder" aria-hidden="true">👤</span>`
                }
                <div>
                    <span>${roleLabel}</span>
                    <h2>${escapeHtml(person.name)}</h2>
                    <p>${movies.length} ${movies.length === 1 ? "título encontrado" : "títulos encontrados"}</p>
                </div>
            </header>
            <div class="filmography-grid">${movieCards}</div>
            ${movies.length > EXPLORER_PAGE_SIZE
                ? `<button type="button" class="explorer-load-more" data-explorer-target="filmography" data-item-label="títulos">
                       Cargar más títulos (${movies.length - EXPLORER_PAGE_SIZE})
                   </button>`
                : ""
            }
        </section>
    `;
}

// Convierte las clasificaciones estadounidenses de TMDB en una edad orientativa.
// `null` distingue una clasificación desconocida de una apta para todo público.
function getMinimumAge(certification) {

    certification = String(certification || "").trim().toUpperCase();

    if (certification === "G") {
        return 0;
    }

    if (certification === "PG") {
        return 8;
    }

    if (certification === "PG-13") {
        return 13;
    }

    if (certification === "R") {
        return 17;
    }

    if (certification === "NC-17") {
        return 18;
    }

    if (certification === "TV-Y" || certification === "TV-G") {
        return 0;
    }

    if (certification === "TV-Y7") {
        return 7;
    }

    if (certification === "TV-PG") {
        return 8;
    }

    if (certification === "TV-14") {
        return 14;
    }

    if (certification === "TV-MA") {
        return 17;
    }

    return null;
}

// Consulta las rutas correspondientes y dibuja una ficha común para películas y series.
async function showContentDetails(selectedMovie, age) {

    showThemeToggleOnHome(false);

    selectedMovie = normalizeContent(selectedMovie);

    const movieId = selectedMovie.id;
    const mediaType = selectedMovie.media_type;
    const contentLabel = getContentTypeLabel(selectedMovie);
    const contentPath = `${API_BASE_URL}/${mediaType}/${movieId}`;

    const title = selectedMovie.title;
    const releaseDate = selectedMovie.release_date;
    let overview = selectedMovie.overview;
    const posterPath = selectedMovie.poster_path;
    const voteAverage = selectedMovie.vote_average;


    const year = releaseDate
        ? releaseDate.substring(0, 4)
        : "Año desconocido";


    const posterUrl = posterPath
        ? `https://image.tmdb.org/t/p/w500${posterPath}`
        : "";

    // TMDB entrega la puntuación sobre diez; se traduce a un porcentaje para el aro del póster.
    const numericTmdbRating = Number(voteAverage) || 0;
    const ratingProgress = Math.max(0, Math.min(100, Math.round(numericTmdbRating * 10)));
    const ratingState = numericTmdbRating <= 0
        ? "unavailable"
        : numericTmdbRating >= 7
            ? "good"
            : numericTmdbRating >= 5 ? "average" : "bad";
    const ratingColor = ratingState === "good"
        ? "#22c55e"
        : ratingState === "average"
            ? "#f59e0b"
            : ratingState === "bad" ? "#ef4444" : "#64748b";
    const ratingDisplay = numericTmdbRating > 0 ? numericTmdbRating.toFixed(1) : "—";


    const certificationUrl = `${contentPath}/release-dates`;
    const creditsUrl = `${contentPath}/credits`;
    const detailsUrl = `${contentPath}/details`;
    const translationsUrl = `${contentPath}/translations`;
    const watchProvidersUrl = `${contentPath}/watch-providers`;
    const recommendationsUrl = `${contentPath}/recommendations`;
    const similarUrl = `${contentPath}/similar`;
    const videosUrl = `${contentPath}/videos`;

    // Las consultas son independientes, por eso se ejecutan en paralelo.
    const responses = await Promise.all([
        fetch(certificationUrl),
        fetch(creditsUrl),
        fetch(detailsUrl),
        fetch(translationsUrl),
        fetch(watchProvidersUrl),
        fetch(recommendationsUrl),
        fetch(similarUrl),
        fetch(videosUrl)
    ]);

    if (responses.some(function(response) { return !response.ok; })) {
        throw new Error("No fue posible cargar toda la información del título.");
    }

    const [certificationData, creditsData, detailsData, translationsData, providersData,
        recommendationsData, similarData, summaryVideosData] =
        await Promise.all(responses.map(function(response) { return response.json(); }));
    overview = detailsData.overview || overview;

    // Las películas de una colección tienen prioridad sobre las demás sugerencias.
    let collectionData = null;
    if (mediaType === "movie" && detailsData.belongs_to_collection?.id) {
        const collectionResponse = await fetch(
            `${API_BASE_URL}/collection/${detailsData.belongs_to_collection.id}`
        );
        if (collectionResponse.ok) collectionData = await collectionResponse.json();
    }


    // El Worker presenta clasificaciones de cine y TV con la misma estructura por país.
    const usRelease = certificationData.results.find(function(country) {

        return country.iso_3166_1 === "US";

    });


    let certification = "No disponible";


    if (usRelease) {
        const recognizedCertifications = usRelease.release_dates
            .map(function(release) {
                return String(release.certification || "").trim().toUpperCase();
            })
            .filter(function(value) {
                return getMinimumAge(value) !== null;
            });

        // Ante clasificaciones distintas entre estrenos, usa la más restrictiva.
        if (recognizedCertifications.length > 0) {
            certification = recognizedCertifications.reduce(function(current, next) {
                return getMinimumAge(next) > getMinimumAge(current) ? next : current;
            });
        }
    }

    // Se muestran los primeros seis intérpretes según el orden enviado por TMDB.
    const cast = Array.isArray(creditsData.cast)
        ? creditsData.cast.slice(0, 6)
        : [];

    const castMarkup = cast.length > 0
        ? cast.map(function(actor) {
            const profileUrl = actor.profile_path
                ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
                : "";

            return `
                <button type="button" class="cast-member person-filmography-trigger"
                        data-person-id="${actor.id}"
                        data-person-name="${escapeHtml(actor.name)}"
                        data-person-role="actor"
                        data-person-profile="${escapeHtml(actor.profile_path || "")}">
                    ${profileUrl
                        ? `<img src="${profileUrl}" alt="Foto de ${escapeHtml(actor.name)}" loading="lazy">`
                        : `<div class="cast-member__placeholder" aria-hidden="true">👤</div>`
                    }
                    <div class="cast-member__info">
                        <strong>${escapeHtml(actor.name)}</strong>
                        <span>${escapeHtml(actor.character || "Personaje no disponible")}</span>
                    </div>
                    <span class="person-filmography-hint">Ver filmografía →</span>
                </button>
            `;
        }).join("")
        : `<p class="cast-empty">Reparto no disponible.</p>`;

    // En series se muestran sus creadores; en películas, la dirección acreditada.
    const directors = mediaType === "tv" && Array.isArray(detailsData.created_by)
        ? detailsData.created_by.slice(0, 2).map(function(creator) {
            return { ...creator, job: "Creador" };
        })
        : Array.isArray(creditsData.crew)
            ? creditsData.crew.filter(function(member) { return member.job === "Director"; }).slice(0, 2)
            : [];
    const directorsMarkup = directors.length > 0
        ? directors.map(function(director) {
            const directorPhotoUrl = director.profile_path
                ? `https://image.tmdb.org/t/p/w185${director.profile_path}`
                : "";

            return `
                <button type="button" class="director-profile person-filmography-trigger"
                        data-person-id="${director.id}"
                        data-person-name="${escapeHtml(director.name)}"
                        data-person-role="${mediaType === "tv" ? "creator" : "director"}"
                        data-person-profile="${escapeHtml(director.profile_path || "")}">
                    ${directorPhotoUrl
                        ? `<img class="director-profile__photo" src="${directorPhotoUrl}" alt="Foto de ${escapeHtml(director.name)}" loading="lazy">`
                        : `<div class="director-profile__placeholder" aria-hidden="true">🎬</div>`
                    }
                    <div class="director-profile__info">
                        <strong>${escapeHtml(director.name)}</strong>
                        <span>${mediaType === "tv" ? "Creador" : "Director"}</span>
                    </div>
                    <span class="person-filmography-hint">Ver títulos →</span>
                </button>
            `;
        }).join("")
        : `<p class="context-value">${mediaType === "tv" ? "Creación no disponible." : "Dirección no disponible."}</p>`;

    const countries = Array.isArray(detailsData.production_countries)
        ? detailsData.production_countries.slice(0, 3)
        : [];
    const countriesMarkup = countries.length > 0
        ? countries.map(function(country) {
            const countryCode = country.iso_3166_1.toLowerCase();

            return `
                <button type="button"
                        class="country-chip country-search-trigger"
                        data-country-code="${escapeHtml(country.iso_3166_1)}"
                        data-country-name="${escapeHtml(country.name)}"
                        aria-label="Buscar películas y series de ${escapeHtml(country.name)}"
                        title="Ver títulos de ${escapeHtml(country.name)}">
                    <img
                        class="country-chip__flag"
                        src="https://flagcdn.com/w40/${countryCode}.png"
                        srcset="https://flagcdn.com/w80/${countryCode}.png 2x"
                        alt="Bandera de ${escapeHtml(country.name)}"
                        loading="lazy"
                    >
                    <span>${escapeHtml(country.name)}</span>
                    <span class="country-chip__action" aria-hidden="true">⌕</span>
                </button>
            `;
        }).join("")
        : `<span class="context-value">No disponible</span>`;

    const runtime = formatRuntime(detailsData.runtime);
    const genres = Array.isArray(detailsData.genres)
        ? detailsData.genres.map(function(genre) { return genre.name; })
        : [];
    const genresMarkup = renderChips(genres, "No disponibles");

    const originalLanguage = getLanguageName(
        detailsData.original_language,
        detailsData.original_language
    );
    const spokenLanguages = Array.isArray(detailsData.spoken_languages)
        ? detailsData.spoken_languages.map(function(language) {
            return getLanguageName(language.iso_639_1, language.name || language.english_name);
        })
        : [];
    const languagesMarkup = renderChips(spokenLanguages, "No disponibles");
    const collectionName = mediaType === "tv"
        ? `${detailsData.maxicheck_number_of_seasons || "—"} temporadas · ${detailsData.maxicheck_number_of_episodes || "—"} episodios`
        : detailsData.belongs_to_collection?.name || "No pertenece a una saga";
    const collectionTitle = mediaType === "tv" ? "Temporadas y episodios" : "Saga o colección";

    const translations = Array.isArray(translationsData.translations)
        ? translationsData.translations
        : [];
    const englishTranslation = translations.find(function(translation) {
        return translation.iso_639_1 === "en" && translation.iso_3166_1 === "US";
    }) || translations.find(function(translation) {
        return translation.iso_639_1 === "en";
    });
    const spainTranslation = translations.find(function(translation) {
        return translation.iso_639_1 === "es" && translation.iso_3166_1 === "ES";
    });
    const englishTitle = englishTranslation?.data?.title || "No disponible";
    const spainTitle = spainTranslation?.data?.title || "No disponible";

    const dominicanProviders = providersData.results?.DO;
    const providerTerritory = dominicanProviders ? "República Dominicana" : "Estados Unidos";
    const selectedProviders = dominicanProviders || providersData.results?.US;
    const providersMarkup = selectedProviders
        ? [
            renderProviderGroup("Suscripción", selectedProviders.flatrate),
            renderProviderGroup("Gratis", selectedProviders.free),
            renderProviderGroup("Con anuncios", selectedProviders.ads),
            renderProviderGroup("Alquiler", selectedProviders.rent),
            renderProviderGroup("Compra", selectedProviders.buy)
        ].join("")
        : "";

    const relatedMovieMap = new Map();
    function addRelatedMovies(items, reason) {
        if (!Array.isArray(items)) return;

        items.forEach(function(item) {
            const normalizedItem = normalizeContent(item, mediaType);
            const itemKey = getContentKey(normalizedItem);
            if (isSameContent(normalizedItem, selectedMovie) || relatedMovieMap.has(itemKey) || !normalizedItem.title) return;
            relatedMovieMap.set(itemKey, { ...normalizedItem, recommendationReason: reason });
        });
    }

    addRelatedMovies(collectionData?.parts, "Misma saga");
    addRelatedMovies(recommendationsData.results, "Recomendada por TMDB");
    addRelatedMovies(similarData.results, "Géneros similares");

    const relatedMovies = Array.from(relatedMovieMap.values()).slice(0, 6);
    const relatedMoviesMarkup = relatedMovies.length > 0
        ? relatedMovies.map(function(relatedMovie) {
            const relatedPoster = relatedMovie.poster_path
                ? `https://image.tmdb.org/t/p/w300${relatedMovie.poster_path}`
                : "";
            const relatedYear = relatedMovie.release_date
                ? relatedMovie.release_date.substring(0, 4)
                : "Año desconocido";
            const relatedScore = relatedMovie.vote_average > 0
                ? `${relatedMovie.vote_average.toFixed(1)}/10`
                : "Sin puntuación";

            return `
                <button type="button" class="related-movie" data-related-id="${relatedMovie.id}" data-media-type="${relatedMovie.media_type}">
                    ${relatedPoster
                        ? `<img src="${relatedPoster}" alt="Póster de ${escapeHtml(relatedMovie.title)}" loading="lazy">`
                        : `<span class="related-movie__placeholder">Sin imagen</span>`
                    }
                    <span class="related-movie__content">
                        <span class="related-movie__reason">${escapeHtml(relatedMovie.recommendationReason)}</span>
                        <strong>${escapeHtml(relatedMovie.title)}</strong>
                        <small>${getContentTypeLabel(relatedMovie)} · ${relatedYear} · ⭐ ${relatedScore}</small>
                    </span>
                </button>
            `;
        }).join("")
        : `<p class="related-empty">Todavía no encontramos recomendaciones para este título.</p>`;
    const initiallySaved = movieIsSaved(movieId, mediaType);
    const tmdbMovieUrl = `https://www.themoviedb.org/${mediaType}/${movieId}?language=es-ES`;
    const imdbMovieUrl = detailsData.imdb_id
        ? `https://www.imdb.com/title/${encodeURIComponent(detailsData.imdb_id)}/`
        : "";
    const officialMovieUrl = getSafeExternalUrl(detailsData.homepage);
    const filmAffinityQuery = [
        detailsData.original_title || title,
        detailsData.release_date?.substring(0, 4)
    ].filter(Boolean).join(" ");
    const filmAffinityUrl =
        `https://www.filmaffinity.com/es/search.php?stext=${encodeURIComponent(filmAffinityQuery)}&stype=title`;
    const externalSearchQuery = [title, year === "Año desconocido" ? "" : year]
        .filter(Boolean)
        .join(" ");
    const imdbSearchUrl =
        `https://www.imdb.com/find/?q=${encodeURIComponent(externalSearchQuery)}&s=tt`;
    const rottenTomatoesUrl =
        `https://www.rottentomatoes.com/search?search=${encodeURIComponent(externalSearchQuery)}`;
    const metacriticUrl =
        `https://www.metacritic.com/search/${encodeURIComponent(externalSearchQuery)}/`;
    const availableVideos = Array.isArray(summaryVideosData.results)
        ? summaryVideosData.results.filter(function(video) { return video.site === "YouTube"; })
        : [];
    const trailer = availableVideos.find(function(video) {
        return video.type === "Trailer" && video.official;
    }) || availableVideos.find(function(video) {
        return video.type === "Trailer";
    }) || availableVideos.find(function(video) {
        return video.type === "Teaser";
    }) || availableVideos[0];
    const trailerUrl = trailer
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`
        : "";


    const minimumAge = getMinimumAge(certification);
    const ageGuidance = minimumAge === null
        ? "No hay una edad orientativa disponible para este título."
        : minimumAge === 0
            ? "Referencia de MaxiCheck: apta para todas las edades."
            : `Referencia de MaxiCheck: recomendada desde los ${minimumAge} años.`;

    let recommendation = "";
    let recommendationClass = "";
    let recommendationState = "unknown";
    let recommendationBadgeText = "Información insuficiente";


    // La recomendación se calcula localmente comparando la edad con el mínimo.
    if (minimumAge === null) {

        recommendation =
            "ℹ️ No tenemos suficiente información para determinar si es apropiada.";
        recommendationClass = "recommendation-summary--unknown";

    } else if (age >= minimumAge) {

        recommendation =
            "✅ Apta según nuestra recomendación de edad.";
        recommendationClass = "recommendation-summary--approved";
        recommendationState = "approved";
        recommendationBadgeText = "Apta";

    } else {

        recommendation =
            "⛔ No recomendada para tu edad.";
        recommendationClass = "recommendation-summary--denied";
        recommendationState = "denied";
        recommendationBadgeText = "No recomendada";

    }


    // Actualiza la barra superior antes de dibujar el resto de la ficha.
    recommendationSummary.innerHTML = `
        <span class="recommendation-summary__main">${recommendation}</span>
        <span class="recommendation-summary__age">
            <span>Edad consultada: <strong>${age} años</strong></span>
            <span class="recommendation-summary__separator" aria-hidden="true">•</span>
            <span>${ageGuidance}</span>
        </span>
    `;
    recommendationSummary.className =
        `recommendation-summary ${recommendationClass}`;

    // En el banner solo se muestran señales compactas; el texto permanece en la ficha.
    headerRecommendation.textContent = recommendationBadgeText;
    headerRecommendation.className =
        `header-recommendation header-recommendation--${recommendationState}`;
    headerRecommendation.hidden = false;
    headerRecommendation.title = recommendation;
    headerRecommendation.setAttribute("aria-label", recommendation);

    headerCertification.innerHTML = `
        <span class="header-certification__label">Clasificación</span>
        <strong>${escapeHtml(certification)}</strong>
    `;
    headerCertification.className =
        `header-certification ${getCertificationClass(certification)}`;
    headerCertification.hidden = false;
    headerCertification.title = `Clasificación ${certification}`;
    headerCertification.setAttribute("aria-label", `Clasificación ${certification}`);

    // El menú superior abre la ficha exacta cuando existe o una búsqueda por título y año.
    filmAffinityNavLink.href = filmAffinityUrl;
    filmAffinityNavLink.title = `Buscar ${title} en FilmAffinity`;
    filmAffinityNavLink.setAttribute("aria-label", `Buscar ${title} en FilmAffinity`);
    imdbNavLink.href = imdbMovieUrl || imdbSearchUrl;
    imdbNavLink.title = `Consultar ${title} en IMDb`;
    imdbNavLink.setAttribute("aria-label", `Consultar ${title} en IMDb`);
    rottenTomatoesNavLink.href = rottenTomatoesUrl;
    rottenTomatoesNavLink.title = `Buscar ${title} en Rotten Tomatoes`;
    rottenTomatoesNavLink.setAttribute("aria-label", `Buscar ${title} en Rotten Tomatoes`);
    metacriticNavLink.href = metacriticUrl;
    metacriticNavLink.title = `Buscar ${title} en Metacritic`;
    metacriticNavLink.setAttribute("aria-label", `Buscar ${title} en Metacritic`);

    // El acceso a la exploración se ubica bajo el póster y se carga solo al solicitarlo.
    result.innerHTML = `
        <div class="movie-title-row">
            <span class="selected-content-type">${getContentTypeLabel(detailsData, true)}</span>
            <h2 class="movie-title">${escapeHtml(title)}</h2>
            <button type="button" class="copy-movie-title" aria-label="Copiar el título ${escapeHtml(title)}">
                <span aria-hidden="true">⧉</span>
            </button>
        </div>

        <div class="movie-poster-zone">
            <div class="movie-poster-frame">
                ${posterUrl
                    ? `<img class="movie-poster" src="${posterUrl}" alt="Póster de ${escapeHtml(title)}" width="250">`
                    : `<div class="movie-poster-placeholder">Póster no disponible</div>`
                }
                <div class="poster-rating poster-rating--${ratingState}"
                     style="--rating-progress: ${ratingProgress}%; --rating-color: ${ratingColor};"
                     role="img"
                     aria-label="Puntuación de TMDB: ${ratingDisplay} de 10">
                    <strong>${ratingDisplay}</strong>
                    <small>TMDB</small>
                </div>
            </div>
            <button type="button" class="explore-movie-button">
                <span class="explore-movie-button__icon" aria-hidden="true">▦</span>
                <span><strong>Explorar ${mediaType === "tv" ? "serie" : "película"}</strong><small>Galería, tráileres y ficha completa</small></span>
            </button>
            ${trailerUrl
                ? `<a class="poster-trailer-button" href="${trailerUrl}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span><span>Ver tráiler</span></a>`
                : ""
            }
            <button type="button" class="poster-save-button movie-action--save" aria-pressed="${initiallySaved}">
                <span aria-hidden="true">${initiallySaved ? "♥" : "♡"}</span>
                <span>${initiallySaved ? "Guardada en Mi lista" : "Guardar en Mi lista"}</span>
            </button>
            <p class="poster-actions-status" role="status" aria-live="polite"></p>
        </div>

        <div class="movie-context">
            <section class="context-card" aria-labelledby="director-title">
                <h3 id="director-title">${mediaType === "tv" ? "Creación" : "Dirección"}</h3>
                <div class="director-list">${directorsMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="countries-title">
                <h3 id="countries-title">País de producción</h3>
                <div class="country-list">${countriesMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="runtime-title">
                <h3 id="runtime-title">Duración y año</h3>
                <div class="runtime-year">
                    <span><small>${mediaType === "tv" ? "Por episodio" : "Duración"}</small><strong>⏱ ${runtime}</strong></span>
                    <span><small>Año</small><strong>📅 ${year}</strong></span>
                </div>
            </section>
            <section class="context-card" aria-labelledby="genres-title">
                <h3 id="genres-title">Géneros</h3>
                <div class="info-chip-list">${genresMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="original-language-title">
                <h3 id="original-language-title">Idioma original</h3>
                <p class="context-value">${originalLanguage}</p>
            </section>
            <section class="context-card" aria-labelledby="spoken-languages-title">
                <h3 id="spoken-languages-title">Idiomas hablados</h3>
                <div class="info-chip-list">${languagesMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="collection-title">
                <h3 id="collection-title">${collectionTitle}</h3>
                <p class="context-value">${collectionName}</p>
            </section>
            <section class="context-card context-card--titles" aria-labelledby="titles-title">
                <h3 id="titles-title">Otros títulos</h3>
                <dl class="alternate-titles">
                    <div><dt>Original</dt><dd>${escapeHtml(detailsData.original_title || "No disponible")}</dd></div>
                    <div><dt>Inglés</dt><dd>${englishTitle}</dd></div>
                    <div><dt>España</dt><dd>${spainTitle}</dd></div>
                </dl>
            </section>
        </div>

        <section class="watch-providers" aria-labelledby="providers-title">
            <div class="watch-providers__heading">
                <div>
                    <h3 id="providers-title">Dónde verla</h3>
                    <p>Disponibilidad para ${providerTerritory}${dominicanProviders ? "" : " (referencia alternativa)"}.</p>
                </div>
                ${selectedProviders?.link
                    ? `<a href="${selectedProviders.link}" target="_blank" rel="noopener noreferrer">Ver disponibilidad</a>`
                    : ""
                }
            </div>
            ${providersMarkup
                ? `<div class="provider-groups">${providersMarkup}</div>`
                : `<p class="providers-empty">No encontramos plataformas disponibles para este título.</p>`
            }
            <p class="provider-attribution">Información de disponibilidad proporcionada por JustWatch mediante TMDB.</p>
        </section>

        <section class="movie-cast" aria-labelledby="cast-title">
            <h3 id="cast-title">Reparto principal</h3>
            <div class="cast-grid">
                ${castMarkup}
            </div>
        </section>

        <div class="movie-description">
            <h3>Sinopsis</h3>
            <p>${overview || "Sinopsis no disponible."}</p>
        </div>

        <section class="movie-recommendations" aria-labelledby="recommendations-title">
            <div class="movie-recommendations__heading">
                <h3 id="recommendations-title">También podría gustarte</h3>
                <p>Basadas en ${mediaType === "tv" ? "afinidad de TMDB y géneros similares" : "la saga, afinidad de TMDB y géneros similares"}.</p>
            </div>
            <div class="related-movies-grid">${relatedMoviesMarkup}</div>
        </section>

        <section class="movie-actions" aria-labelledby="movie-actions-title">
            <div>
                <h3 id="movie-actions-title">Compartir y enlaces oficiales</h3>
                <p>Comparte este título o consulta su información oficial.</p>
            </div>
            <div class="movie-actions__buttons">
                <button type="button" class="movie-action movie-action--share">
                    <span aria-hidden="true">↗</span><span>Compartir</span>
                </button>
                <a class="movie-action" href="${tmdbMovieUrl}" target="_blank" rel="noopener noreferrer">TMDB</a>
                ${officialMovieUrl ? `<a class="movie-action" href="${escapeHtml(officialMovieUrl)}" target="_blank" rel="noopener noreferrer">Sitio oficial</a>` : ""}
            </div>
            <p class="movie-actions__status" role="status" aria-live="polite"></p>
        </section>
    `;

    let summaryMarkup = result.innerHTML;
    let explorerCache = null;

    function bindPersonCards() {
        const personCards = result.querySelectorAll(".person-filmography-trigger");

        personCards.forEach(function(personCard) {
            personCard.addEventListener("click", async function() {
                const person = {
                    id: Number(personCard.dataset.personId),
                    name: personCard.dataset.personName,
                    role: personCard.dataset.personRole,
                    profilePath: personCard.dataset.personProfile
                };
                const hint = personCard.querySelector(".person-filmography-hint");
                personCard.disabled = true;
                if (hint) hint.textContent = "Cargando…";

                try {
                    const creditsResponse = await fetch(
                        `${API_BASE_URL}/person/${person.id}/combined-credits`
                    );
                    if (!creditsResponse.ok) throw new Error("No fue posible cargar la filmografía.");

                    const personCredits = await creditsResponse.json();
                    const sourceMovies = person.role === "director"
                        ? (personCredits.crew || []).filter(function(movie) {
                            return movie.job === "Director";
                        })
                        : person.role === "creator"
                            ? (personCredits.crew || []).filter(function(content) {
                                return ["Creator", "Executive Producer", "Writer"].includes(content.job);
                            })
                        : personCredits.cast || [];
                    const uniqueMovies = Array.from(new Map(sourceMovies
                        .filter(function(movie) {
                            return movie.id && movie.title;
                        })
                        .map(function(movie) {
                            const normalized = normalizeContent(movie);
                            return [getContentKey(normalized), normalized];
                        })).values())
                        .sort(function(first, second) {
                            return String(second.release_date || "").localeCompare(
                                String(first.release_date || "")
                            );
                        });

                    if (!result.contains(personCard)) return;

                    result.innerHTML = renderPersonFilmography(person, uniqueMovies);
                    const filmographyView = result.querySelector(".person-filmography");
                    bindExplorerPagination(filmographyView);

                    filmographyView.querySelector(".filmography-back").addEventListener("click", function() {
                        result.innerHTML = summaryMarkup;
                        bindExploreButton();
                        bindPersonCards();
                        bindCountrySearch();
                        bindRelatedMovies();
                        bindMovieActions();
                        result.scrollIntoView({ behavior: "smooth", block: "start" });
                    });

                    filmographyView.addEventListener("click", async function(event) {
                        const movieButton = event.target.closest(".filmography-movie");
                        if (!movieButton) return;

                        const selectedId = Number(movieButton.dataset.filmographyMovieId);
                        const selectedType = movieButton.dataset.mediaType || "movie";
                        const selectedFilm = uniqueMovies.find(function(movie) {
                            return movie.id === selectedId && movie.media_type === selectedType;
                        });
                        if (!selectedFilm) return;

                        result.innerHTML = `<p class="loading-message">Cargando título…</p>`;
                        try {
                            await showContentDetails(selectedFilm, age);
                        } catch (error) {
                            result.innerHTML = `<p class="detail-error">No pudimos cargar este título.</p>`;
                        }
                    });

                    result.scrollIntoView({ behavior: "smooth", block: "start" });
                } catch (error) {
                    personCard.disabled = false;
                    if (hint) hint.textContent = "No se pudo cargar · Reintentar";
                }
            });
        });
    }

    // Convierte cada país de producción en una búsqueda paginada de películas y series.
    function bindCountrySearch() {
        result.querySelectorAll(".country-search-trigger").forEach(function(countryButton) {
            countryButton.addEventListener("click", function() {
                const countryCode = String(countryButton.dataset.countryCode || "").toUpperCase();
                const countryName = countryButton.dataset.countryName || countryCode;
                if (!/^[A-Z]{2}$/.test(countryCode)) return;

                showCatalog({
                    mode: "advanced",
                    navigationId: "nav-advanced",
                    parameters: { country: countryCode },
                    eyebrow: "Catálogo por país",
                    title: `Títulos de ${countryName}`,
                    description: `Películas, series y documentales asociados con ${countryName}, ordenados por popularidad.`
                });
            });
        });
    }

    function bindExploreButton() {
        const exploreButton = result.querySelector(".explore-movie-button");

        if (!exploreButton) return;

        exploreButton.addEventListener("click", async function() {
            exploreButton.disabled = true;
            exploreButton.querySelector("strong").textContent = "Cargando…";

            try {
                if (!explorerCache) {
                    const explorerResponse = await fetch(
                        `${API_BASE_URL}/${mediaType}/${movieId}/explore`
                    );

                    if (!explorerResponse.ok) {
                        throw new Error("No fue posible abrir la exploración.");
                    }

                    const explorerMovie = await explorerResponse.json();
                    explorerCache = {
                        movie: explorerMovie,
                        videos: summaryVideosData,
                        credits: creditsData,
                        releaseDates: certificationData,
                        translations: translationsData,
                        providers: providersData
                    };
                }

                // Evita repintar si la persona volvió al inicio durante la descarga.
                if (!result.contains(exploreButton)) return;

                result.innerHTML = renderExplorerMarkup(explorerCache);
                const explorerView = result.querySelector(".movie-explorer");
                bindExplorerPagination(explorerView);
                bindSeriesSeasons(explorerView, movieId);
                result.querySelector(".explorer-back").addEventListener("click", function() {
                    result.innerHTML = summaryMarkup;
                    bindExploreButton();
                    bindPersonCards();
                    bindCountrySearch();
                    bindRelatedMovies();
                    bindMovieActions();
                    result.scrollIntoView({ behavior: "smooth", block: "start" });
                });
                result.scrollIntoView({ behavior: "smooth", block: "start" });
            } catch (error) {
                exploreButton.disabled = false;
                exploreButton.querySelector("strong").textContent = "Intentar nuevamente";
                exploreButton.querySelector("small").textContent = "No se pudo cargar la ficha completa";
            }
        });
    }

    function bindRelatedMovies() {
        const recommendationsSection = result.querySelector(".movie-recommendations");
        if (!recommendationsSection) return;

        recommendationsSection.addEventListener("click", async function(event) {
            const relatedButton = event.target.closest(".related-movie");
            if (!relatedButton) return;

            const relatedId = Number(relatedButton.dataset.relatedId);
            const relatedType = relatedButton.dataset.mediaType || mediaType;
            const relatedMovie = relatedMovies.find(function(item) {
                return item.id === relatedId && item.media_type === relatedType;
            });
            if (!relatedMovie) return;

            result.innerHTML = `<p class="loading-message">Cargando recomendación…</p>`;
            result.scrollIntoView({ behavior: "smooth", block: "start" });

            try {
                await showContentDetails(relatedMovie, age);
            } catch (error) {
                result.innerHTML = `<p class="detail-error">No pudimos cargar esta recomendación.</p>`;
            }
        });
    }

    function bindMovieActions() {
        const actionsSection = result.querySelector(".movie-actions");
        if (!actionsSection) return;

        const saveButton = result.querySelector(".movie-action--save");
        const copyTitleButton = result.querySelector(".copy-movie-title");
        const shareButton = actionsSection.querySelector(".movie-action--share");
        const status = actionsSection.querySelector(".movie-actions__status");
        const posterStatus = result.querySelector(".poster-actions-status");

        copyTitleButton.addEventListener("click", async function() {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(title);
                } else {
                    const temporaryInput = document.createElement("textarea");
                    temporaryInput.value = title;
                    temporaryInput.style.position = "fixed";
                    temporaryInput.style.opacity = "0";
                    document.body.appendChild(temporaryInput);
                    temporaryInput.select();
                    document.execCommand("copy");
                    temporaryInput.remove();
                }

                copyTitleButton.classList.add("copy-movie-title--copied");
                copyTitleButton.setAttribute("aria-label", "Título copiado");
                copyTitleButton.innerHTML = `<span aria-hidden="true">✓</span>`;
                setTimeout(function() {
                    if (!copyTitleButton.isConnected) return;
                    copyTitleButton.classList.remove("copy-movie-title--copied");
                    copyTitleButton.setAttribute("aria-label", `Copiar el título ${title}`);
                    copyTitleButton.innerHTML = `<span aria-hidden="true">⧉</span>`;
                }, 1800);
            } catch (error) {
                copyTitleButton.setAttribute("aria-label", "No se pudo copiar el título");
                copyTitleButton.innerHTML = `<span aria-hidden="true">!</span>`;
            }
        });

        saveButton.addEventListener("click", function() {
            try {
                const wasSaved = toggleSavedMovie({
                    id: movieId,
                    title,
                    poster_path: posterPath,
                    release_date: releaseDate,
                    vote_average: voteAverage,
                    overview,
                    media_type: mediaType,
                    maxicheck_is_documentary: selectedMovie.maxicheck_is_documentary
                });
                updateSavedListButton();
                if (!savedListPanel.hidden) renderSavedList();
                saveButton.setAttribute("aria-pressed", String(wasSaved));
                saveButton.innerHTML = `<span aria-hidden="true">${wasSaved ? "♥" : "♡"}</span><span>${wasSaved ? "Guardada en Mi lista" : "Guardar en Mi lista"}</span>`;
                posterStatus.textContent = wasSaved
                    ? `${contentLabel} guardada en este navegador.`
                    : `${contentLabel} eliminada de tus guardadas.`;
                summaryMarkup = result.innerHTML;
            } catch (error) {
                posterStatus.textContent = "El navegador no permitió guardar este título.";
            }
        });

        shareButton.addEventListener("click", async function() {
            const shareData = {
                title: `${title} | MaxiCheck`,
                text: `Consulta ${title} en MaxiCheck.`,
                url: window.location.href.split("#")[0]
            };

            try {
                if (navigator.share) {
                    await navigator.share(shareData);
                    status.textContent = "Título compartido.";
                } else {
                    await navigator.clipboard.writeText(
                        `${shareData.text} ${shareData.url}`
                    );
                    status.textContent = "Información copiada al portapapeles.";
                }
            } catch (error) {
                // Cancelar el menú de compartir no debe mostrarse como un error grave.
                status.textContent = "No se compartió el título.";
            }
        });
    }

    bindExploreButton();
    bindPersonCards();
    bindCountrySearch();
    bindRelatedMovies();
    bindMovieActions();

}


// Descubre películas, series y documentales compatibles con la edad indicada.
async function showAgeRecommendations(age) {
    const firstResponse = await fetch(`${API_BASE_URL}/discover?age=${age}&page=1`);
    if (!firstResponse.ok) throw new Error("No fue posible obtener recomendaciones.");

    const firstPage = await firstResponse.json();
    let movies = (firstPage.results || []).map(normalizeContent);
    const initialResultsLimit = 6;
    const totalPages = firstPage.total_pages;
    let currentPage = firstPage.page;
    let visibleResultsLimit = initialResultsLimit;
    let isLoadingNextPage = false;

    showSearchResultsCount(movies.length);

    function renderRecommendations() {
        const visibleMovies = movies.slice(0, visibleResultsLimit);
        showSearchResultsCount(movies.length);
        searchResults.innerHTML = `
            <div class="age-recommendations-heading">
                <span>Recomendaciones por edad</span>
                <h2>Títulos recomendados para ${age} años</h2>
                <p>Películas, series y documentales con clasificación estadounidense verificada individualmente.</p>
            </div>
        `;

        visibleMovies.forEach(function(movie) {
            const poster = movie.poster_path
                ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
                : "";
            const year = movie.release_date
                ? movie.release_date.substring(0, 4)
                : "Año desconocido";
            const score = movie.vote_average > 0
                ? `⭐ ${movie.vote_average.toFixed(1)}`
                : "Sin puntuación";

            searchResults.innerHTML += `
                <button type="button" class="movie-option" data-movie-id="${movie.id}" data-media-type="${movie.media_type}">
                    ${poster
                        ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                        : `<div class="no-poster">Sin imagen</div>`
                    }
                    <div class="movie-option-info">
                        <span class="movie-option-type">${getContentTypeLabel(movie, true)}</span>
                        <span class="movie-option-title">${escapeHtml(movie.title)}</span>
                        <span class="movie-option-year">${year} · ${score}</span>
                        <span class="movie-option-certification">${escapeHtml(movie.maxicheck_certification || "Verificada")}</span>
                    </div>
                </button>
            `;
        });

        const hasLoadedHiddenResults = visibleResultsLimit < movies.length;
        const canCollapse = visibleResultsLimit > initialResultsLimit;
        const hasMorePages = currentPage < totalPages;

        if (hasLoadedHiddenResults || canCollapse || hasMorePages) {
            searchResults.innerHTML += `
                <div class="results-controls">
                    ${hasLoadedHiddenResults
                        ? `<button type="button" class="toggle-results">Ver más (${movies.length - visibleResultsLimit})</button>`
                        : ""
                    }
                    ${canCollapse ? `<button type="button" class="collapse-results">Ver menos</button>` : ""}
                    ${hasMorePages && !hasLoadedHiddenResults
                        ? `<button type="button" class="load-more-results">Cargar más recomendaciones</button>`
                        : ""
                    }
                </div>
            `;
        }
    }

    renderRecommendations();

    searchResults.onclick = async function(event) {
        const movieButton = event.target.closest(".movie-option");
        const showMoreButton = event.target.closest(".toggle-results");
        const collapseButton = event.target.closest(".collapse-results");
        const loadMoreButton = event.target.closest(".load-more-results");

        if (showMoreButton) {
            visibleResultsLimit = movies.length;
            renderRecommendations();
            return;
        }

        if (collapseButton) {
            visibleResultsLimit = initialResultsLimit;
            renderRecommendations();
            searchResults.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }

        if (loadMoreButton && !isLoadingNextPage) {
            isLoadingNextPage = true;
            loadMoreButton.disabled = true;
            loadMoreButton.textContent = "Cargando más recomendaciones…";

            try {
                const nextResponse = await fetch(
                    `${API_BASE_URL}/discover?age=${age}&page=${currentPage + 1}`
                );
                if (!nextResponse.ok) throw new Error("No fue posible cargar más.");
                const nextPage = await nextResponse.json();
                const knownIds = new Set(movies.map(getContentKey));
                movies = movies.concat((nextPage.results || []).map(normalizeContent).filter(function(movie) {
                    return !knownIds.has(getContentKey(movie));
                }));
                currentPage = nextPage.page;
                visibleResultsLimit = movies.length;
                renderRecommendations();
            } catch (error) {
                loadMoreButton.disabled = false;
                loadMoreButton.textContent = "No se pudo cargar. Intentar otra vez";
            } finally {
                isLoadingNextPage = false;
            }
            return;
        }

        if (movieButton) {
            const movieId = Number(movieButton.dataset.movieId);
            const mediaType = movieButton.dataset.mediaType || "movie";
            const selectedMovie = movies.find(function(movie) {
                return movie.id === movieId && movie.media_type === mediaType;
            });
            if (!selectedMovie) return;

            openedFromSavedList = false;
            searchResults.style.display = "none";
            resultToolbar.hidden = false;
            backButton.hidden = false;
            form.classList.add("form--detail");
            hideSearchResultsCount();
            result.innerHTML = `<p class="loading-message">Cargando recomendación…</p>`;

            try {
                await showContentDetails(selectedMovie, age);
            } catch (error) {
                result.innerHTML = `<p class="detail-error">No pudimos cargar este título.</p>`;
            }
        }
    };
}

recommendAgeButton.addEventListener("click", async function() {
    catalogRequestVersion += 1;
    setActiveNavigation("nav-home");
    const age = Number(ageInput.value);

    if (!Number.isInteger(age) || age < 1 || age > 120) {
        ageInput.reportValidity();
        ageInput.focus();
        return;
    }

    showThemeToggleOnHome(false);

    openedFromSavedList = false;
    resultToolbar.hidden = true;
    backButton.hidden = true;
    form.classList.remove("form--detail");
    recommendationSummary.textContent = "";
    resetHeaderIndicators();
    hideSearchResultsCount();
    result.innerHTML = "";
    searchResults.style.display = "grid";
    searchResults.innerHTML = `<p class="recommendations-loading">Buscando películas, series y documentales para tu edad…</p>`;
    recommendAgeButton.disabled = true;

    try {
        await showAgeRecommendations(age);
    } catch (error) {
        searchResults.innerHTML = `<p>No pudimos obtener recomendaciones en este momento.</p>`;
    } finally {
        recommendAgeButton.disabled = false;
    }
});


// Una nueva búsqueda reemplaza los resultados anteriores y conserva la edad indicada.
form.addEventListener("submit", async function(event) {

    event.preventDefault();
    catalogRequestVersion += 1;
    setActiveNavigation("nav-home");
    showThemeToggleOnHome(false);
    openedFromSavedList = false;

    resultToolbar.hidden = true;
    backButton.hidden = true;
    form.classList.remove("form--detail");
    recommendationSummary.textContent = "";
    resetHeaderIndicators();
    hideSearchResultsCount();
    searchResults.style.display = "grid";

    const age = ageInput.value;
    const movie = movieInput.value;


    const url =
        `${API_BASE_URL}/search?query=${encodeURIComponent(movie)}`;

    const response = await fetch(url);

    const data = await response.json();
    showSearchResultsCount(data.total_results);


    if (data.results.length === 0) {

        searchResults.innerHTML = `
            <p>No encontramos ninguna película, serie o documental con ese nombre.</p>
        `;

        result.innerHTML = "";

        return;
    }


    // Conserva las páginas cargadas para regresar al listado sin repetir peticiones.
    let movies = (data.results || []).map(normalizeContent);
    const initialResultsLimit = 6;
    const totalResults = data.total_results;
    const totalPages = data.total_pages;
    let currentPage = data.page;
    let visibleResultsLimit = initialResultsLimit;
    let isLoadingNextPage = false;

    searchResults.innerHTML = "";

    result.innerHTML = "";


    // Renderiza únicamente el límite visible y crea controles según el estado actual.
    function renderMovies() {

        const visibleMovies = movies.slice(0, visibleResultsLimit);

        searchResults.innerHTML = "";

        visibleMovies.forEach(function(movieResult) {

        const title = movieResult.title;

        const releaseDate = movieResult.release_date;

        const posterPath = movieResult.poster_path;

        const year = releaseDate
            ? releaseDate.substring(0, 4)
            : "Año desconocido";


        const posterUrl = posterPath
            ? `https://image.tmdb.org/t/p/w300${posterPath}`
            : "";


            searchResults.innerHTML += `
            <button 
                type="button"
                class="movie-option"
                data-movie-id="${movieResult.id}"
                data-media-type="${movieResult.media_type}"
            >
                ${
                    posterUrl
                        ? `<img src="${posterUrl}" alt="Poster de ${title}">`
                        : `<div class="no-poster">Sin imagen</div>`
                }

                <div class="movie-option-info">
                    <span class="movie-option-type">${getContentTypeLabel(movieResult, true)}</span>
                    <span class="movie-option-title">${title}</span>
                    <span class="movie-option-year">${year}</span>
                </div>
            </button>
`;

        });

        const hasLoadedHiddenResults = visibleResultsLimit < movies.length;
        const canCollapse = visibleResultsLimit > initialResultsLimit;
        const hasMorePages = currentPage < totalPages;

        if (hasLoadedHiddenResults || canCollapse || hasMorePages) {
            searchResults.innerHTML += `
                <div class="results-controls">
                    ${hasLoadedHiddenResults
                        ? `<button type="button" class="toggle-results" aria-expanded="false">
                            Ver más (${movies.length - visibleResultsLimit})
                           </button>`
                        : ""
                    }
                    ${canCollapse
                        ? `<button type="button" class="collapse-results">Ver menos</button>`
                        : ""
                    }
                    ${hasMorePages && !hasLoadedHiddenResults
                        ? `<button type="button" class="load-more-results">
                            Cargar más (${movies.length} de ${totalResults})
                           </button>`
                        : ""
                    }
                </div>
            `;
        }

    }

    renderMovies();

    // Delegar el clic al contenedor permite recrear sus botones sin añadir listeners.
    searchResults.onclick = async function(event) {

        const movieButton = event.target.closest(".movie-option");
        const toggleButton = event.target.closest(".toggle-results");
        const collapseButton = event.target.closest(".collapse-results");
        const loadMoreButton = event.target.closest(".load-more-results");

        if (toggleButton) {

            visibleResultsLimit = movies.length;
            renderMovies();

            return;

        }

        if (collapseButton) {
            visibleResultsLimit = initialResultsLimit;
            renderMovies();
            searchResults.scrollIntoView({ behavior: "smooth", block: "start" });

            return;
        }

        if (loadMoreButton && !isLoadingNextPage) {
            isLoadingNextPage = true;
            loadMoreButton.disabled = true;
            loadMoreButton.textContent = "Cargando más resultados…";

            try {
                const nextPage = currentPage + 1;
                const nextPageUrl =
                    `${API_BASE_URL}/search?query=${encodeURIComponent(movie)}&page=${nextPage}`;
                const nextPageResponse = await fetch(nextPageUrl);

                if (!nextPageResponse.ok) {
                    throw new Error("No fue posible cargar la página siguiente.");
                }

                const nextPageData = await nextPageResponse.json();
                const knownMovieIds = new Set(movies.map(getContentKey));
                const newMovies = (nextPageData.results || []).map(normalizeContent).filter(function(item) {
                    return !knownMovieIds.has(getContentKey(item));
                });

                movies = movies.concat(newMovies);
                currentPage = nextPageData.page;
                visibleResultsLimit = movies.length;
                renderMovies();
            } catch (error) {
                loadMoreButton.disabled = false;
                loadMoreButton.textContent = "No se pudo cargar. Intentar otra vez";
            } finally {
                isLoadingNextPage = false;
            }

            return;
        }

        if (movieButton) {

            const movieId = Number(movieButton.dataset.movieId);
            const mediaType = movieButton.dataset.mediaType || "movie";
            openedFromSavedList = false;

            const selectedMovie = movies.find(function(movieResult) {

                return movieResult.id === movieId && movieResult.media_type === mediaType;
                
            });
            
            // Al entrar al detalle se oculta la cuadrícula, pero sus datos se conservan.
            searchResults.style.display = "none";
            resultToolbar.hidden = false;
            backButton.hidden = false;
            form.classList.add("form--detail");
            hideSearchResultsCount();
            result.innerHTML = `<p class="loading-message">Cargando información del título…</p>`;

            try {
                await showContentDetails(selectedMovie, age);
            } catch (error) {
                resetHeaderIndicators();
                recommendationSummary.textContent = "No pudimos cargar todos los detalles.";
                recommendationSummary.className =
                    "recommendation-summary recommendation-summary--denied";
                result.innerHTML = `
                    <p class="detail-error">
                        Ocurrió un problema al consultar la información. Inténtalo nuevamente.
                    </p>
                `;
            }

        }

    };

});


// Restaura exactamente la cuadrícula previa y limpia únicamente la ficha abierta.
backButton.addEventListener("click", function() {

    const returnToSavedList = openedFromSavedList;
    openedFromSavedList = false;
    result.innerHTML = "";
    recommendationSummary.textContent = "";
    resetHeaderIndicators();
    searchResults.style.display = "grid";
    resultToolbar.hidden = true;
    backButton.hidden = true;
    form.classList.remove("form--detail");

    if (returnToSavedList) {
        hideSearchResultsCount();
        searchResults.innerHTML = "";
        openSavedList();
    } else {
        showSearchResultsCount(currentResultsCount);
    }

});
