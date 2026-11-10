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
let editingProfile = null;
let reportingProfileId = null;
let categoriesLoadFailed = false;

const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function showNotice(message, type = "info") {
  directoryNotice.textContent = message;
  directoryNotice.className = `notice notice-${type}`;
  directoryNotice.hidden = false;
}

function showServiceDetails(id) {
  const service = window.servicesById?.get(id);
  if (!service) return;
  const category = categoryCache.get(service.category_id) || "Servicio local";
  const contactLinks = [
    service.show_phone && service.phone ? `<a class="button button-dark" href="tel:${escapeHTML(service.phone)}">Llamar ↗</a>` : "",
    service.show_whatsapp && service.whatsapp ? `<a class="button button-dark" href="https://wa.me/${escapeHTML(service.whatsapp.replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>` : "",
    service.website && /^https?:\/\//i.test(service.website) ? `<a class="button button-light" href="${escapeHTML(service.website)}" target="_blank" rel="noopener noreferrer">Visitar sitio ↗</a>` : "",
  ].filter(Boolean).join("");
  const image = service.photo_url
    ? `<img class="detail-image" src="${escapeHTML(service.photo_url)}" alt="">`
    : `<div class="detail-image detail-placeholder" aria-hidden="true">${escapeHTML((service.name || "S").charAt(0).toUpperCase())}</div>`;
  $("#service-detail-content").innerHTML = `${image}<p class="eyebrow">${escapeHTML(category)} · ${escapeHTML(service.locality)}</p>
    <h2 id="service-detail-title">${escapeHTML(service.name)}</h2><p class="detail-description">${escapeHTML(service.description)}</p>
    <div class="detail-actions">${contactLinks || '<p>Este perfil no tiene datos de contacto públicos.</p>'}
      <button class="text-button" type="button" data-report-profile="${escapeHTML(service.id)}">Reportar perfil</button></div>`;
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
    const image = service.photo_url
      ? `<img src="${escapeHTML(service.photo_url)}" alt="" loading="lazy">`
      : `<span class="service-initial" aria-hidden="true">${initial}</span>`;
    return `<article class="service-card" tabindex="0" role="button" aria-haspopup="dialog" data-service-id="${escapeHTML(service.id)}" aria-label="Ver perfil de ${escapeHTML(service.name)}, ${escapeHTML(category)} en ${escapeHTML(service.locality)}">
      <div class="card-image">${image}<span class="card-category">${escapeHTML(category)}</span></div>
      <div class="card-content"><p class="card-location"><span aria-hidden="true">⌖</span> ${escapeHTML(service.locality)}</p>
        <h3>${escapeHTML(service.name)}</h3><p class="card-description">${escapeHTML(service.description)}</p>
        <div class="card-footer"><span class="card-category-text">${escapeHTML(category)}</span><span class="card-contact" aria-hidden="true">Ver perfil ↗</span></div>
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
    let request = supabase.from("public_services").select("id,name,category_id,locality,description,phone,whatsapp,show_phone,show_whatsapp,website,photo_url,created_at");
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
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      showAuth("No pudimos verificar tu sesión. Intenta iniciar sesión de nuevo.");
      return false;
    }
    currentUser = user;
    if (!user) {
      showAuth("Inicia sesión para publicar o administrar un servicio.");
      return false;
    }
    return true;
  } catch {
    showAuth("No pudimos verificar tu sesión. Intenta iniciar sesión de nuevo.");
    return false;
  }
}

async function openProfile() {
  if (!await requireAuth()) return;
  editingProfile = null;
  profileForm.reset();
  $("#profile-title").textContent = "Publica tu servicio.";
  $("#profile-message").textContent = "Cargando tu perfil…";
  openDialog(profileDialog);
  let data;
  try {
    const result = await supabase.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    if (result.error) {
      $("#profile-message").textContent = friendlyError(result.error, "No se pudo cargar tu perfil.");
      return;
    }
    data = result.data;
  } catch {
    $("#profile-message").textContent = "No se pudo cargar tu perfil. Comprueba tu conexión e inténtalo de nuevo.";
    return;
  }
  if (data) {
    editingProfile = data;
    $("#profile-title").textContent = "Edita tu servicio.";
    for (const field of ["name", "category_id", "locality", "description", "phone", "whatsapp", "website"]) {
      const input = profileForm.elements.namedItem(field);
      if (input) input.value = data[field] || "";
    }
    $("#profile-show-phone").checked = Boolean(data.show_phone);
    $("#profile-show-whatsapp").checked = Boolean(data.show_whatsapp);
  }
  $("#profile-message").textContent = "";
}

async function saveProfile(event) {
  event.preventDefault();
  const message = $("#profile-message");
  message.textContent = "";
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
  const submitButton = profileForm.querySelector('[type="submit"]');
  setBusy(submitButton, true, "Guardando…");
  try {
    let photoUrl = editingProfile?.photo_url || null;
    if (photo) {
      const ext = photo.type === "image/jpeg" ? "jpg" : photo.type.split("/")[1];
      const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("service-photos").upload(path, photo, { contentType: photo.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("service-photos").getPublicUrl(path);
      photoUrl = publicUrl;
    }
    const payload = {
      id: currentUser.id,
      name: $("#profile-name").value.trim(),
      category_id: $("#profile-category").value,
      locality: $("#profile-locality").value.trim(),
      description: $("#profile-description").value.trim(),
      phone: $("#profile-phone").value.trim() || null,
      whatsapp: $("#profile-whatsapp").value.trim() || null,
      show_phone: $("#profile-show-phone").checked,
      show_whatsapp: $("#profile-show-whatsapp").checked,
      website: $("#profile-website").value.trim() || null,
      photo_url: photoUrl,
      status: "pending",
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;
    message.textContent = "Tu perfil se envió para revisión. Te avisaremos cuando esté publicado.";
    profileForm.reset();
    editingProfile = null;
    window.setTimeout(() => profileDialog.close(), 2200);
  } catch (error) {
    message.textContent = friendlyError(error, "No se pudo guardar el perfil. Revisa tu conexión e inténtalo de nuevo.");
  } finally {
    setBusy(submitButton, false, "Enviar para revisión ↗");
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

async function openAdmin() {
  const content = $("#admin-content");
  if (!supabase || !await requireAuth()) return;
  if (currentUser.app_metadata?.role !== "admin") {
    showAuth("No tienes permisos para acceder al panel de administración.");
    return;
  }
  openDialog($("#admin-dialog"));
  content.textContent = "Cargando perfiles pendientes…";
  try {
    const { data, error } = await supabase.from("profiles").select("id,name,category_id,locality,description").eq("status", "pending").order("created_at");
    if (error) throw error;
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
    content.textContent = friendlyError(error, "No se pudieron cargar las solicitudes.");
  }
}

async function reviewProfile(id, status) {
  try {
    const { error } = await supabase.from("profiles").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await openAdmin();
  } catch (error) {
    $("#admin-content").prepend(Object.assign(document.createElement("p"), {
      className: "form-message", textContent: friendlyError(error, "No fue posible actualizar el perfil."),
    }));
  }
}

function initMenu() {
  const toggle = $(".menu-toggle");
  const nav = $("#primary-nav");
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", expanded ? "Abrir menú" : "Cerrar menú");
    nav.classList.toggle("nav-open", !expanded);
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) {
      nav.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menú");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      nav.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menú");
      toggle.focus();
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
$("#google-login").addEventListener("click", signInWithGoogle);
profileForm.addEventListener("submit", saveProfile);
$("#admin-content").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review]");
  if (button) reviewProfile(button.dataset.review, button.dataset.status);
});
serviceList.addEventListener("click", (event) => {
  if (event.target.closest("a, button")) return;
  const card = event.target.closest("[data-service-id]");
  if (card) showServiceDetails(card.dataset.serviceId);
});
serviceList.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-service-id]")) {
    event.preventDefault();
    showServiceDetails(event.target.dataset.serviceId);
  }
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

if (supabase) {
  supabase.auth.getUser().then(({ data, error }) => {
    if (!error) currentUser = data.user;
  }).catch(() => {
    showNotice("No fue posible verificar tu sesión. Algunas acciones podrían requerir que vuelvas a iniciar sesión.", "error");
  });
}
loadCategories().then(loadServices).catch(() => {
  showNotice("No fue posible conectar con el directorio. Intenta actualizar la página.", "error");
});
