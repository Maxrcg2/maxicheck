// Todas las consultas pasan por el proxy, por lo que la clave nunca llega al navegador.
const API_BASE_URL = "https://maxicheck-api.maxwell-rcg.workers.dev";

// Referencias a los controles que la aplicación actualiza durante cada búsqueda.
const form = document.getElementById("movie-form");
const ageInput = document.getElementById("age");
const movieInput = document.getElementById("movie");
const searchResults = document.getElementById("search-results");
const resultToolbar = document.getElementById("result-toolbar");
const backButton = document.getElementById("back-button");
const recommendationSummary = document.getElementById("recommendation-summary");
const result = document.getElementById("result");


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


    const certificationResponse = await fetch(certificationUrl);

    const certificationData = await certificationResponse.json();


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


    const minimumAge = getMinimumAge(certification);

    let recommendation = "";
    let recommendationClass = "";


    // La recomendación se calcula localmente comparando la edad con el mínimo.
    if (minimumAge === null) {

        recommendation =
            "ℹ️ No tenemos suficiente información para determinar si es apropiada.";
        recommendationClass = "recommendation-summary--unknown";

    } else if (age >= minimumAge) {

        recommendation =
            "✅ Apta según nuestra recomendación de edad.";
        recommendationClass = "recommendation-summary--approved";

    } else {

        recommendation =
            "⛔ No recomendada para tu edad.";
        recommendationClass = "recommendation-summary--denied";

    }


    // Actualiza la barra superior antes de dibujar el resto de la ficha.
    recommendationSummary.textContent = recommendation;
    recommendationSummary.className =
        `recommendation-summary ${recommendationClass}`;

    // El póster y la descripción son opcionales porque TMDB puede no incluirlos.
    result.innerHTML = `
        ${
            posterUrl
                ? `<img src="${posterUrl}" alt="Poster de ${title}" width="250">`
                : "<p>Poster no disponible.</p>"
        }

        <h2>${title}</h2>

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

        <div class="movie-description">
            <h3>Descripción</h3>
            <p>${overview || "Descripción no disponible."}</p>
        </div>
    `;

}


// Una nueva búsqueda reemplaza los resultados anteriores y conserva la edad indicada.
form.addEventListener("submit", async function(event) {

    event.preventDefault();

    resultToolbar.hidden = true;
    recommendationSummary.textContent = "";
    searchResults.style.display = "grid";

    const age = ageInput.value;
    const movie = movieInput.value;


    const url =
        `${API_BASE_URL}/search?query=${encodeURIComponent(movie)}`;

    const response = await fetch(url);

    const data = await response.json();


    if (data.results.length === 0) {

        searchResults.innerHTML = `
            <p>No encontramos ninguna película con ese nombre.</p>
        `;

        result.innerHTML = "";

        return;
    }


    // Se guardan todos los resultados en memoria para alternar Ver más/Ver menos
    // y regresar desde el detalle sin repetir la petición de búsqueda.
    const movies = data.results;
    const initialResultsLimit = 6;
    let showAllResults = false;

    searchResults.innerHTML = "";

    result.innerHTML = "";


    // Renderiza seis coincidencias inicialmente o la colección completa al expandir.
    function renderMovies() {

        const visibleMovies = showAllResults
            ? movies
            : movies.slice(0, initialResultsLimit);

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

        // El control solo aparece cuando realmente existen resultados ocultos.
        if (movies.length > initialResultsLimit) {

            const hiddenResults = movies.length - initialResultsLimit;

            searchResults.innerHTML += `
                <button
                    type="button"
                    class="toggle-results"
                    aria-expanded="${showAllResults}"
                >
                    ${showAllResults
                        ? "Ver menos"
                        : `Ver más (${hiddenResults})`}
                </button>
            `;

        }

    }

    renderMovies();

    // Delegar el clic al contenedor permite recrear sus botones sin añadir listeners.
    searchResults.onclick = function(event) {

        const movieButton = event.target.closest(".movie-option");
        const toggleButton = event.target.closest(".toggle-results");

        if (toggleButton) {

            showAllResults = !showAllResults;
            renderMovies();

            return;

        }

        if (movieButton) {

            const movieId = Number(movieButton.dataset.movieId);

            const selectedMovie = movies.find(function(movieResult) {

                return movieResult.id === movieId;
                
            });
            
            // Al entrar al detalle se oculta la cuadrícula, pero sus datos se conservan.
            searchResults.style.display = "none";
            resultToolbar.hidden = false;

            showMovieDetails(selectedMovie, age);

        }

    };

});


// Restaura exactamente la cuadrícula previa y limpia únicamente la ficha abierta.
backButton.addEventListener("click", function() {

    result.innerHTML = "";
    recommendationSummary.textContent = "";
    searchResults.style.display = "grid";
    resultToolbar.hidden = true;

});
