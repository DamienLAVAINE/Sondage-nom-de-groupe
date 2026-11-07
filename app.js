import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs,
  onSnapshot, serverTimestamp, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Configuration Firebase du projet.
const firebaseConfig = {
  apiKey: "AIzaSyCEM5p5cysZsALaZy9EwCLuHXtG12Pkyg0M",
  authDomain: "lled-vote.firebaseapp.com",
  projectId: "lled-vote",
  storageBucket: "lled-vote.firebasestorage.app",
  messagingSenderId: "819365129476",
  appId: "1:819365129476:web:2662e25800bc4bb2903451",
  measurementId: "G-N336X6D2LP"
};

const COLLECTION_NAME = "bandNames";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
let currentUser = null;
let bandNames = [];
const ratingsByName = new Map();
const ratingUnsubscribe = new Map();
let namesUnsubscribe = null;

const nicknameInput = $("nickname");
nicknameInput.value = localStorage.getItem("bandNameNickname") || "";

nicknameInput.addEventListener("change", () => {
  const value = nicknameInput.value.trim().slice(0, 40);
  nicknameInput.value = value;
  localStorage.setItem("bandNameNickname", value);
  renderNames();
});

function nickname() {
  return nicknameInput.value.trim().slice(0, 40) || "Membre";
}

function showMessage(message, type = "") {
  const element = $("message");
  element.textContent = message;
  element.className = type;
}

