import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL)
  && SUPABASE_ANON_KEY.length > 30
  && !SUPABASE_ANON_KEY.includes("TU_CLAVE");
const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
const serviceList = $("#service-list");
const searchForm = $("#search-form");
const resultsSummary = $("#results-summary");
const directoryNotice = $("#directory-notice");
const authDialog = $("#auth-dialog");
const profileDialog = $("#profile-dialog");
const profileForm = $("#profile-form");
const categoryCache = new Map();
let searchTimer;
let currentUser = null;
let currentProfile = null;
let authStateVersion = 0;
let profileRequestVersion = 0;
let authSubscription = null;
let resolveAuthStateReady;
const authStateReady = new Promise((resolve) => {
  resolveAuthStateReady = resolve;
});
let editingProfile = null;
let reportingProfileId = null;
let categoriesLoadFailed = false;

const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function profilePhotoUrl(profileId) {
  if (!isConfigured || !profileId) return "";
  const url = new URL("/functions/v1/profile-photo", SUPABASE_URL);
  url.searchParams.set("profile_id", profileId);
  return url.href;
}

function showNotice(message, type = "info") {
  directoryNotice.textContent = message;
  directoryNotice.className = `notice notice-${type}`;
  directoryNotice.hidden = false;
}

function updateAuthNavigation() {
  const signedIn = Boolean(currentUser);
  const isAdmin = currentUser?.app_metadata?.role === "admin";
  $("[data-open-auth]").hidden = signedIn;
  $("#nav-admin").hidden = !isAdmin;
  $("#nav-sign-out").hidden = !signedIn;
  document.querySelectorAll("[data-open-profile]").forEach((button) => {
    button.hidden = isAdmin || (signedIn && currentProfile !== null);
  });
  if (isAdmin) {
    $("#community-banner-title").textContent = "Cuenta administrativa.";
    $("#community-cta-message").textContent = "Las cuentas administrativas no pueden publicar ni editar perfiles de servicio.";
    return;
  }
  $("#community-banner-title").textContent = !currentProfile
    ? "¿Tienes un servicio que compartir?"
    : currentProfile.status === "approved"
    ? "Tu servicio ya está en el directorio."
    : currentProfile.status === "rejected"
    ? "Consulta el estado de tu perfil."
    : "Ya recibimos tu solicitud.";
  $("#community-cta-message").textContent = !currentProfile
    ? "Haz que más personas te encuentren. Publica tu perfil gratis y conecta con tu comunidad."
    : currentProfile.status === "approved"
    ? "Puedes revisar o editar tu servicio desde Cuenta."
    : currentProfile.status === "rejected"
    ? "Tu perfil fue rechazado. Consulta los detalles desde Cuenta."
    : "Ya enviaste tu perfil. Consulta el estado o edítalo desde Cuenta.";
}

function clearAuthScopedUi() {
  for (const selector of ["#profile-dialog", "#admin-dialog", "#report-dialog"]) {
    const dialog = $(selector);
    if (dialog.open) dialog.close();
  }
  profileForm.reset();
  setProfileConsentsVisible(false);
  updateOtherLocalityVisibility();
  updatePhoneGroupRequired("phone");
  updatePhoneGroupRequired("whatsapp");
  setProfileFormDisabled(false);
  editingProfile = null;
  $("#profile-title").textContent = "Publica tu servicio.";
  $("#profile-message").textContent = "";
  profileForm.querySelector('[type="submit"]').textContent = profileSubmitLabel();
  $("#admin-content").textContent = "";
  $("#report-form").reset();
  $("#report-message").textContent = "";
  reportingProfileId = null;
}

function showAccountStatus({
  state,
  message = "",
  badge = "",
  description = "",
  type = "info",
  actionLabel = "",
} = {}) {
  const status = $("#account-status");
  const action = $("#account-status-action");
  status.className = `account-status notice notice-${type}`;
  $("#account-state").textContent = state;
  $("#account-status-message").textContent = message;
  $("#account-status-badge").textContent = badge;
  $("#account-status-badge").hidden = !badge;
  $("#account-status-description").textContent = description;
  $("#account-status-description").hidden = !description;
  status.hidden = false;
  action.hidden = !actionLabel;
  action.textContent = actionLabel;
}

