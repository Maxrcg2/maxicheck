import { firebaseConfig } from "./firebase-config.js";

/**
 * Inicializa Firebase antes de cargar la aplicación principal.
 *
 * MaxiCheck expone servicios pequeños en window para que app.js no dependa de
 * detalles internos de Firebase: sesión, perfil y Mi lista. Si la red o el SDK
 * fallan, la búsqueda de TMDB continúa disponible.
 */

const FIREBASE_VERSION = "12.17.0";
const LEGACY_STORAGE_KEY = "maxicheck-saved-movies";
const authListeners = new Set();
const listListeners = new Set();
const profileListeners = new Set();
const DEFAULT_PROFILE = Object.freeze({
    displayName: "",
    avatarId: "google",
    avatarColor: "blue",
    defaultAge: null,
    birthDate: "",
    preferredTheme: "dark",
    preferredMediaType: "all",
    openSuggestionDirectly: false
});

let currentUser = null;
let authReady = false;
let firebaseError = null;
let cachedMovies = [];
let stopFirestoreListener = null;
let cachedProfile = { ...DEFAULT_PROFILE };
let profileReady = false;
let profileError = null;
let stopProfileListener = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function notifyAuth() {
    const state = { user: publicUser(currentUser), ready: authReady, error: firebaseError };
    authListeners.forEach(function(listener) {
        try {
            listener(state);
        } catch (error) {
            console.error("Un control de sesión no pudo actualizarse.", error);
        }
    });
}

function notifyList() {
    const snapshot = clone(cachedMovies);
    listListeners.forEach(function(listener) {
        try {
            listener(snapshot);
        } catch (error) {
            console.error("Un control de Mi lista no pudo actualizarse.", error);
        }
    });
}

function normalizeProfile(profile = {}) {
    const validAvatars = ["google", "initials", "movie", "popcorn", "star", "rocket", "hero"];
    const validColors = ["blue", "violet", "green", "amber", "rose"];
    const validThemes = ["dark", "dim", "light"];
    const validMediaTypes = ["all", "movie", "tv", "documentary"];
    const defaultAge = Number(profile.defaultAge);
    const birthDate = String(profile.birthDate || "").trim();
    const birthDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
    let validBirthDate = "";

    if (birthDateMatch) {
        const year = Number(birthDateMatch[1]);
        const month = Number(birthDateMatch[2]);
        const day = Number(birthDateMatch[3]);
        const candidate = new Date(Date.UTC(year, month - 1, day));
        const today = new Date();
        const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        const oldestUtc = Date.UTC(today.getFullYear() - 120, today.getMonth(), today.getDate());
        const candidateUtc = candidate.getTime();
        const isExactDate = candidate.getUTCFullYear() === year
            && candidate.getUTCMonth() === month - 1
            && candidate.getUTCDate() === day;
        if (isExactDate && candidateUtc <= todayUtc && candidateUtc >= oldestUtc) validBirthDate = birthDate;
    }

    return {
        displayName: String(profile.displayName || "").trim().slice(0, 60),
        avatarId: validAvatars.includes(profile.avatarId) ? profile.avatarId : DEFAULT_PROFILE.avatarId,
        avatarColor: validColors.includes(profile.avatarColor) ? profile.avatarColor : DEFAULT_PROFILE.avatarColor,
        defaultAge: Number.isInteger(defaultAge) && defaultAge >= 1 && defaultAge <= 120 ? defaultAge : null,
        birthDate: validBirthDate,
        preferredTheme: validThemes.includes(profile.preferredTheme) ? profile.preferredTheme : DEFAULT_PROFILE.preferredTheme,
        preferredMediaType: validMediaTypes.includes(profile.preferredMediaType)
            ? profile.preferredMediaType
            : DEFAULT_PROFILE.preferredMediaType,
        openSuggestionDirectly: profile.openSuggestionDirectly === true
    };
}

function notifyProfile() {
    const state = {
        profile: clone(cachedProfile),
        ready: profileReady,
        error: profileError
    };
    profileListeners.forEach(function(listener) {
        try {
            listener(state);
        } catch (error) {
            console.error("Un control de perfil no pudo actualizarse.", error);
        }
    });
}

function requireAuthenticatedUser() {
    if (!authReady) {
        const error = new Error("Firebase todavía está iniciando.");
        error.code = "firebase/not-ready";
        throw error;
    }

    if (!currentUser) {
        const error = new Error("Debes iniciar sesión para usar Mi lista.");
        error.code = "auth/required";
        throw error;
    }

    return currentUser;
}

function getContentKey(movie) {
    return `${movie?.media_type === "tv" ? "tv" : "movie"}:${movie?.id}`;
}

function comparableMovie(movie) {
    const { updatedAt, contentKey, ...publicFields } = movie || {};
    return publicFields;
}

function publicUser(user) {
    if (!user) return null;
    return Object.freeze({
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        providerIds: Array.from(new Set((user.providerData || []).map(function(provider) {
            return provider.providerId;
        }).filter(Boolean)))
    });
}

