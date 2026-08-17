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
let currentResultsCount = 0;
let openedFromSavedList = false;
const SAVED_MOVIES_KEY = "maxicheck-saved-movies";

function getSavedMovies() {
    try {
        const savedMovies = JSON.parse(localStorage.getItem(SAVED_MOVIES_KEY) || "[]");
        return Array.isArray(savedMovies) ? savedMovies : [];
    } catch (error) {
        return [];
    }
}

function movieIsSaved(movieId) {
    return getSavedMovies().some(function(movie) { return movie.id === movieId; });
}

function toggleSavedMovie(movie) {
    const savedMovies = getSavedMovies();
    const existingIndex = savedMovies.findIndex(function(item) { return item.id === movie.id; });

    if (existingIndex >= 0) {
        savedMovies.splice(existingIndex, 1);
    } else {
        savedMovies.unshift(movie);
    }

    localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(savedMovies));
    return existingIndex < 0;
}

function updateSavedListButton() {
    const total = getSavedMovies().length;
    savedListCount.textContent = String(total);
    savedListButton.setAttribute(
        "aria-label",
        `Abrir Mi lista, ${total} ${total === 1 ? "película" : "películas"}`
    );
}

function renderSavedList() {
    const savedMovies = getSavedMovies();

    if (savedMovies.length === 0) {
        savedListContent.innerHTML = `
            <div class="saved-list-empty">
                <span aria-hidden="true">♡</span>
                <h3>Tu lista está vacía</h3>
                <p>Guarda una película desde su ficha para encontrarla aquí.</p>
            </div>
        `;
        return;
    }

    savedListContent.innerHTML = `
        <div class="saved-list-grid">
            ${savedMovies.map(function(movie) {
                const poster = movie.poster_path
                    ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
                    : "";
                const year = movie.release_date
                    ? movie.release_date.substring(0, 4)
                    : "Año desconocido";

                return `
                    <article class="saved-movie-card">
                        <button type="button" class="saved-movie-open" data-saved-id="${movie.id}">
                            ${poster
                                ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                                : `<span class="saved-movie-placeholder">Sin imagen</span>`
                            }
                            <span><strong>${escapeHtml(movie.title)}</strong><small>${year}</small></span>
                        </button>
                        <button type="button" class="saved-movie-remove" data-remove-id="${movie.id}" aria-label="Eliminar ${escapeHtml(movie.title)} de Mi lista">Eliminar</button>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

function openSavedList() {
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
    savedListButton.focus();
}

savedListButton.addEventListener("click", openSavedList);
savedListClose.addEventListener("click", closeSavedList);
savedListPanel.addEventListener("click", function(event) {
    if (event.target === savedListPanel) closeSavedList();
});

savedListContent.addEventListener("click", async function(event) {
    const removeButton = event.target.closest(".saved-movie-remove");
    const openButton = event.target.closest(".saved-movie-open");

    if (removeButton) {
        const movieId = Number(removeButton.dataset.removeId);
        const updatedMovies = getSavedMovies().filter(function(movie) { return movie.id !== movieId; });
        localStorage.setItem(SAVED_MOVIES_KEY, JSON.stringify(updatedMovies));
        updateSavedListButton();
        renderSavedList();
        return;
    }

    if (openButton) {
        const movieId = Number(openButton.dataset.savedId);
        const savedMovie = getSavedMovies().find(function(movie) { return movie.id === movieId; });
        if (!savedMovie) return;

        movieInput.value = savedMovie.title;
        const age = Number(ageInput.value);

        if (!Number.isFinite(age) || age < 1 || age > 120) {
            closeSavedList();
            searchResults.style.display = "grid";
            searchResults.innerHTML = `<p>Indica tu edad para comprobar la película guardada.</p>`;
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
        result.innerHTML = `<p class="loading-message">Cargando película guardada…</p>`;

        try {
            const searchResponse = await fetch(
                `${API_BASE_URL}/search?query=${encodeURIComponent(savedMovie.title)}`
            );
            if (!searchResponse.ok) throw new Error("No fue posible buscar la película.");
            const searchData = await searchResponse.json();
            const completeMovie = searchData.results.find(function(movie) {
                return movie.id === savedMovie.id;
            }) || savedMovie;
            await showMovieDetails(completeMovie, age);
        } catch (error) {
            result.innerHTML = `<p class="detail-error">No pudimos abrir esta película guardada.</p>`;
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
}

// Restaura la misma vista limpia que encuentra una persona al abrir MaxiCheck.
function resetApplication() {
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

// Asigna un estado visual a cada clasificación sin depender del texto completo.
function getCertificationClass(certification) {
    const normalized = certification.toUpperCase();

    if (normalized === "G") return "header-certification--g";
    if (normalized === "PG") return "header-certification--pg";
    if (normalized === "PG-13") return "header-certification--pg13";
    if (normalized === "R") return "header-certification--r";
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

function renderImageGallery(images, label) {
    if (!Array.isArray(images) || images.length === 0) {
        return `<p class="explorer-empty">No hay ${label.toLowerCase()} disponibles.</p>`;
    }

    return `
        <div class="explorer-gallery">
            ${images.map(function(image, index) {
                const previewUrl = `https://image.tmdb.org/t/p/w500${image.file_path}`;
                const originalUrl = `https://image.tmdb.org/t/p/original${image.file_path}`;

                return `
                    <a href="${originalUrl}" target="_blank" rel="noopener noreferrer"
                       aria-label="Abrir ${label.toLowerCase()} ${index + 1} en tamaño completo">
                        <img src="${previewUrl}" alt="${label} ${index + 1}" loading="lazy">
                    </a>
                `;
            }).join("")}
        </div>
    `;
}

// Construye la vista extensa con cada conjunto de datos que MaxiCheck recibió de TMDB.
function renderExplorerMarkup(bundle) {
    const movie = bundle.movie;
    const credits = bundle.credits;
    const releaseDates = bundle.releaseDates;
    const translations = bundle.translations;
    const providers = bundle.providers;
    const images = movie.images || {};
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
                <article class="explorer-video">
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
        ["Estado", movie.status], ["Fecha de estreno", movie.release_date],
        ["Duración", formatRuntime(movie.runtime)], ["Idioma original", getLanguageName(movie.original_language, movie.original_language)],
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
                <span>Explorar película</span>
                <h2>${escapeHtml(movie.title)}</h2>
                <p>${escapeHtml(movie.tagline || movie.overview || "Información completa de TMDB")}</p>
            </header>

            <details class="explorer-section" open><summary>Galería de imágenes</summary>
                <h3>Fondos</h3>${renderImageGallery(images.backdrops, "Fondo")}
                <h3>Pósteres</h3>${renderImageGallery(images.posters, "Póster")}
                <h3>Logos</h3>${renderImageGallery(images.logos, "Logo")}
            </details>

            <details class="explorer-section" open><summary>Videos y tráileres</summary><div class="explorer-videos">${videosMarkup}</div></details>
            <details class="explorer-section" open><summary>Ficha técnica completa</summary><dl class="explorer-details">${detailRows}</dl></details>
            <details class="explorer-section"><summary>Reparto completo (${credits.cast?.length || 0})</summary><div class="explorer-people">${castMarkup}</div></details>
            <details class="explorer-section"><summary>Equipo técnico completo (${credits.crew?.length || 0})</summary><ul class="explorer-data-list">${crewMarkup}</ul></details>
            <details class="explorer-section"><summary>Estrenos y clasificaciones por país</summary><div class="explorer-releases">${releasesMarkup}</div></details>
            <details class="explorer-section"><summary>Títulos y traducciones</summary><ul class="explorer-data-list">${translationsMarkup}</ul></details>
            <details class="explorer-section"><summary>Disponibilidad internacional</summary><ul class="explorer-data-list">${providerCountries}</ul></details>
            <details class="explorer-section"><summary>Palabras clave</summary><div class="info-chip-list">${renderChips(keywords.map(function(item) { return escapeHtml(item.name); }), "No disponibles")}</div></details>
            <details class="explorer-section explorer-raw"><summary>Datos originales recibidos de TMDB</summary><p>Incluye todos los campos recibidos por MaxiCheck, sin exponer la API key.</p><pre>${rawData}</pre></details>
        </section>
    `;
}

// Convierte las clasificaciones estadounidenses de TMDB en una edad orientativa.
// `null` distingue una clasificación desconocida de una apta para todo público.
function getMinimumAge(certification) {

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

    return null;
}

// Consulta las fechas de estreno para obtener la clasificación y dibuja la ficha.
async function showMovieDetails(selectedMovie, age) {

    const movieId = selectedMovie.id;

    const title = selectedMovie.title;
    const releaseDate = selectedMovie.release_date;
    const overview = selectedMovie.overview;
    const posterPath = selectedMovie.poster_path;
    const voteAverage = selectedMovie.vote_average;


    const year = releaseDate
        ? releaseDate.substring(0, 4)
        : "Año desconocido";


    const posterUrl = posterPath
        ? `https://image.tmdb.org/t/p/w500${posterPath}`
        : "";

    // TMDB entrega la puntuación sobre diez; se limita a un decimal para simplificarla.
    const tmdbRating = voteAverage > 0
        ? `⭐ ${voteAverage.toFixed(1)}/10`
        : "Sin votos";


    const certificationUrl =
        `${API_BASE_URL}/movie/${movieId}/release-dates`;
    const creditsUrl = `${API_BASE_URL}/movie/${movieId}/credits`;
    const detailsUrl = `${API_BASE_URL}/movie/${movieId}/details`;
    const translationsUrl = `${API_BASE_URL}/movie/${movieId}/translations`;
    const watchProvidersUrl = `${API_BASE_URL}/movie/${movieId}/watch-providers`;
    const recommendationsUrl = `${API_BASE_URL}/movie/${movieId}/recommendations`;
    const similarUrl = `${API_BASE_URL}/movie/${movieId}/similar`;
    const videosUrl = `${API_BASE_URL}/movie/${movieId}/videos`;

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
        throw new Error("No fue posible cargar toda la información de la película.");
    }

    const [certificationData, creditsData, detailsData, translationsData, providersData,
        recommendationsData, similarData, summaryVideosData] =
        await Promise.all(responses.map(function(response) { return response.json(); }));

    // Las películas de una colección tienen prioridad sobre las demás sugerencias.
    let collectionData = null;
    if (detailsData.belongs_to_collection?.id) {
        const collectionResponse = await fetch(
            `${API_BASE_URL}/collection/${detailsData.belongs_to_collection.id}`
        );
        if (collectionResponse.ok) collectionData = await collectionResponse.json();
    }


    // Se usa Estados Unidos porque las equivalencias de edad de arriba son G/PG/R.
    const usRelease = certificationData.results.find(function(country) {

        return country.iso_3166_1 === "US";

    });


    let certification = "No disponible";


    if (usRelease) {

        // Algunos estrenos (festival, cine o digital) llegan sin certificación.
        const certifiedRelease = usRelease.release_dates.find(function(release) {

            return release.certification !== "";

        });


        if (certifiedRelease) {

            certification = certifiedRelease.certification;

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
                <article class="cast-member">
                    ${profileUrl
                        ? `<img src="${profileUrl}" alt="Foto de ${actor.name}" loading="lazy">`
                        : `<div class="cast-member__placeholder" aria-hidden="true">👤</div>`
                    }
                    <div class="cast-member__info">
                        <strong>${actor.name}</strong>
                        <span>${actor.character || "Personaje no disponible"}</span>
                    </div>
                </article>
            `;
        }).join("")
        : `<p class="cast-empty">Reparto no disponible.</p>`;

    // El equipo técnico puede contener más de un director, por ejemplo en codirecciones.
    const directors = Array.isArray(creditsData.crew)
        ? creditsData.crew
            .filter(function(member) { return member.job === "Director"; })
            .slice(0, 2)
        : [];
    const directorsMarkup = directors.length > 0
        ? directors.map(function(director) {
            const directorPhotoUrl = director.profile_path
                ? `https://image.tmdb.org/t/p/w185${director.profile_path}`
                : "";

            return `
                <article class="director-profile">
                    ${directorPhotoUrl
                        ? `<img class="director-profile__photo" src="${directorPhotoUrl}" alt="Foto de ${director.name}" loading="lazy">`
                        : `<div class="director-profile__placeholder" aria-hidden="true">🎬</div>`
                    }
                    <div class="director-profile__info">
                        <strong>${director.name}</strong>
                        <span>Director</span>
                    </div>
                </article>
            `;
        }).join("")
        : `<p class="context-value">Director no disponible.</p>`;

    const countries = Array.isArray(detailsData.production_countries)
        ? detailsData.production_countries.slice(0, 3)
        : [];
    const countriesMarkup = countries.length > 0
        ? countries.map(function(country) {
            const countryCode = country.iso_3166_1.toLowerCase();

            return `
                <span class="country-chip">
                    <img
                        class="country-chip__flag"
                        src="https://flagcdn.com/w40/${countryCode}.png"
                        srcset="https://flagcdn.com/w80/${countryCode}.png 2x"
                        alt="Bandera de ${country.name}"
                        loading="lazy"
                    >
                    <span>${country.name}</span>
                </span>
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
    const collectionName = detailsData.belongs_to_collection?.name || "No pertenece a una saga";

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
            if (item.id === movieId || relatedMovieMap.has(item.id) || !item.title) return;
            relatedMovieMap.set(item.id, { ...item, recommendationReason: reason });
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
                <button type="button" class="related-movie" data-related-id="${relatedMovie.id}">
                    ${relatedPoster
                        ? `<img src="${relatedPoster}" alt="Póster de ${escapeHtml(relatedMovie.title)}" loading="lazy">`
                        : `<span class="related-movie__placeholder">Sin imagen</span>`
                    }
                    <span class="related-movie__content">
                        <span class="related-movie__reason">${escapeHtml(relatedMovie.recommendationReason)}</span>
                        <strong>${escapeHtml(relatedMovie.title)}</strong>
                        <small>${relatedYear} · ⭐ ${relatedScore}</small>
                    </span>
                </button>
            `;
        }).join("")
        : `<p class="related-empty">Todavía no encontramos recomendaciones para esta película.</p>`;
    const initiallySaved = movieIsSaved(movieId);
    const tmdbMovieUrl = `https://www.themoviedb.org/movie/${movieId}?language=es-ES`;
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
        ? "No hay una edad orientativa disponible para esta película."
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
        <span class="recommendation-summary__age">${ageGuidance}</span>
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

    headerCertification.textContent = certification;
    headerCertification.className =
        `header-certification ${getCertificationClass(certification)}`;
    headerCertification.hidden = false;
    headerCertification.title = `Clasificación ${certification}`;
    headerCertification.setAttribute("aria-label", `Clasificación ${certification}`);

    // El acceso a la exploración se ubica bajo el póster y se carga solo al solicitarlo.
    result.innerHTML = `
        <h2 class="movie-title">${title}</h2>

        <div class="movie-poster-zone">
            ${posterUrl
                ? `<img class="movie-poster" src="${posterUrl}" alt="Poster de ${title}" width="250">`
                : `<div class="movie-poster-placeholder">Póster no disponible</div>`
            }
            <button type="button" class="explore-movie-button">
                <span class="explore-movie-button__icon" aria-hidden="true">▦</span>
                <span><strong>Explorar película</strong><small>Galería, tráileres y ficha completa</small></span>
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

        <div class="movie-metadata">
            <p class="metadata-card">
                <span class="metadata-card__label">Año</span>
                <strong class="metadata-card__value">${year}</strong>
            </p>

            <p class="metadata-card">
                <span class="metadata-card__label">Edad consultada</span>
                <strong class="metadata-card__value">${age} años</strong>
            </p>

            <p class="metadata-card metadata-card--rating">
                <span class="metadata-card__label">Clasificación</span>
                <strong class="metadata-card__value">${certification}</strong>
            </p>

            <p class="metadata-card metadata-card--score">
                <span class="metadata-card__label">Puntuación TMDB</span>
                <strong class="metadata-card__value">${tmdbRating}</strong>
            </p>
        </div>

        <div class="movie-context">
            <section class="context-card" aria-labelledby="director-title">
                <h3 id="director-title">Dirección</h3>
                <div class="director-list">${directorsMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="countries-title">
                <h3 id="countries-title">País de producción</h3>
                <div class="country-list">${countriesMarkup}</div>
            </section>
            <section class="context-card" aria-labelledby="runtime-title">
                <h3 id="runtime-title">Duración</h3>
                <p class="context-value">⏱ ${runtime}</p>
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
                <h3 id="collection-title">Saga o colección</h3>
                <p class="context-value">${collectionName}</p>
            </section>
            <section class="context-card context-card--titles" aria-labelledby="titles-title">
                <h3 id="titles-title">Otros títulos</h3>
                <dl class="alternate-titles">
                    <div><dt>Original</dt><dd>${detailsData.original_title || "No disponible"}</dd></div>
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
                : `<p class="providers-empty">No encontramos plataformas disponibles para esta película.</p>`
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
                <p>Basadas en la saga, afinidad de TMDB y géneros similares.</p>
            </div>
            <div class="related-movies-grid">${relatedMoviesMarkup}</div>
        </section>

        <section class="movie-actions" aria-labelledby="movie-actions-title">
            <div>
                <h3 id="movie-actions-title">Compartir y enlaces oficiales</h3>
                <p>Comparte la película o consulta sus fuentes externas.</p>
            </div>
            <div class="movie-actions__buttons">
                <button type="button" class="movie-action movie-action--share">
                    <span aria-hidden="true">↗</span><span>Compartir</span>
                </button>
                <a class="movie-action" href="${tmdbMovieUrl}" target="_blank" rel="noopener noreferrer">TMDB</a>
                ${imdbMovieUrl ? `<a class="movie-action" href="${imdbMovieUrl}" target="_blank" rel="noopener noreferrer">IMDb</a>` : ""}
                <a class="movie-action" href="${filmAffinityUrl}" target="_blank" rel="noopener noreferrer">FilmAffinity</a>
                ${officialMovieUrl ? `<a class="movie-action" href="${escapeHtml(officialMovieUrl)}" target="_blank" rel="noopener noreferrer">Sitio oficial</a>` : ""}
            </div>
            <p class="movie-actions__status" role="status" aria-live="polite"></p>
        </section>
    `;

    let summaryMarkup = result.innerHTML;
    let explorerCache = null;

    function bindExploreButton() {
        const exploreButton = result.querySelector(".explore-movie-button");

        if (!exploreButton) return;

        exploreButton.addEventListener("click", async function() {
            exploreButton.disabled = true;
            exploreButton.querySelector("strong").textContent = "Cargando…";

            try {
                if (!explorerCache) {
                    const explorerResponse = await fetch(
                        `${API_BASE_URL}/movie/${movieId}/explore`
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
                result.querySelector(".explorer-back").addEventListener("click", function() {
                    result.innerHTML = summaryMarkup;
                    bindExploreButton();
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
            const relatedMovie = relatedMovies.find(function(item) { return item.id === relatedId; });
            if (!relatedMovie) return;

            result.innerHTML = `<p class="loading-message">Cargando recomendación…</p>`;
            result.scrollIntoView({ behavior: "smooth", block: "start" });

            try {
                await showMovieDetails(relatedMovie, age);
            } catch (error) {
                result.innerHTML = `<p class="detail-error">No pudimos cargar esta recomendación.</p>`;
            }
        });
    }

    function bindMovieActions() {
        const actionsSection = result.querySelector(".movie-actions");
        if (!actionsSection) return;

        const saveButton = result.querySelector(".movie-action--save");
        const shareButton = actionsSection.querySelector(".movie-action--share");
        const status = actionsSection.querySelector(".movie-actions__status");
        const posterStatus = result.querySelector(".poster-actions-status");

        saveButton.addEventListener("click", function() {
            try {
                const wasSaved = toggleSavedMovie({
                    id: movieId,
                    title,
                    poster_path: posterPath,
                    release_date: releaseDate,
                    vote_average: voteAverage
                });
                updateSavedListButton();
                if (!savedListPanel.hidden) renderSavedList();
                saveButton.setAttribute("aria-pressed", String(wasSaved));
                saveButton.innerHTML = `<span aria-hidden="true">${wasSaved ? "♥" : "♡"}</span><span>${wasSaved ? "Guardada en Mi lista" : "Guardar en Mi lista"}</span>`;
                posterStatus.textContent = wasSaved
                    ? "Película guardada en este navegador."
                    : "Película eliminada de tus guardadas.";
                summaryMarkup = result.innerHTML;
            } catch (error) {
                posterStatus.textContent = "El navegador no permitió guardar la película.";
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
                    status.textContent = "Película compartida.";
                } else {
                    await navigator.clipboard.writeText(
                        `${shareData.text} ${shareData.url}`
                    );
                    status.textContent = "Información copiada al portapapeles.";
                }
            } catch (error) {
                // Cancelar el menú de compartir no debe mostrarse como un error grave.
                status.textContent = "No se compartió la película.";
            }
        });
    }

    bindExploreButton();
    bindRelatedMovies();
    bindMovieActions();

}


// Descubre muchas películas compatibles con la edad y carga páginas progresivamente.
async function showAgeRecommendations(age) {
    const firstResponse = await fetch(`${API_BASE_URL}/discover?age=${age}&page=1`);
    if (!firstResponse.ok) throw new Error("No fue posible obtener recomendaciones.");

    const firstPage = await firstResponse.json();
    let movies = [...firstPage.results];
    const initialResultsLimit = 6;
    const totalResults = firstPage.total_results;
    const totalPages = firstPage.total_pages;
    let currentPage = firstPage.page;
    let visibleResultsLimit = initialResultsLimit;
    let isLoadingNextPage = false;

    showSearchResultsCount(totalResults);

    function renderRecommendations() {
        const visibleMovies = movies.slice(0, visibleResultsLimit);
        searchResults.innerHTML = `
            <div class="age-recommendations-heading">
                <span>Recomendaciones por edad</span>
                <h2>Películas recomendadas para ${age} años</h2>
                <p>Ordenadas por popularidad y limitadas a clasificaciones compatibles con la edad.</p>
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
                <button type="button" class="movie-option" data-movie-id="${movie.id}">
                    ${poster
                        ? `<img src="${poster}" alt="Póster de ${escapeHtml(movie.title)}" loading="lazy">`
                        : `<div class="no-poster">Sin imagen</div>`
                    }
                    <div class="movie-option-info">
                        <span class="movie-option-title">${escapeHtml(movie.title)}</span>
                        <span class="movie-option-year">${year} · ${score}</span>
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
                        ? `<button type="button" class="load-more-results">Cargar más (${movies.length} de ${totalResults})</button>`
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
                const knownIds = new Set(movies.map(function(movie) { return movie.id; }));
                movies = movies.concat(nextPage.results.filter(function(movie) {
                    return !knownIds.has(movie.id);
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
            const selectedMovie = movies.find(function(movie) { return movie.id === movieId; });
            if (!selectedMovie) return;

            openedFromSavedList = false;
            searchResults.style.display = "none";
            resultToolbar.hidden = false;
            backButton.hidden = false;
            form.classList.add("form--detail");
            hideSearchResultsCount();
            result.innerHTML = `<p class="loading-message">Cargando película recomendada…</p>`;

            try {
                await showMovieDetails(selectedMovie, age);
            } catch (error) {
                result.innerHTML = `<p class="detail-error">No pudimos cargar esta película.</p>`;
            }
        }
    };
}

recommendAgeButton.addEventListener("click", async function() {
    const age = Number(ageInput.value);

    if (!Number.isInteger(age) || age < 1 || age > 120) {
        ageInput.reportValidity();
        ageInput.focus();
        return;
    }

    openedFromSavedList = false;
    resultToolbar.hidden = true;
    backButton.hidden = true;
    form.classList.remove("form--detail");
    recommendationSummary.textContent = "";
    resetHeaderIndicators();
    hideSearchResultsCount();
    result.innerHTML = "";
    searchResults.style.display = "grid";
    searchResults.innerHTML = `<p class="recommendations-loading">Buscando películas para tu edad…</p>`;
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
            <p>No encontramos ninguna película con ese nombre.</p>
        `;

        result.innerHTML = "";

        return;
    }


    // Conserva las páginas cargadas para regresar al listado sin repetir peticiones.
    let movies = [...data.results];
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
            >
                ${
                    posterUrl
                        ? `<img src="${posterUrl}" alt="Poster de ${title}">`
                        : `<div class="no-poster">Sin imagen</div>`
                }

                <div class="movie-option-info">
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
                const knownMovieIds = new Set(movies.map(function(item) { return item.id; }));
                const newMovies = nextPageData.results.filter(function(item) {
                    return !knownMovieIds.has(item.id);
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
            openedFromSavedList = false;

            const selectedMovie = movies.find(function(movieResult) {

                return movieResult.id === movieId;
                
            });
            
            // Al entrar al detalle se oculta la cuadrícula, pero sus datos se conservan.
            searchResults.style.display = "none";
            resultToolbar.hidden = false;
            backButton.hidden = false;
            form.classList.add("form--detail");
            hideSearchResultsCount();
            result.innerHTML = `<p class="loading-message">Cargando información de la película…</p>`;

            try {
                await showMovieDetails(selectedMovie, age);
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