function renderAccountStatus(profile) {
  currentProfile = profile;
  updateAuthNavigation();
  if (!currentUser) {
    showAccountStatus({
      state: "Sin sesión",
      message: "Inicia sesión con Google para consultar tu perfil.",
      actionLabel: "Iniciar sesión con Google",
    });
    return;
  }
  if (currentUser.app_metadata?.role === "admin") {
    showAccountStatus({
      state: "Cuenta administrativa",
      message: "Esta cuenta no puede publicar ni editar perfiles de servicio.",
      description: "Los perfiles enviados antes de asignar el rol se conservan y deben revisarse desde otra cuenta administrativa.",
    });
    return;
  }
  if (profile === undefined) {
    showAccountStatus({
      state: "Sesión activa",
      message: "Cargando el estado de tu perfil…",
    });
    return;
  }
  if (!profile) {
    showAccountStatus({
      state: "Sesión activa",
      message: "Aún no has completado tu registro.",
      actionLabel: "Completar registro",
    });
    return;
  }
  if (profile.status === "pending") {
    showAccountStatus({
      state: "Sesión activa",
      message: "Tu perfil está pendiente de revisión",
      badge: "Pending",
      description: "Tu solicitud fue recibida. Podrás aparecer en el directorio cuando sea aprobada.",
      actionLabel: "Editar mi servicio",
    });
    return;
  }
  if (profile.status === "approved") {
    showAccountStatus({
      state: "Sesión activa",
      message: "Tu perfil ha sido aprobado",
      badge: "Approved",
      actionLabel: "Editar mi servicio",
    });
    return;
  }
  if (profile.status === "rejected") {
    showAccountStatus({
      state: "Sesión activa",
      message: "Tu perfil fue rechazado.",
      badge: "Rejected",
      description: "Revisa tus datos y las indicaciones para corregirlo.",
    });
    return;
  }
  showAccountStatus({
    state: "Sesión activa",
    message: "No se pudo determinar el estado de tu perfil.",
    type: "error",
  });
}

function openAccountAction() {
  if (currentUser) {
    openProfile();
  } else {
    showAuth();
  }
}

async function refreshOwnProfile(userId, expectedAuthVersion = authStateVersion) {
  const requestVersion = ++profileRequestVersion;
  if (currentUser?.id === userId) renderAccountStatus(undefined);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (
      expectedAuthVersion !== authStateVersion ||
      requestVersion !== profileRequestVersion ||
      currentUser?.id !== userId
    ) {
      return { profile: null, error: null, stale: true };
    }
    renderAccountStatus(data);
    return { profile: data, error: null, stale: false };
  } catch (error) {
    if (
      expectedAuthVersion === authStateVersion &&
      requestVersion === profileRequestVersion &&
      currentUser?.id === userId
    ) {
      showAccountStatus("No se pudo consultar el estado de tu perfil. Intenta actualizar la página.", {
        type: "error",
      });
    }
    return { profile: null, error, stale: false };
  }
}