// Las listas de prueba del navegador no se migran a ninguna cuenta nueva.
try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch (error) {
    // Un bloqueo de localStorage no impide utilizar Firebase.
}

const authService = {
    getUser() {
        return publicUser(currentUser);
    },

    isReady() {
        return authReady;
    },

    getError() {
        return firebaseError;
    },

    subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("El suscriptor debe ser una función.");
        authListeners.add(listener);
        listener({ user: publicUser(currentUser), ready: authReady, error: firebaseError });
        return function unsubscribe() {
            authListeners.delete(listener);
        };
    },

    async signInWithGoogle() {
        if (!authService.firebase) throw firebaseError || new Error("Firebase no está disponible.");
        const { auth, GoogleAuthProvider, signInWithPopup } = authService.firebase;
        return signInWithPopup(auth, new GoogleAuthProvider());
    },

    async signInWithEmail(email, password) {
        if (!authService.firebase) throw firebaseError || new Error("Firebase no está disponible.");
        return authService.firebase.signInWithEmailAndPassword(authService.firebase.auth, email, password);
    },

    async registerWithEmail(email, password) {
        if (!authService.firebase) throw firebaseError || new Error("Firebase no está disponible.");
        return authService.firebase.createUserWithEmailAndPassword(authService.firebase.auth, email, password);
    },

    async signOut() {
        if (!authService.firebase) return;
        return authService.firebase.signOut(authService.firebase.auth);
    },

    firebase: null
};

const listStore = {
    getAll() {
        return clone(cachedMovies);
    },

    async replaceAll(movies) {
        if (!Array.isArray(movies)) throw new TypeError("Mi lista debe recibirse como una colección.");
        const user = requireAuthenticatedUser();
        const firebase = authService.firebase;
        if (!firebase) throw firebaseError || new Error("Firestore no está disponible.");

        const previousMovies = cachedMovies;
        const nextMovies = clone(movies);
        const previousMap = new Map(previousMovies.map(function(movie) {
            return [getContentKey(movie), comparableMovie(movie)];
        }));
        const previousKeys = new Set(previousMap.keys());
        const nextKeys = new Set();
        const operations = [];

        nextMovies.forEach(function(movie, position) {
            const contentKey = getContentKey(movie);
            const previousMovie = previousMap.get(contentKey);
            const publicMovie = {
                ...comparableMovie(movie),
                // Los títulos nuevos reciben un orden propio; así, modificar uno
                // no obliga a reescribir todos los demás documentos.
                maxicheck_list_order: Number(previousMovie?.maxicheck_list_order)
                    || (Date.now() - position)
            };
            nextKeys.add(contentKey);
            nextMovies[position] = publicMovie;
            if (previousMovie && JSON.stringify(previousMovie) === JSON.stringify(publicMovie)) return;
            operations.push({
                type: "set",
                reference: firebase.doc(firebase.db, "users", user.uid, "savedTitles", contentKey),
                data: {
                    ...publicMovie,
                    contentKey,
                    updatedAt: firebase.serverTimestamp()
                }
            });
        });

        previousKeys.forEach(function(contentKey) {
            if (nextKeys.has(contentKey)) return;
            operations.push({
                type: "delete",
                reference: firebase.doc(firebase.db, "users", user.uid, "savedTitles", contentKey)
            });
        });

        // La interfaz responde al instante; si Firestore rechaza la operación,
        // se restaura la última versión confirmada.
        cachedMovies = nextMovies;
        notifyList();

        try {
            for (let index = 0; index < operations.length; index += 450) {
                const batch = firebase.writeBatch(firebase.db);
                operations.slice(index, index + 450).forEach(function(operation) {
                    if (operation.type === "set") batch.set(operation.reference, operation.data);
                    else batch.delete(operation.reference);
                });
                await batch.commit();
            }
        } catch (error) {
            cachedMovies = previousMovies;
            notifyList();
            throw error;
        }
    },

    subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("El suscriptor debe ser una función.");
        listListeners.add(listener);
        listener(clone(cachedMovies));
        return function unsubscribe() {
            listListeners.delete(listener);
        };
    },

    async discardLegacyData() {
        try {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch (error) {
            // Los datos sincronizados de Firestore no dependen de localStorage.
        }
    }
};