// Comète, COMETE et " comète " donnent la même clé.
function nameKey(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function ratingInfo(nameId) {
  const ratings = [...(ratingsByName.get(nameId)?.values() || [])];

  const average = ratings.length
    ? ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length
    : null;

  const mine = currentUser
    ? ratings.find(item => item.uid === currentUser.uid)?.rating ?? null
    : null;

  return { average, count: ratings.length, mine };
}

function starButtons(nameId, mine) {
  const wrap = document.createElement("div");
  wrap.className = "stars";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Noter ce nom de 1 à 5 étoiles");

  for (let number = 1; number <= 5; number++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star" + (mine !== null && number <= mine ? " my-rating" : "");
    button.textContent = number <= (mine || 0) ? "★" : "☆";
    button.setAttribute("aria-label", `${number} sur 5`);
    button.title = `Attribuer ${number}/5`;
    button.addEventListener("click", () => saveRating(nameId, number));
    wrap.appendChild(button);
  }

  return wrap;
}

function formatAverage(average) {
  return average.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function renderRanking() {
  const root = $("rankingList");
  root.replaceChildren();

  const ranked = bandNames.map(item => ({
    item,
    ...ratingInfo(item.id)
  })).sort((a, b) => {
    if (a.average === null && b.average !== null) return 1;
    if (b.average === null && a.average !== null) return -1;

    return (b.average ?? 0) - (a.average ?? 0)
      || b.count - a.count
      || a.item.name.localeCompare(b.item.name, "fr");
  });

  if (!ranked.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Le classement apparaîtra dès qu'un nom sera proposé.";
    root.appendChild(empty);
    return;
  }

  ranked.forEach(({ item, average, count }, index) => {
    const row = document.createElement("div");
    row.className = "ranking-item";

    const heading = document.createElement("div");
    heading.className = "ranking-heading";

    const title = document.createElement("div");
    title.className = "ranking-title";
    title.textContent = `${index + 1}. ${item.name}`;

    const meta = document.createElement("div");
    meta.className = "ranking-meta";
    meta.textContent = average === null
      ? "Pas encore noté · 0 vote"
      : `${formatAverage(average)}/5 · ${count} ${count > 1 ? "votes" : "vote"}`;

    heading.append(title, meta);

    const track = document.createElement("div");
    track.className = "ranking-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `Moyenne de ${item.name}`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "5");
    track.setAttribute("aria-valuenow", String(average ?? 0));

    const bar = document.createElement("div");
    bar.className = "ranking-bar";
    bar.style.width = `${average === null ? 0 : (average / 5) * 100}%`;

    track.appendChild(bar);

    const subtitle = document.createElement("div");
    subtitle.className = "ranking-subtitle";
    subtitle.textContent = average === null
      ? "En attente des premières notes"
      : `${"★".repeat(Math.round(average))}${"☆".repeat(5 - Math.round(average))} · ${count} note(s) prise(s) en compte`;

    row.append(heading, track, subtitle);
    root.appendChild(row);
  });
}

function renderNames() {
  renderRanking();

  const root = $("nameList");
  root.replaceChildren();

  const sort = $("sortBy").value;
  const visible = [...bandNames];

  visible.sort((a, b) => {
    if (sort === "rating") {
      const ar = ratingInfo(a.id);
      const br = ratingInfo(b.id);

      if (ar.average === null && br.average !== null) return 1;
      if (br.average === null && ar.average !== null) return -1;

      return (br.average ?? 0) - (ar.average ?? 0)
        || br.count - ar.count
        || a.name.localeCompare(b.name, "fr");
    }

    if (sort === "count") {
      return ratingInfo(b.id).count - ratingInfo(a.id).count
        || a.name.localeCompare(b.name, "fr");
    }

    if (sort === "name") {
      return a.name.localeCompare(b.name, "fr");
    }

    return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
  });

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Aucun nom pour le moment. Soyez les premiers à proposer une idée !";
    root.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const info = ratingInfo(item.id);

    const card = document.createElement("article");
    card.className = "name-card";

    const top = document.createElement("div");
    top.className = "name-top";

    const titleBlock = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = item.name;

    const proposer = document.createElement("div");
    proposer.className = "proposer";
    proposer.textContent = `Proposé par ${item.proposedBy || "un membre"}`;

    titleBlock.append(title, proposer);
    top.appendChild(titleBlock);
    card.appendChild(top);

    const ratingArea = document.createElement("div");
    ratingArea.className = "rating-area";

    const summary = document.createElement("div");
    summary.className = "rating-summary";

    const average = document.createElement("span");
    average.className = "average";
    average.textContent = info.average === null
      ? "Pas encore noté"
      : `${formatAverage(info.average)}/5`;

    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = `(${info.count} ${info.count > 1 ? "votes" : "vote"})`;

    summary.append(average, count);

    if (info.average !== null) {
      const averageStars = document.createElement("span");
      averageStars.className = "muted";
      averageStars.textContent = "★".repeat(Math.round(info.average))
        + "☆".repeat(5 - Math.round(info.average));

      summary.appendChild(averageStars);
    }

    const prompt = document.createElement("div");
    prompt.className = "hint";
    prompt.style.marginTop = "10px";
    prompt.textContent = "Ta note :";

    ratingArea.append(summary, prompt, starButtons(item.id, info.mine));

    if (info.mine !== null) {
      const mine = document.createElement("div");
      mine.className = "my-note";
      mine.textContent = `Tu as attribué ${info.mine}/5. Clique sur une autre étoile pour modifier ta note.`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.style.marginTop = "8px";
      remove.textContent = "Retirer ma note";
      remove.addEventListener("click", () => removeRating(item.id));

      ratingArea.append(mine, remove);
    } else {
      const help = document.createElement("div");
      help.className = "my-note";
      help.textContent = "Clique sur une étoile pour noter ce nom.";

      ratingArea.appendChild(help);
    }

    card.appendChild(ratingArea);

    if (currentUser && item.proposerUid === currentUser.uid) {
      const actions = document.createElement("div");
      actions.className = "name-actions";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Supprimer ma proposition";
      del.addEventListener("click", () => deleteName(item));

      actions.appendChild(del);
      card.appendChild(actions);
    }

    root.appendChild(card);
  }
}

async function saveRating(nameId, rating) {
  if (!currentUser) {
    showMessage("Connexion en cours, réessaie dans un instant.");
    return;
  }

  try {
    const ratingRef = doc(db, COLLECTION_NAME, nameId, "ratings", currentUser.uid);

    await setDoc(ratingRef, {
      uid: currentUser.uid,
      nickname: nickname(),
      rating,
      updatedAt: serverTimestamp()
    });

    showMessage(`Ta note de ${rating}/5 a été enregistrée.`, "success");
  } catch (error) {
    console.error(error);
    showMessage("Impossible d'enregistrer la note. Vérifie la connexion et les règles Firestore.", "error");
  }
}

async function removeRating(nameId) {
  if (!currentUser) return;

  try {
    await deleteDoc(doc(db, COLLECTION_NAME, nameId, "ratings", currentUser.uid));
    showMessage("Ta note a été retirée.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Impossible de retirer ta note.", "error");
  }
}

async function deleteName(item) {
  if (!confirm(`Supprimer la proposition « ${item.name} » et toutes ses notes ?`)) return;

  try {
    const ratingsSnapshot = await getDocs(
      collection(db, COLLECTION_NAME, item.id, "ratings")
    );

    const batch = writeBatch(db);

    ratingsSnapshot.docs.forEach(ratingDoc => {
      batch.delete(ratingDoc.ref);
    });

    batch.delete(doc(db, COLLECTION_NAME, item.id));

    await batch.commit();

    showMessage("Proposition et notes supprimées.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Suppression impossible. Vérifie les règles Firestore.", "error");
  }
}

$("nameForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Connexion en cours, réessaie dans un instant.");
    return;
  }

  const input = $("name");
  const name = input.value.trim().replace(/\s+/g, " ");
  const key = nameKey(name);

  if (name.length < 2 || !key) {
    showMessage("Saisis un nom de groupe valide (au moins 2 caractères).", "error");
    return;
  }

  const submit = $("nameForm").querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    const nameRef = doc(db, COLLECTION_NAME, key);

    await runTransaction(db, async transaction => {
      const existing = await transaction.get(nameRef);

      if (existing.exists()) {
        throw new Error("DUPLICATE_NAME");
      }

      transaction.set(nameRef, {
        name,
        proposedBy: nickname(),
        proposerUid: currentUser.uid,
        createdAt: serverTimestamp()
      });
    });

    $("nameForm").reset();
    showMessage(`« ${name} » a été ajouté à la liste !`, "success");
  } catch (error) {
    if (error.message === "DUPLICATE_NAME") {
      showMessage(
        "Ce nom (ou une variante avec accents/majuscules/espaces) est déjà proposé.",
        "error"
      );
    } else {
      console.error(error);
      showMessage("Impossible d'ajouter ce nom. Vérifie la connexion et les règles Firebase.", "error");
    }
  } finally {
    submit.disabled = false;
  }
});