function showServiceDetails(id) {
  const service = window.servicesById?.get(id);
  if (!service) return;
  const category = categoryCache.get(service.category_id) || "Servicio local";
  const serviceName = escapeHTML(service.name);
  const phone = service.phone?.replace(/[^\d+]/g, "");
  const contactLinks = [
    service.show_phone && phone ? `<a class="button button-dark" href="tel:${escapeHTML(phone)}">Llamar ↗</a>` : "",
    service.show_whatsapp && service.whatsapp ? `<a class="button button-dark" href="https://wa.me/${escapeHTML(service.whatsapp.replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>` : "",
    service.website && /^https?:\/\//i.test(service.website) ? `<a class="button button-light" href="${escapeHTML(service.website)}" target="_blank" rel="noopener noreferrer">Visitar sitio ↗</a>` : "",
  ].filter(Boolean).join("");
  const photoUrl = service.photo_path ? profilePhotoUrl(service.id) : "";
  const image = photoUrl
    ? `<img class="detail-image" src="${escapeHTML(photoUrl)}" alt="Fotografía de ${serviceName}">`
    : `<div class="detail-image detail-placeholder" aria-hidden="true">${escapeHTML((service.name || "S").charAt(0).toUpperCase())}</div>`;
  $("#service-detail-content").innerHTML = `<div class="service-detail-layout">
    <main class="service-detail-main">
      <div class="detail-visual">${image}</div>
      <div class="detail-copy">
        <p class="eyebrow">${escapeHTML(category)}</p>
        <p class="detail-location"><span aria-hidden="true">⌖</span> ${escapeHTML(service.locality)}</p>
        <h2 id="service-detail-title">${serviceName}</h2>
        <h3 class="detail-section-title">Sobre este servicio</h3>
        <p class="detail-description">${escapeHTML(service.description)}</p>
      </div>
    </main>
    <aside class="service-detail-aside" aria-labelledby="detail-contact-title">
      <div class="detail-contact-card">
        <p class="eyebrow">CONTACTO</p>
        <h3 id="detail-contact-title">Conecta directamente</h3>
        <p class="detail-contact-intro">Comunícate con este servicio por los medios disponibles.</p>
        <div class="detail-actions">${contactLinks || '<p class="detail-no-contact">Este perfil no tiene datos de contacto públicos.</p>'}</div>
        <div class="detail-report">
          <span>¿Notaste algo que debamos revisar?</span>
          <button class="text-button" type="button" data-report-profile="${escapeHTML(service.id)}">Reportar perfil</button>
        </div>
      </div>
    </aside>
  </div>`;
  openDialog($("#service-dialog"));
}

function friendlyError(error, fallback) {
  const code = error?.code;
  if (code === "23505") return "Ya existe un perfil con esos datos.";
  if (code === "42501" || code === "PGRST301") return "No tienes permiso para realizar esta acción. Inicia sesión e inténtalo de nuevo.";
  if (code === "23503") return "La categoría seleccionada ya no está disponible. Actualiza la página e inténtalo de nuevo.";
  if (error?.name === "AbortError") return "La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.";
  return fallback;
}

async function submitReport(event) {
  event.preventDefault();
  const message = $("#report-message");
  if (!$("#report-form").reportValidity()) return;
  if (!await requireAuth()) return;
  const button = $("#report-form").querySelector('[type="submit"]');
  setBusy(button, true, "Enviando…");
  try {
    const { error } = await supabase.from("reports").insert({
      profile_id: reportingProfileId,
      reporter_id: currentUser.id,
      reason: $("#report-reason").value.trim(),
    });
    if (error) throw error;
    message.textContent = "Gracias. El equipo revisará tu reporte.";
    $("#report-form").reset();
    window.setTimeout(() => $("#report-dialog").close(), 1600);
  } catch (error) {
    message.textContent = friendlyError(error, "No se pudo enviar el reporte. Inténtalo de nuevo.");
  } finally {
    setBusy(button, false, "Enviar reporte ↗");
  }
}

function setBusy(element, busy, label) {
  element.disabled = busy;
  if (label) element.textContent = label;
}

