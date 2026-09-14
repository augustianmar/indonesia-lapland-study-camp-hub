const USERS = ["Bohdan", "Peder", "Sunny", "Simon", "Augustian", "LinArctic"];
const state = { user: "", csrf: "", contacts: [], section: "contacts", editingId: null };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function initials(name){
  return (name || "?").replace(/[^A-Za-zÀ-ÿ ]/g, "").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "?";
}
function escapeHtml(str=""){
  return String(str).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}
async function api(url, options={}){
  const headers = {"Accept":"application/json", ...(options.headers || {})};
  if(options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if(state.csrf && !["GET","HEAD"].includes((options.method || "GET").toUpperCase())) headers["X-CSRF-Token"] = state.csrf;
  const res = await fetch(url, {...options, headers, credentials:"same-origin"});
  let data = null;
  try { data = await res.json(); } catch {}
  if(res.status === 401 && url !== "/api/login") { showLogin(); throw new Error("Session expired."); }
  if(!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
function showApp(){
  $("#loginView").classList.add("is-hidden");
  $("#appView").classList.remove("is-hidden");
  $("#sidebarUserName").textContent = state.user;
  $("#sidebarAvatar").textContent = initials(state.user).slice(0,1);
  $("#topUser").textContent = state.user;
}
function showLogin(){
  state.user = ""; state.csrf = ""; state.contacts = [];
  $("#appView").classList.add("is-hidden");
  $("#loginView").classList.remove("is-hidden");
  $("#loginPassword").value = "";
}
async function loadSession(){
  try {
    const s = await api("/api/session");
    state.user = s.user; state.csrf = s.csrf;
    showApp(); await loadContacts();
  } catch { showLogin(); }
}
async function loadContacts(){
  const data = await api("/api/contacts");
  state.contacts = data.contacts || [];
  renderContacts();
}
function getSelectedFilters(selector){ return $$(selector).filter(el=>el.checked).map(el=>el.value); }
function filteredContacts(){
  const q = (($("#globalSearch").value || "") + " " + ($("#filterSearch").value || "")).trim().toLowerCase();
  const countries = getSelectedFilters(".countryFilter");
  const types = getSelectedFilters(".typeFilter");
  const statuses = getSelectedFilters(".statusFilter");
  return state.contacts.filter(c => {
    const hay = Object.values(c).join(" ").toLowerCase();
    return (!q || hay.includes(q)) && (!countries.length || countries.includes(c.country)) && (!types.length || types.includes(c.type)) && (!statuses.length || statuses.includes(c.status));
  });
}
function renderContacts(){
  const rows = filteredContacts();
  $("#contactsTableBody").innerHTML = rows.map(c => `
    <tr data-contact-id="${escapeHtml(c.id)}" title="Double-click to edit">
      <td class="check-col"><input type="checkbox" aria-label="Select ${escapeHtml(c.name)}"></td>
      <td><span class="contact-name">${escapeHtml(c.name)}</span>${c.email ? `<div class="subtle">${escapeHtml(c.email)}</div>` : ""}</td>
      <td>${escapeHtml(c.organisation || "—")}</td><td>${escapeHtml(c.type || "—")}</td><td>${escapeHtml(c.country || "—")}</td>
      <td><span class="status status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
      <td><span class="owner-chip"><span class="owner-dot">${initials(c.owner).slice(0,1)}</span>${escapeHtml(c.owner || "—")}</span></td>
    </tr>`).join("");
  $("#contactsCount").textContent = state.contacts.length;
  $("#visibleCount").textContent = rows.length;
  $("#emptyState").classList.toggle("is-hidden", rows.length !== 0);
  $$('tr[data-contact-id]').forEach(row => row.addEventListener('dblclick', () => openModal(row.dataset.contactId)));
}
function openModal(id=null){
  const form = $("#contactForm"); form.reset(); $("#contactError").textContent = ""; state.editingId = id;
  const owner = form.querySelector("select[name=owner]"); owner.value = USERS.includes(state.user) ? state.user : "Augustian";
  $("#contactModalTitle").textContent = id ? "Edit Contact" : "Create Contact";
  if(id){
    const c = state.contacts.find(x=>x.id === id); if(!c) return;
    for(const [key,val] of Object.entries(c)){ const el = form.elements.namedItem(key); if(el) el.value = val ?? ""; }
  }
  $("#contactModal").classList.remove("is-hidden"); document.body.style.overflow = "hidden";
  setTimeout(()=>form.elements.namedItem("name").focus(),30);
}
function closeModal(){ $("#contactModal").classList.add("is-hidden"); document.body.style.overflow = ""; state.editingId = null; }

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#loginError").textContent = ""; $("#loginButton").disabled = true;
  try {
    const data = await api("/api/login", {method:"POST", body:JSON.stringify({user:$("#loginUser").value, password:$("#loginPassword").value})});
    state.user = data.user; state.csrf = data.csrf; showApp(); await loadContacts();
  } catch(err){ $("#loginError").textContent = err.message; }
  finally { $("#loginButton").disabled = false; }
});
$("#logoutBtn").addEventListener("click", async () => { try { await api("/api/logout", {method:"POST"}); } catch {} showLogin(); });
$("#createContactBtn").addEventListener("click", ()=>openModal());
$("#quickAddBtn").addEventListener("click", ()=>openModal());
$$('[data-close-modal]').forEach(el=>el.addEventListener("click", closeModal));
document.addEventListener("keydown", e=>{ if(e.key === "Escape" && !$("#contactModal").classList.contains("is-hidden")) closeModal(); });
$("#contactForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#contactError").textContent = "";
  const fd = new FormData(e.currentTarget); const payload = Object.fromEntries(fd.entries()); delete payload.id;
  try {
    if(state.editingId) await api(`/api/contacts/${encodeURIComponent(state.editingId)}`, {method:"PUT", body:JSON.stringify(payload)});
    else await api("/api/contacts", {method:"POST", body:JSON.stringify(payload)});
    closeModal(); await loadContacts();
  } catch(err){ $("#contactError").textContent = err.message; }
});
["#globalSearch", "#filterSearch"].forEach(sel => $(sel).addEventListener("input", renderContacts));
$$('.countryFilter,.typeFilter,.statusFilter').forEach(el=>el.addEventListener("change", renderContacts));
$$('.nav-item[data-section]').forEach(btn => btn.addEventListener("click", () => {
  $$('.nav-item[data-section]').forEach(b=>b.classList.remove('is-active')); btn.classList.add('is-active');
  const section = btn.dataset.section; state.section = section;
  const title = btn.querySelector('span:nth-child(2)')?.textContent || 'Home'; $("#pageTitle").textContent = title;
  const contacts = section === 'contacts'; $("#contactsSection").classList.toggle('is-hidden', !contacts); $("#placeholderSection").classList.toggle('is-hidden', contacts);
  if(!contacts) $("#placeholderTitle").textContent = title;
}));
loadSession();