const profileStore = {
    get() {
        return clone(cachedProfile);
    },

    isReady() {
        return profileReady;
    },

    subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("El suscriptor debe ser una función.");
        profileListeners.add(listener);
        listener({ profile: clone(cachedProfile), ready: profileReady, error: profileError });
        return function unsubscribe() {
            profileListeners.delete(listener);
        };
    },

    async save(changes) {
        const user = requireAuthenticatedUser();
        const firebase = authService.firebase;
        if (!firebase) throw firebaseError || new Error("Firestore no está disponible.");

        const previousProfile = cachedProfile;
        const nextProfile = normalizeProfile({ ...cachedProfile, ...changes });
        cachedProfile = nextProfile;
        profileReady = true;
        profileError = null;
        notifyProfile();

        try {
            // Solo se envían a Firestore los campos que esta llamada realmente
            // quiso cambiar (ya normalizados/validados). Escribir el perfil
            // completo aquí es lo que causaba que la fecha de nacimiento se
            // borrara: si el cache local (cachedProfile) todavía no se había
            // sincronizado con el documento real (por ejemplo, justo tras
            // iniciar sesión), cualquier guardado no relacionado —como
            // cambiar el nombre o el avatar— reenviaba un birthDate vacío y
            // sobrescribía el que el usuario ya tenía guardado.
            const changedFields = {};
            Object.keys(changes).forEach(function(key) {
                if (Object.prototype.hasOwnProperty.call(nextProfile, key)) {
                    changedFields[key] = nextProfile[key];
                }
            });

            await firebase.setDoc(
                firebase.doc(firebase.db, "users", user.uid),
                { ...changedFields, updatedAt: firebase.serverTimestamp() },
                { merge: true }
            );

            // Firestore es la fuente principal del perfil. El nombre de Auth se
            // actualiza después para que un fallo de reglas no deje dos estados.
            if (nextProfile.displayName && nextProfile.displayName !== user.displayName) {
                try {
                    await firebase.updateProfile(user, { displayName: nextProfile.displayName });
                    notifyAuth();
                } catch (error) {
                    console.warn("El perfil se guardó, pero Firebase Auth no actualizó el nombre.", error);
                }
            }
            return clone(nextProfile);
        } catch (error) {
            cachedProfile = previousProfile;
            profileError = error;
            notifyProfile();
            throw error;
        }
    }
};

// Se sella la interfaz para impedir propiedades accidentales, pero se conserva
// el espacio interno donde se conectan las funciones del SDK al terminar la carga.
window.MaxiCheckAuth = Object.seal(authService);
window.MaxiCheckListStore = Object.freeze(listStore);
window.MaxiCheckProfileStore = Object.freeze(profileStore);

try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    const firebaseApp = appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(firebaseApp);
    const db = firestoreModule.getFirestore(firebaseApp);

    authService.firebase = {
        auth,
        db,
        GoogleAuthProvider: authModule.GoogleAuthProvider,
        signInWithPopup: authModule.signInWithPopup,
        signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
        createUserWithEmailAndPassword: authModule.createUserWithEmailAndPassword,
        updateProfile: authModule.updateProfile,
        signOut: authModule.signOut,
        collection: firestoreModule.collection,
        doc: firestoreModule.doc,
        onSnapshot: firestoreModule.onSnapshot,
        setDoc: firestoreModule.setDoc,
        serverTimestamp: firestoreModule.serverTimestamp,
        writeBatch: firestoreModule.writeBatch
    };

    authModule.onAuthStateChanged(auth, function(user) {
        if (stopFirestoreListener) {
            stopFirestoreListener();
            stopFirestoreListener = null;
        }
        if (stopProfileListener) {
            stopProfileListener();
            stopProfileListener = null;
        }

        currentUser = user;
        authReady = true;
        firebaseError = null;
        cachedMovies = [];
        cachedProfile = { ...DEFAULT_PROFILE };
        profileReady = !user;
        profileError = null;
        notifyAuth();
        notifyList();
        notifyProfile();

        if (!user) return;

        const listReference = firestoreModule.collection(db, "users", user.uid, "savedTitles");
        stopFirestoreListener = firestoreModule.onSnapshot(
            listReference,
            function(snapshot) {
                cachedMovies = snapshot.docs
                    .map(function(documentSnapshot) {
                        return comparableMovie(documentSnapshot.data());
                    })
                    .sort(function(first, second) {
                        return (Number(second.maxicheck_list_order) || 0)
                            - (Number(first.maxicheck_list_order) || 0);
                    });
                notifyList();
            },
            function(error) {
                firebaseError = error;
                notifyAuth();
            }
        );

        const profileReference = firestoreModule.doc(db, "users", user.uid);
        stopProfileListener = firestoreModule.onSnapshot(
            profileReference,
            function(snapshot) {
                cachedProfile = normalizeProfile(snapshot.exists() ? snapshot.data() : {
                    ...DEFAULT_PROFILE,
                    displayName: user.displayName || ""
                });
                profileReady = true;
                profileError = null;
                notifyProfile();
            },
            function(error) {
                profileReady = true;
                profileError = error;
                notifyProfile();
            }
        );
    });
} catch (error) {
    firebaseError = error;
    authReady = true;
    profileError = error;
    profileReady = true;
    console.error("Firebase no pudo iniciarse; las búsquedas continúan disponibles.", error);
    notifyAuth();
    notifyProfile();
}

// app.js se carga después de publicar los servicios que utiliza.
await import("./app.js?v=20260820-24");