function renderCards(services) {
  if (!services.length) {
    serviceList.innerHTML = '<div class="empty-state"><span aria-hidden="true">✳</span><h3>Aún no encontramos ese servicio.</h3><p>Prueba con otra búsqueda o localidad. ¡Quizá tu próximo favorito está por llegar!</p></div>';
    return;
  }
  serviceList.innerHTML = services.map((service) => {
    const category = categoryCache.get(service.category_id) || "Servicio local";
    const initial = escapeHTML((service.name || "S").trim().charAt(0).toUpperCase());
    const photoUrl = service.photo_path ? profilePhotoUrl(service.id) : "";
    const image = photoUrl
      ? `<img src="${escapeHTML(photoUrl)}" alt="" loading="lazy">`
      : `<span class="service-initial" aria-hidden="true">${initial}</span>`;
    return `<article class="service-card">
      <div class="card-image">${image}<span class="card-category">${escapeHTML(category)}</span></div>
      <div class="card-content"><p class="card-location"><span aria-hidden="true">⌖</span> ${escapeHTML(service.locality)}</p>
        <h3>${escapeHTML(service.name)}</h3><p class="card-description">${escapeHTML(service.description)}</p>
        <div class="card-footer"><span class="card-category-text">${escapeHTML(category)}</span><button class="card-contact" type="button" data-view-service="${escapeHTML(service.id)}" aria-haspopup="dialog">Ver perfil ↗</button></div>
      </div>
    </article>`;
  }).join("");
}

function sortServices(services) {
  return services.sort((a, b) => $("#sort-order").value === "name"
    ? a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    : new Date(b.created_at) - new Date(a.created_at));
}

async function loadCategories() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("categories").select("id,name").eq("active", true).order("name");
    if (error) throw error;
    const selects = [$("#search-category"), $("#profile-category")];
    for (const category of data || []) {
      categoryCache.set(category.id, category.name);
      for (const select of selects) {
        const option = document.createElement("option");
        option.value = category.id;
        option.textContent = category.name;
        select.append(option);
      }
    }
  } catch {
    categoriesLoadFailed = true;
    showNotice("No fue posible cargar las categorías. Intenta actualizar la página.", "error");
  }
}