$("sortBy").addEventListener("change", renderNames);

function watchRatings(nameId) {
  if (ratingUnsubscribe.has(nameId)) return;

  const unsubscribe = onSnapshot(
    collection(db, COLLECTION_NAME, nameId, "ratings"),
    snapshot => {
      const map = new Map();

      snapshot.forEach(ratingDoc => {
        const data = ratingDoc.data();

        if (
          Number.isInteger(data.rating) &&
          data.rating >= 1 &&
          data.rating <= 5
        ) {
          map.set(ratingDoc.id, data);
        }
      });

      ratingsByName.set(nameId, map);
      renderNames();
    },
    error => {
      console.error(error);
      showMessage("Erreur de lecture des notes. Vérifie les règles Firestore.", "error");
    }
  );

  ratingUnsubscribe.set(nameId, unsubscribe);
}

function watchNames() {
  if (namesUnsubscribe) namesUnsubscribe();

  namesUnsubscribe = onSnapshot(
    collection(db, COLLECTION_NAME),
    snapshot => {
      bandNames = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      const currentIds = new Set(bandNames.map(item => item.id));

      for (const [id, unsubscribe] of ratingUnsubscribe.entries()) {
        if (!currentIds.has(id)) {
          unsubscribe();
          ratingUnsubscribe.delete(id);
          ratingsByName.delete(id);
        }
      }

      for (const item of bandNames) {
        watchRatings(item.id);
      }

      renderNames();
      showMessage(`${bandNames.length} nom(s) proposé(s).`, "success");
    },
    error => {
      console.error(error);
      showMessage("Impossible de charger les propositions. Vérifie Firebase et les règles Firestore.", "error");
    }
  );
}

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (user) {
    watchNames();
  } else {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error(error);
      showMessage(
        "Connexion Firebase impossible. Vérifie que l'authentification anonyme est activée.",
        "error"
      );
    }
  }
});
