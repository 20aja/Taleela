const TOAST_DEFAULT_DURATION = 3800;

let confirmResolver = null;
let confirmKeyHandler = null;

function ensureUiLayer() {
  if (!document.getElementById("appNotificationStack")) {
    const stack = document.createElement("div");
    stack.id = "appNotificationStack";
    stack.className = "app-notification-stack";
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("aria-atomic", "false");
    document.body.appendChild(stack);
  }

  if (!document.getElementById("appConfirmOverlay")) {
    const overlay = document.createElement("div");
    overlay.id = "appConfirmOverlay";
    overlay.className = "app-confirm-overlay hidden";
    overlay.innerHTML = `
      <div class="app-confirm-card" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmMessage">
        <div id="appConfirmIcon" class="app-confirm-icon"><i class="fa-solid fa-circle-question"></i></div>
        <h2 id="appConfirmTitle">تأكيد</h2>
        <p id="appConfirmMessage"></p>
        <div class="app-confirm-actions">
          <button id="appConfirmAccept" class="app-confirm-accept" type="button">تأكيد</button>
          <button id="appConfirmCancel" class="app-confirm-cancel" type="button">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

function iconForType(type) {
  if (type === "success") return "fa-solid fa-circle-check";
  if (type === "warning") return "fa-solid fa-triangle-exclamation";
  if (type === "error") return "fa-solid fa-circle-xmark";
  return "fa-solid fa-circle-info";
}

export function notify(message, options = {}) {
  ensureUiLayer();
  const stack = document.getElementById("appNotificationStack");
  if (!stack) return null;

  const type = ["success", "warning", "error", "info"].includes(options.type) ? options.type : "info";
  const duration = Number.isFinite(options.duration) ? Math.max(0, options.duration) : TOAST_DEFAULT_DURATION;
  const toast = document.createElement("div");
  toast.className = `app-notification app-notification-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const title = String(options.title || "").trim();
  const text = String(message || "").trim();
  toast.innerHTML = `
    <div class="app-notification-icon"><i class="${options.icon || iconForType(type)}"></i></div>
    <div class="app-notification-content">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
      <span>${escapeHtml(text)}</span>
    </div>
    <button class="app-notification-close" type="button" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>
    ${duration > 0 ? '<span class="app-notification-progress" aria-hidden="true"></span>' : ""}
  `;

  stack.appendChild(toast);
  while (stack.children.length > 4) stack.firstElementChild?.remove();

  let timer = null;
  const dismiss = () => {
    if (!toast.isConnected) return;
    if (timer) window.clearTimeout(timer);
    toast.classList.add("app-notification-leaving");
    window.setTimeout(() => toast.remove(), 240);
  };

  toast.querySelector(".app-notification-close")?.addEventListener("click", dismiss);
  if (duration > 0) {
    const progress = toast.querySelector(".app-notification-progress");
    if (progress) progress.style.setProperty("--notification-duration", `${duration}ms`);
    timer = window.setTimeout(dismiss, duration);
  }

  requestAnimationFrame(() => toast.classList.add("app-notification-visible"));
  return {dismiss};
}

export function confirmAction(options = {}) {
  ensureUiLayer();
  const overlay = document.getElementById("appConfirmOverlay");
  const title = document.getElementById("appConfirmTitle");
  const message = document.getElementById("appConfirmMessage");
  const icon = document.getElementById("appConfirmIcon");
  const accept = document.getElementById("appConfirmAccept");
  const cancel = document.getElementById("appConfirmCancel");
  if (!overlay || !title || !message || !icon || !accept || !cancel) return Promise.resolve(false);

  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }

  title.textContent = String(options.title || "تأكيد");
  message.textContent = String(options.message || "هل تريد المتابعة؟");
  accept.textContent = String(options.confirmText || "تأكيد");
  cancel.textContent = String(options.cancelText || "إلغاء");
  const danger = options.danger === true;
  overlay.classList.toggle("is-danger", danger);
  icon.innerHTML = `<i class="${options.icon || (danger ? "fa-solid fa-arrow-right-from-bracket" : "fa-solid fa-circle-question")}"></i>`;

  overlay.classList.remove("hidden");
  requestAnimationFrame(() => overlay.classList.add("app-confirm-visible"));
  window.setTimeout(() => (danger ? cancel : accept).focus(), 40);

  return new Promise((resolve) => {
    confirmResolver = resolve;

    const finish = (value) => {
      if (!confirmResolver) return;
      const resolver = confirmResolver;
      confirmResolver = null;
      overlay.classList.remove("app-confirm-visible");
      if (confirmKeyHandler) document.removeEventListener("keydown", confirmKeyHandler);
      window.setTimeout(() => overlay.classList.add("hidden"), 180);
      resolver(Boolean(value));
    };

    accept.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    overlay.onclick = (event) => {
      if (event.target === overlay) finish(false);
    };
    confirmKeyHandler = (event) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter" && document.activeElement === accept) finish(true);
    };
    document.addEventListener("keydown", confirmKeyHandler);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