async function loadServices() {
  if (!supabase) {
    serviceList.setAttribute("aria-busy", "false");
    resultsSummary.textContent = "Directorio listo para configurarse";
    renderCards([]);
    showNotice("Conecta un proyecto de Supabase para cargar el directorio. Consulta README.md para configurarlo.", "info");
    return;
  }
  serviceList.setAttribute("aria-busy", "true");
  const query = $("#search-query").value.trim();
  const locality = $("#search-locality").value.trim();
  const category = $("#search-category").value;
  try {
    let request = supabase.from("public_services").select("id,name,category_id,locality,description,phone,whatsapp,show_phone,show_whatsapp,website,photo_path,created_at");
    if (query) {
      const safeQuery = query.replace(/[,%()"'\\]/g, " ");
      request = request.or(`name.ilike.%${safeQuery}%,description.ilike.%${safeQuery}%`);
    }
    if (locality) request = request.ilike("locality", `%${locality.replace(/[,%()"'\\]/g, " ")}%`);
    if (category) request = request.eq("category_id", category);
    const { data, error } = await request.limit(100);
    if (error) throw error;
    const services = sortServices(data || []);
    window.servicesById = new Map(services.map((service) => [service.id, service]));
    resultsSummary.textContent = services.length === 1
      ? "1 servicio local encontrado"
      : `${services.length} servicios locales encontrados${services.length === 100 ? " · mostrando los primeros 100" : ""}`;
    if (!categoriesLoadFailed) directoryNotice.hidden = true;
    renderCards(services);
  } catch (error) {
    resultsSummary.textContent = "No se pudieron cargar los servicios";
    renderCards([]);
    showNotice(friendlyError(error, "No fue posible cargar los servicios. Intenta de nuevo en unos minutos."), "error");
  } finally {
    serviceList.setAttribute("aria-busy", "false");
  }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  const close = dialog.querySelector(".dialog-close");
  close?.focus();
}

function showAuth(message = "") {
  $("#auth-message").textContent = message;
  openDialog(authDialog);
}

async function requireAuth() {
  if (!supabase) {
    showAuth("El acceso estará disponible cuando se configure Supabase.");
    return false;
  }
  await authStateReady;
  if (!currentUser) {
    showAuth("Inicia sesión para publicar o administrar un servicio.");
    return false;
  }
  return true;
}

function setProfileFormDisabled(disabled) {
  profileForm.querySelectorAll("input, select, textarea, button[type='submit']")
    .forEach((field) => {
      field.disabled = disabled;
    });
}

function setProfileConsentsVisible(visible) {
  $("#profile-consents").hidden = !visible;
  $("#profile-adult").required = visible;
  $("#profile-consent").required = visible;
}

function updateOtherLocalityVisibility() {
  const isOther = $("#profile-locality").value === "other";
  const otherLocality = $("#profile-locality-other");
  otherLocality.hidden = !isOther;
  otherLocality.required = isOther;
}

function updatePhoneGroupRequired(name) {
  const lada = $(`#profile-${name}-lada`);
  const number = $(`#profile-${name}`);
  const hasValue = Boolean(lada.value || number.value);
  lada.required = hasValue;
  number.required = hasValue;
}

function keepDigits(input, maxLength) {
  input.value = input.value.replace(/\D/g, "").slice(0, maxLength);
}

function populatePhoneFields(name, value) {
  const digits = String(value || "").replace(/\D/g, "");
  const nationalNumber = digits.startsWith("52") && [14, 15].includes(digits.length)
    ? digits.slice(2)
    : digits;
  const hasLada = nationalNumber.length === 12 || nationalNumber.length === 13;
  $(`#profile-${name}-lada`).value = hasLada ? nationalNumber.slice(0, -10) : "";
  $(`#profile-${name}`).value = nationalNumber.slice(-10);
  updatePhoneGroupRequired(name);
}

function phoneValue(name) {
  const lada = $(`#profile-${name}-lada`).value;
  const number = $(`#profile-${name}`).value;
  return number ? `+52 ${lada} ${number}` : null;
}

function populateProfileForm(profile) {
  for (const field of ["name", "category_id", "description", "website"]) {
    const input = profileForm.elements.namedItem(field);
    if (input) input.value = profile[field] || "";
  }
  const locality = $("#profile-locality");
  if ([...locality.options].some((option) => option.value === profile.locality)) {
    locality.value = profile.locality;
  } else {
    locality.value = "other";
    $("#profile-locality-other").value = profile.locality || "";
  }
  updateOtherLocalityVisibility();
  populatePhoneFields("phone", profile.phone);
  populatePhoneFields("whatsapp", profile.whatsapp);
  $("#profile-show-phone").checked = Boolean(profile.show_phone);
  $("#profile-show-whatsapp").checked = Boolean(profile.show_whatsapp);
}

function profileSubmitLabel() {
  return editingProfile ? "Guardar cambios ↗" : "Enviar para revisión ↗";
}

async function openProfile() {
  if (!await requireAuth()) return;
  if (!currentUser) return;
  if (currentUser.app_metadata?.role === "admin") return;
  const userId = currentUser.id;
  const expectedAuthVersion = authStateVersion;
  editingProfile = null;
  setProfileFormDisabled(false);
  profileForm.reset();
  setProfileConsentsVisible(false);
  updateOtherLocalityVisibility();
  updatePhoneGroupRequired("phone");
  updatePhoneGroupRequired("whatsapp");
  $("#profile-title").textContent = "Publica tu servicio.";
  profileForm.querySelector('[type="submit"]').textContent = profileSubmitLabel();
  $("#profile-message").textContent = "Cargando tu perfil…";
  openDialog(profileDialog);
  const { profile, error, stale } = await refreshOwnProfile(userId);
  if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) {
    return;
  }
  if (stale) {
    $("#profile-message").textContent = "El estado de tu perfil se está actualizando. Vuelve a abrir Cuenta.";
    return;
  }
  if (error) {
    $("#profile-message").textContent = friendlyError(error, "No se pudo cargar tu perfil. Comprueba tu conexión e inténtalo de nuevo.");
    return;
  }
  if (profile) {
    editingProfile = profile;
    $("#profile-title").textContent = "Edita tu servicio.";
    profileForm.querySelector('[type="submit"]').textContent = profileSubmitLabel();
    populateProfileForm(profile);
    setProfileConsentsVisible(false);
    if (profile.status === "rejected") {
      setProfileFormDisabled(true);
      $("#profile-message").textContent = "Este perfil rechazado no se puede corregir desde esta interfaz.";
    }
  } else {
    setProfileConsentsVisible(true);
    $("#profile-message").textContent = "";
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const message = $("#profile-message");
  message.textContent = "";
  if (currentUser?.app_metadata?.role === "admin") {
    message.textContent = "Las cuentas administrativas no pueden publicar ni editar perfiles de servicio.";
    return;
  }
  if (editingProfile?.status === "rejected") {
    message.textContent = "Este perfil rechazado no se puede corregir desde esta interfaz.";
    return;
  }
  if (!profileForm.reportValidity()) return;
  const photo = $("#profile-photo").files[0];
  if (photo) {
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(photo.type) || photo.size > 3 * 1024 * 1024) {
      message.textContent = "La imagen debe ser JPEG, PNG o WebP y pesar máximo 3 MB.";
      return;
    }
  }
  if (!await requireAuth()) return;
  if (!currentUser) return;
  if (currentUser.app_metadata?.role === "admin") {
    message.textContent = "Las cuentas administrativas no pueden publicar ni editar perfiles de servicio.";
    return;
  }
  const expectedAuthVersion = authStateVersion;
  const submitButton = profileForm.querySelector('[type="submit"]');
  setBusy(submitButton, true, "Guardando…");
  const userId = currentUser.id;
  try {
    let photoPath = editingProfile?.photo_path || null;
    if (photo) {
      const ext = photo.type === "image/jpeg" ? "jpg" : photo.type.split("/")[1];
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("service-photos").upload(path, photo, { contentType: photo.type, upsert: false });
      if (uploadError) throw uploadError;
      if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) return;
      photoPath = path;
    }
    const payload = {
      id: userId,
      name: $("#profile-name").value.trim(),
      category_id: $("#profile-category").value,
      locality: ($("#profile-locality").value === "other"
        ? $("#profile-locality-other").value
        : $("#profile-locality").value).trim(),
      description: $("#profile-description").value.trim(),
      phone: phoneValue("phone"),
      whatsapp: phoneValue("whatsapp"),
      show_phone: $("#profile-show-phone").checked,
      show_whatsapp: $("#profile-show-whatsapp").checked,
      website: $("#profile-website").value.trim() || null,
      photo_path: photoPath,
      updated_at: new Date().toISOString(),
    };
    if (!editingProfile) payload.status = "pending";
    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;
    if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) return;
    const { profile, error: refreshError, stale } = await refreshOwnProfile(userId);
    if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) return;
    if (refreshError) {
      message.textContent = "Guardamos tu perfil, pero no pudimos actualizar el estado. Intenta actualizar la página.";
      return;
    }
    if (stale) {
      message.textContent = "Guardamos tu perfil, pero su estado se está actualizando. Vuelve a consultar Cuenta.";
      return;
    }
    if (!profile) {
      message.textContent = "Guardamos tu perfil, pero no pudimos encontrar el registro para mostrar su estado.";
      return;
    }
    editingProfile = profile;
    setProfileConsentsVisible(false);
    populateProfileForm(profile);
    message.textContent = "Tu perfil se guardó correctamente.";
    window.setTimeout(() => {
      if (profileDialog.open) profileDialog.close();
    }, 2200);
  } catch (error) {
    if (currentUser?.id === userId && expectedAuthVersion === authStateVersion) {
      message.textContent = friendlyError(error, "No se pudo guardar el perfil. Revisa tu conexión e inténtalo de nuevo.");
    }
  } finally {
    if (currentUser?.id === userId && expectedAuthVersion === authStateVersion) {
      setBusy(submitButton, false, profileSubmitLabel());
    }
  }
}

async function signInWithGoogle() {
  if (!supabase) {
    $("#auth-message").textContent = "Configura primero la URL y la clave pública de Supabase.";
    return;
  }
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) $("#auth-message").textContent = friendlyError(error, "No se pudo iniciar sesión. Inténtalo de nuevo.");
  } catch {
    $("#auth-message").textContent = "No se pudo iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.";
  }
}

async function signOut() {
  const button = $("#nav-sign-out");
  setBusy(button, true, "Cerrando sesión…");
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    showNotice(friendlyError(error, "No se pudo cerrar la sesión. Inténtalo de nuevo."), "error");
  } finally {
    setBusy(button, false, "Cerrar sesión");
  }
}

function initializeAuth() {
  if (!supabase) {
    updateAuthNavigation();
    renderAccountStatus(null);
    resolveAuthStateReady();
    return;
  }
  if (authSubscription) return;

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const previousUserId = currentUser?.id;
    currentUser = session?.user || null;
    updateAuthNavigation();
    resolveAuthStateReady();

    if (!currentUser) {
      if (previousUserId) clearAuthScopedUi();
      authStateVersion += 1;
      profileRequestVersion += 1;
      renderAccountStatus(null);
      return;
    }

    if (previousUserId && previousUserId !== currentUser.id) {
      clearAuthScopedUi();
    }
    const refreshProfile = previousUserId !== currentUser.id
      || ["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED"].includes(event);
    if (!refreshProfile) return;

    authStateVersion += 1;
    const userId = currentUser.id;
    const expectedAuthVersion = authStateVersion;
    renderAccountStatus(undefined);
    queueMicrotask(() => {
      void refreshOwnProfile(userId, expectedAuthVersion);
    });
  });
  authSubscription = subscription;
}

async function openAdmin() {
  const content = $("#admin-content");
  if (!supabase || !await requireAuth()) return;
  if (!currentUser) return;
  const userId = currentUser.id;
  const expectedAuthVersion = authStateVersion;
  if (currentUser.app_metadata?.role !== "admin") {
    showAuth("No tienes permisos para acceder al panel de administración.");
    return;
  }
  openDialog($("#admin-dialog"));
  content.textContent = "Cargando perfiles pendientes…";
  try {
    const { data, error } = await supabase.from("profiles").select("id,name,category_id,locality,description").eq("status", "pending").neq("id", currentUser.id).order("created_at");
    if (error) throw error;
    if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) return;
    if (!data?.length) {
      content.textContent = "No hay perfiles pendientes.";
      return;
    }
    content.innerHTML = data.map((profile) => `<article class="admin-card">
      <h3>${escapeHTML(profile.name)}</h3><p>${escapeHTML(categoryCache.get(profile.category_id) || "Servicio local")} · ${escapeHTML(profile.locality)}</p>
      <p>${escapeHTML(profile.description)}</p>
      <div class="admin-actions"><button type="button" data-review="${escapeHTML(profile.id)}" data-status="approved">Aprobar</button><button type="button" data-review="${escapeHTML(profile.id)}" data-status="rejected">Rechazar</button></div>
    </article>`).join("");
  } catch (error) {
    if (currentUser?.id === userId && expectedAuthVersion === authStateVersion) {
      content.textContent = friendlyError(error, "No se pudieron cargar las solicitudes.");
    }
  }
}

async function reviewProfile(id, status) {
  if (!supabase || !await requireAuth()) return;
  if (!currentUser || currentUser.app_metadata?.role !== "admin") {
    showAuth("No tienes permisos para revisar perfiles.");
    return;
  }
  if (id === currentUser?.id) {
    $("#admin-content").prepend(Object.assign(document.createElement("p"), {
      className: "form-message", textContent: "No puedes revisar tu propio perfil.",
    }));
    return;
  }
  if (!["approved", "rejected"].includes(status)) return;
  const userId = currentUser?.id;
  const expectedAuthVersion = authStateVersion;
  try {
    const { error } = await supabase.from("profiles").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    if (currentUser?.id !== userId || expectedAuthVersion !== authStateVersion) return;
    await openAdmin();
  } catch (error) {
    if (currentUser?.id === userId && expectedAuthVersion === authStateVersion) {
      $("#admin-content").prepend(Object.assign(document.createElement("p"), {
        className: "form-message", textContent: friendlyError(error, "No fue posible actualizar el perfil."),
      }));
    }
  }
}

function initMenu() {
  const toggle = $(".menu-toggle");
  const nav = $("#primary-nav");
  const accountToggle = $("#account-status-toggle");
  const accountPanel = $("#account-status-wrap");
  const closeAccountPanel = () => {
    accountPanel.hidden = true;
    accountToggle.setAttribute("aria-expanded", "false");
  };

  accountToggle.addEventListener("click", () => {
    const expanded = accountToggle.getAttribute("aria-expanded") === "true";
    accountToggle.setAttribute("aria-expanded", String(!expanded));
    accountPanel.hidden = expanded;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-menu")) closeAccountPanel();
  });

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", expanded ? "Abrir menú" : "Cerrar menú");
    nav.classList.toggle("nav-open", !expanded);
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("#account-status-action")) closeAccountPanel();
    if (event.target.closest("a") || (event.target.closest("button") && !event.target.closest("#account-status-toggle"))) {
      nav.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menú");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!accountPanel.hidden) {
        closeAccountPanel();
        accountToggle.focus();
      } else if (nav.classList.contains("nav-open")) {
        nav.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Abrir menú");
        toggle.focus();
      }
    }
  });
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadServices();
});
$("#search-query").addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadServices, 300);
});
$("#search-locality").addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadServices, 300);
});
$("#search-category").addEventListener("change", loadServices);
$("#sort-order").addEventListener("change", loadServices);
$("#clear-filters").addEventListener("click", () => {
  searchForm.reset();
  loadServices();
});
document.querySelectorAll("[data-open-auth]").forEach((el) => el.addEventListener("click", (event) => {
  event.preventDefault();
  showAuth();
}));
document.querySelectorAll("[data-open-profile]").forEach((el) => el.addEventListener("click", openProfile));
$("#nav-admin").addEventListener("click", openAdmin);
$("#nav-sign-out").addEventListener("click", signOut);
$("#account-status-action").addEventListener("click", openAccountAction);
$("#google-login").addEventListener("click", signInWithGoogle);
profileForm.addEventListener("submit", saveProfile);
$("#profile-locality").addEventListener("change", updateOtherLocalityVisibility);
for (const name of ["phone", "whatsapp"]) {
  const lada = $(`#profile-${name}-lada`);
  const number = $(`#profile-${name}`);
  lada.addEventListener("input", () => {
    keepDigits(lada, 3);
    updatePhoneGroupRequired(name);
  });
  number.addEventListener("input", () => {
    keepDigits(number, 10);
    updatePhoneGroupRequired(name);
  });
}
$("#admin-content").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review]");
  if (button) reviewProfile(button.dataset.review, button.dataset.status);
});
serviceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-service]");
  if (button) showServiceDetails(button.dataset.viewService);
});
$("#service-detail-content").addEventListener("click", (event) => {
  const reportButton = event.target.closest("[data-report-profile]");
  if (!reportButton) return;
  reportingProfileId = reportButton.dataset.reportProfile;
  $("#report-form").reset();
  $("#report-message").textContent = "";
  openDialog($("#report-dialog"));
});
$("#report-form").addEventListener("submit", submitReport);
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
window.openServicesAdmin = openAdmin;
$("#current-year").textContent = new Date().getFullYear();
initMenu();
initializeAuth();
loadCategories().then(loadServices).catch(() => {
  showNotice("No fue posible conectar con el directorio. Intenta actualizar la página.", "error");
});
