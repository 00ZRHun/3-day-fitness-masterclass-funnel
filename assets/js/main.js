(() => {
  "use strict";

  const CONFIG = {
    endpoint: "/api/reserve",
    cohort: "014",
    deadline: "2026-10-30T23:59:59-04:00",
    priceFull: 299,
    priceInstallment: 159,
    spotsLeft: 7,
    capacity: 20,
    attributionKey: "apex_attribution_v1",
    attributionKeys: [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gclid",
      "fbclid",
      "msclkid",
      "ttclid",
      "ref"
    ],
    sessions: [
      {
        id: "apex-014-day-1",
        start: "20261106T230000Z",
        end: "20261107T010000Z",
        title: "Day 1 — Foundation: Lower Body",
        description: "ApexFitness 3-Day Strength Masterclass. Lower body mechanics with Coaches Maya Chen and Andre Silva. Bring training shoes, water, and a notebook."
      },
      {
        id: "apex-014-day-2",
        start: "20261107T150000Z",
        end: "20261107T170000Z",
        title: "Day 2 — Power: Upper Body",
        description: "ApexFitness 3-Day Strength Masterclass. Upper body push and pull with Coaches Maya Chen and Andre Silva."
      },
      {
        id: "apex-014-day-3",
        start: "20261108T150000Z",
        end: "20261108T170000Z",
        title: "Day 3 — Integration & 90-Day Plan",
        description: "ApexFitness 3-Day Strength Masterclass. Full-body integration, video review, and your 90-day blueprint."
      }
    ]
  };

  window.dataLayer = window.dataLayer || [];

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    plan: "full",
    step: 1,
    submitting: false,
    lastTrigger: null,
    submission: null,
    attribution: null
  };

  function track(event, params = {}) {
    window.dataLayer.push({ event, ...params });
    if (typeof window.gtag === "function") {
      window.gtag("event", event, params);
    }
  }

  function cleanAttributionValue(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 160);
  }

  function safeReferrer() {
    if (!document.referrer) return "";
    try {
      const url = new URL(document.referrer);
      return `${url.origin}${url.pathname}`.slice(0, 160);
    } catch {
      return cleanAttributionValue(document.referrer);
    }
  }

  function captureAttribution() {
    const incoming = {};
    const params = new URLSearchParams(window.location.search);
    CONFIG.attributionKeys.forEach((key) => {
      const value = cleanAttributionValue(params.get(key));
      if (value) incoming[key] = value;
    });

    let saved = {};
    try {
      const stored = window.sessionStorage.getItem(CONFIG.attributionKey);
      const parsed = stored ? JSON.parse(stored) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        saved = parsed;
      }
    } catch {
      saved = {};
    }

    const now = new Date().toISOString();
    const attribution = {
      ...saved,
      ...incoming,
      referrer: saved?.referrer || safeReferrer(),
      landing_page: saved?.landing_page || cleanAttributionValue(window.location.pathname),
      first_seen_at: saved?.first_seen_at || now,
      last_seen_at: now
    };

    try {
      window.sessionStorage.setItem(CONFIG.attributionKey, JSON.stringify(attribution));
    } catch {
      // Storage can be unavailable in private modes; the in-memory copy still travels with the lead.
    }
    return attribution;
  }

  function applyAvailability() {
    const capacity = Math.max(1, Number(CONFIG.capacity) || 20);
    const left = Math.max(0, Math.min(capacity, Number(CONFIG.spotsLeft) || 0));
    const reserved = capacity - left;

    $$("[data-spots-left]").forEach((element) => {
      element.textContent = String(left);
    });
    $$("[data-spots-capacity]").forEach((element) => {
      element.textContent = String(capacity);
    });
    $$("[data-spots-reserved]").forEach((element) => {
      element.textContent = String(reserved);
    });
    $$("[data-spots-meter]").forEach((meter) => {
      if (meter.children.length !== capacity) {
        meter.replaceChildren(
          ...Array.from({ length: capacity }, () => document.createElement("span"))
        );
      }
      Array.from(meter.children).forEach((segment, index) => {
        segment.classList.toggle("is-filled", index < reserved);
      });
      meter.setAttribute("aria-label", `${reserved} of ${capacity} spots reserved`);
    });
  }

  state.attribution = captureAttribution();
  applyAvailability();
  track("view_item", {
    currency: "USD",
    value: CONFIG.priceFull,
    cohort: CONFIG.cohort,
    items: [
      {
        item_id: `apex-masterclass-${CONFIG.cohort}`,
        item_name: "ApexFitness 3-Day Strength Masterclass",
        item_category: "Masterclass",
        price: CONFIG.priceFull,
        quantity: 1
      }
    ]
  });

  function scrollLock() {
    const anyOpen = $$("dialog[open]").length > 0;
    document.body.classList.toggle("modal-open", anyOpen);
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    document.body.classList.add("modal-open");
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    dialog.close();
  }

  /* -------------------------------------------------------
     Header, progress, sticky CTA, scroll spy
     ------------------------------------------------------- */
  const header = $("[data-header]");
  const headerProgress = $("[data-header-progress]");
  const scrollProgress = $("[data-scroll-progress]");
  const mobileCta = $("[data-mobile-cta]");
  const navLinks = $$("[data-nav]");
  const spySections = navLinks
    .map((link) => document.getElementById(link.dataset.nav))
    .filter(Boolean);

  function setActiveNav() {
    if (!spySections.length) return;
    const marker = window.scrollY + Math.min(window.innerHeight * 0.36, 250);
    let current = null;
    for (const section of spySections) {
      if (section.offsetTop <= marker) current = section.id;
    }
    navLinks.forEach((link) => {
      const active = link.dataset.nav === current;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  const depthMarks = [25, 50, 75, 90];
  const seenDepths = new Set();
  function trackScrollDepth(progress) {
    const percent = Math.round(progress * 100);
    depthMarks.forEach((mark) => {
      if (percent >= mark && !seenDepths.has(mark)) {
        seenDepths.add(mark);
        track("scroll_depth", { percent: mark });
      }
    });
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, scrollTop / max) : 0;

      header?.classList.toggle("is-scrolled", scrollTop > 24);

      if (headerProgress) headerProgress.style.width = `${progress * 100}%`;
      if (scrollProgress) scrollProgress.style.width = `${progress * 100}%`;

      if (mobileCta) mobileCta.classList.toggle("is-visible", scrollTop > 560);

      setActiveNav();
      trackScrollDepth(progress);
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();

  /* -------------------------------------------------------
     Reveals
     ------------------------------------------------------- */
  const revealItems = $$(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  /* -------------------------------------------------------
     Countdown
     ------------------------------------------------------- */
  const deadline = new Date(CONFIG.deadline).getTime();

  function countdownParts(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60)
    };
  }

  function updateCountdown() {
    const diff = deadline - Date.now();
    const expired = diff <= 0;
    const { days, hours, minutes } = countdownParts(diff);
    $$("[data-countdown]").forEach((el) => {
      const mode = el.dataset.countdown;
      if (expired) {
        if (mode === "final") el.textContent = "Final spots";
        else if (mode === "long") el.textContent = "Final spots";
        else el.textContent = "Enrollment closed";
        return;
      }
      if (mode === "final") {
        el.textContent = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
      } else if (mode === "long") {
        el.textContent = days > 0 ? `${days}d ${hours}h ${minutes}m left` : `${hours}h ${minutes}m left`;
      } else {
        el.textContent = days > 0 ? `Closes in ${days}d ${hours}h` : `Closes in ${hours}h ${minutes}m`;
      }
    });
  }
  updateCountdown();
  window.setInterval(updateCountdown, 30000);

  /* -------------------------------------------------------
     Mobile menu
     ------------------------------------------------------- */
  const mobileMenu = $("#mobile-menu");
  const menuOpen = $("[data-menu-open]");
  const menuClose = $("[data-menu-close]");

  function closeMobileMenu() {
    closeDialog(mobileMenu);
    scrollLock();
  }

  menuOpen?.addEventListener("click", () => {
    openDialog(mobileMenu);
    track("menu_open");
  });

  menuClose?.addEventListener("click", closeMobileMenu);

  $$("[data-menu-link]", mobileMenu || document).forEach((link) => {
    link.addEventListener("click", closeMobileMenu);
  });

  mobileMenu?.addEventListener("click", (event) => {
    if (event.target === mobileMenu) closeMobileMenu();
  });

  mobileMenu?.addEventListener("close", scrollLock);

  /* -------------------------------------------------------
     Curriculum tabs
     ------------------------------------------------------- */
  const dayTabs = $$("[data-day-tab]");
  const dayPanels = $$("[data-day-panel]");

  function activateDay(index, focus = false) {
    const tab = dayTabs[index];
    if (!tab) return;
    const day = tab.dataset.dayTab;

    dayTabs.forEach((item, i) => {
      const selected = i === index;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });

    dayPanels.forEach((panel) => {
      const selected = panel.dataset.dayPanel === day;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    });

    if (focus) tab.focus();
    track("curriculum_tab", { day });
  }

  dayTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateDay(index));
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % dayTabs.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + dayTabs.length) % dayTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = dayTabs.length - 1;
      activateDay(next, true);
    });
  });

  /* -------------------------------------------------------
     Plan toggle
     ------------------------------------------------------- */
  const planOptions = $$("[data-plan]");
  const priceDisplay = $("[data-price-display]");
  const priceNote = $("[data-price-note]");
  const paymentSub = $("[data-payment-sub]");
  const priceButton = $("[data-price-button]");
  const planSummary = $("[data-plan-summary]");

  function planLabel(plan = state.plan) {
    return plan === "installments"
      ? `2 payments · $${CONFIG.priceInstallment} each`
      : `Pay in full · $${CONFIG.priceFull}`;
  }

  function applyPlan(plan, announce = true) {
    state.plan = plan === "installments" ? "installments" : "full";
    const installments = state.plan === "installments";

    planOptions.forEach((option) => {
      const selected = option.dataset.plan === state.plan;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-checked", String(selected));
      option.tabIndex = selected ? 0 : -1;
    });

    if (priceDisplay) priceDisplay.textContent = installments ? `$${CONFIG.priceInstallment}` : `$${CONFIG.priceFull}`;
    if (priceNote) priceNote.textContent = installments ? "USD · each payment" : "USD · one-time payment";
    if (paymentSub) paymentSub.textContent = installments ? `Then $${CONFIG.priceInstallment} in 30 days · $318 total.` : "Pay once. Keep everything.";
    if (priceButton) priceButton.textContent = "Reserve my spot";
    if (planSummary) planSummary.textContent = planLabel();

    if (announce) track("plan_select", { plan: state.plan, value: installments ? CONFIG.priceInstallment : CONFIG.priceFull });
  }

  planOptions.forEach((option, index) => {
    option.addEventListener("click", () => applyPlan(option.dataset.plan));
    option.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const dir = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const next = (index + dir + planOptions.length) % planOptions.length;
      applyPlan(planOptions[next].dataset.plan);
      planOptions[next].focus();
    });
  });

  applyPlan("full", false);

  /* -------------------------------------------------------
     Reservation dialog
     ------------------------------------------------------- */
  const reserveDialog = $("#reserve-dialog");
  const reserveForm = $("#reserve-form");
  const formSteps = $$(".form-step", reserveForm);
  const progressDots = $$("[data-progress-dot]");
  const reserveMain = $(".reserve-main", reserveDialog);
  const formError = $("[data-form-error]");
  const formStatus = $("[data-form-status]");
  const submitButton = $("[data-submit]", reserveForm);
  const submitLabel = $("[data-submit-label]", reserveForm);
  const successMessage = $("[data-success-message]");
  const successId = $("[data-success-id]");
  const successPlan = $("[data-success-plan]");
  const nextButton = $("[data-next-step]", reserveForm);
  const previousButton = $("[data-prev-step]", reserveForm);

  const fieldMap = {
    name: { input: $("#reserve-name"), error: $('[data-error-for="name"]') },
    email: { input: $("#reserve-email"), error: $('[data-error-for="email"]') },
    goal: { inputs: $$('input[name="goal"]', reserveForm), error: $('[data-error-for="goal"]') },
    experience: { inputs: $$('input[name="experience"]', reserveForm), error: $('[data-error-for="experience"]') },
    consent: { input: $('input[name="consent"]', reserveForm), error: $('[data-error-for="consent"]') }
  };

  function setStep(step, focus = true) {
    state.step = step;
    formSteps.forEach((panel) => {
      panel.hidden = Number(panel.dataset.step) !== step;
    });
    progressDots.forEach((dot) => {
      dot.classList.toggle("is-active", Number(dot.dataset.progressDot) <= step);
    });
    if (reserveMain) reserveMain.scrollTop = 0;

    if (focus) {
      if (step === 1) $("#reserve-name")?.focus();
      if (step === 2) $('input[name="goal"]', reserveForm)?.focus();
      if (step === 3) {
        const heading = $("h2", $('[data-step="3"]', reserveForm));
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }
    }
  }

  function clearError(name) {
    const field = fieldMap[name];
    if (!field) return;
    if (field.error) field.error.textContent = "";
    const inputs = field.inputs || (field.input ? [field.input] : []);
    inputs.forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
  }

  function setError(name, message) {
    const field = fieldMap[name];
    if (!field) return;
    if (field.error) {
      field.error.textContent = message;
      field.error.setAttribute("role", "alert");
    }
    const inputs = field.inputs || (field.input ? [field.input] : []);
    inputs.forEach((input) => {
      input.setAttribute("aria-invalid", "true");
      if (field.error?.id) input.setAttribute("aria-describedby", field.error.id);
    });
  }

  function validEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value);
  }

  function validateStep(step) {
    let valid = true;
    let firstInvalid = null;

    if (step === 1) {
      ["name", "email"].forEach(clearError);
      const name = $("#reserve-name")?.value.trim() || "";
      const email = $("#reserve-email")?.value.trim() || "";

      if (name.length < 2) {
        setError("name", "Please enter your full name.");
        firstInvalid ||= $("#reserve-name");
        valid = false;
      }
      if (!validEmail(email)) {
        setError("email", "Please enter a valid email address.");
        firstInvalid ||= $("#reserve-email");
        valid = false;
      }
    }

    if (step === 2) {
      ["goal", "experience", "consent"].forEach(clearError);
      const goal = $('input[name="goal"]:checked', reserveForm);
      const experience = $('input[name="experience"]:checked', reserveForm);
      const consent = $('input[name="consent"]', reserveForm)?.checked;

      if (!goal) {
        setError("goal", "Pick the goal that fits you best.");
        firstInvalid ||= $('input[name="goal"]', reserveForm);
        valid = false;
      }
      if (!experience) {
        setError("experience", "Choose your experience level.");
        firstInvalid ||= $('input[name="experience"]', reserveForm);
        valid = false;
      }
      if (!consent) {
        setError("consent", "Please accept the cancellation policy to continue.");
        firstInvalid ||= $('input[name="consent"]', reserveForm);
        valid = false;
      }
    }

    if (!valid && firstInvalid) {
      firstInvalid.focus({ preventScroll: false });
    }
    return valid;
  }

  function resetForm() {
    reserveForm?.reset();
    state.submission = null;
    Object.keys(fieldMap).forEach(clearError);
    if (formError) {
      formError.hidden = true;
      formError.textContent = "";
    }
    if (formStatus) formStatus.textContent = "";
    if (successId) successId.textContent = "APX-000000";
    if (successPlan) successPlan.textContent = planLabel();
    if (planSummary) planSummary.textContent = planLabel();
    applyPlan(state.plan, false);
    setStep(1, false);
  }

  function openReserve(trigger) {
    if (!reserveDialog) return;
    state.lastTrigger = trigger || document.activeElement;
    if (mobileMenu?.open) closeMobileMenu();
    if (reserveDialog.open) return;
    if (state.step === 3) resetForm();
    openDialog(reserveDialog);
    const value = state.plan === "installments" ? CONFIG.priceInstallment : CONFIG.priceFull;
    const source = trigger?.dataset.track || "unknown";
    track("reserve_open", { source, plan: state.plan });
    track("begin_checkout", {
      currency: "USD",
      value,
      plan: state.plan,
      cohort: CONFIG.cohort,
      source
    });
    window.setTimeout(() => {
      if (state.step === 1) $("#reserve-name")?.focus({ preventScroll: true });
    }, 120);
  }

  function closeReserve() {
    if (state.submitting) return;
    closeDialog(reserveDialog);
  }

  $$("[data-reserve]").forEach((trigger) => {
    trigger.addEventListener("click", () => openReserve(trigger));
  });

  $$("[data-reserve-close]", reserveDialog || document).forEach((button) => {
    button.addEventListener("click", () => {
      if (state.submitting) return;
      closeReserve();
      if (state.step === 3) {
        window.setTimeout(() => {
          if (!reserveDialog.open) resetForm();
        }, 280);
      }
    });
  });

  reserveDialog?.addEventListener("click", (event) => {
    if (event.target === reserveDialog) closeReserve();
  });

  reserveDialog?.addEventListener("close", () => {
    scrollLock();
    if (state.step === 3) {
      window.setTimeout(() => {
        if (!reserveDialog.open) resetForm();
      }, 280);
    }
  });

  nextButton?.addEventListener("click", () => {
    if (!validateStep(1)) {
      track("form_error", { step: 1 });
      return;
    }
    setStep(2);
    track("form_step", { step: 2 });
  });

  previousButton?.addEventListener("click", () => {
    setStep(1);
    track("form_step", { step: 1 });
  });

  $$("input, textarea", reserveForm || document).forEach((input) => {
    const handler = () => {
      clearError(input.name);
      if (formError) {
        formError.hidden = true;
        formError.textContent = "";
      }
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });

  function showFormError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.hidden = false;
    formError.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }

  function setSubmitting(isSubmitting) {
    state.submitting = isSubmitting;
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.classList.toggle("is-loading", isSubmitting);
    submitButton.setAttribute("aria-busy", String(isSubmitting));
    if (submitLabel) submitLabel.textContent = isSubmitting ? "Reserving your spot…" : "Reserve my spot";
  }

  reserveForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.submitting) return;

    if (!validateStep(1)) {
      setStep(1, false);
      validateStep(1);
      track("form_error", { step: 1 });
      return;
    }
    if (!validateStep(2)) {
      track("form_error", { step: 2 });
      return;
    }

    const payload = {
      name: $("#reserve-name")?.value.trim(),
      email: $("#reserve-email")?.value.trim(),
      phone: $("#reserve-phone")?.value.trim(),
      goal: $('input[name="goal"]:checked', reserveForm)?.value,
      experience: $('input[name="experience"]:checked', reserveForm)?.value,
      note: $("#reserve-note")?.value.trim(),
      plan: state.plan,
      consent: $('input[name="consent"]', reserveForm)?.checked === true,
      company: $("#reserve-company")?.value || "",
      cohort: CONFIG.cohort,
      attribution: state.attribution,
      page: window.location.pathname
    };

    setSubmitting(true);
    if (formError) {
      formError.hidden = true;
      formError.textContent = "";
    }
    if (formStatus) formStatus.textContent = "Sending your reservation request.";

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const requestTimeout = window.setTimeout(() => controller?.abort(), 15000);

    try {
      const response = await fetch(CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn’t send your request just now. Please try again.");
      }

      state.submission = { ...data, name: payload.name, email: payload.email, plan: state.plan };
      const firstName = payload.name.split(/\s+/)[0];
      if (successId) successId.textContent = data.id || "APX-000000";
      if (successPlan) successPlan.textContent = planLabel();
      if (successMessage) {
        successMessage.textContent = data.emailSent
          ? `You’re in, ${firstName}. A confirmation is on its way to ${payload.email}. Save the dates below and watch for your enrollment link.`
          : `Thanks, ${firstName}. We’ve received your request and will confirm your spot at ${payload.email} within one business day. Save the dates below—no payment has been taken.`;
      }
      if (formStatus) formStatus.textContent = `Reservation request received. Reference ${data.id || "APX"}.`;
      const value = state.plan === "installments" ? CONFIG.priceInstallment : CONFIG.priceFull;
      track("reserve_submit", { plan: state.plan, value });
      track("generate_lead", {
        lead_id: data.id,
        currency: "USD",
        value,
        plan: state.plan,
        cohort: CONFIG.cohort,
        source: state.attribution?.utm_source || "direct"
      });
      setStep(3);
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "That took longer than expected. Check your connection and try again, or email hello@apexfitness.com."
          : error.message || "Something went wrong. Please try again or email hello@apexfitness.com.";
      showFormError(message);
      if (formStatus) formStatus.textContent = "Reservation request failed.";
      track("form_error", { step: 2, message: error?.name === "AbortError" ? "timeout" : "request_failed" });
    } finally {
      window.clearTimeout(requestTimeout);
      setSubmitting(false);
    }
  });

  /* -------------------------------------------------------
     Calendar download
     ------------------------------------------------------- */
  function icsEscape(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function buildCalendar() {
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ApexFitness//3-Day Strength Masterclass//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    CONFIG.sessions.forEach((session) => {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${session.id}@apexfitness.com`,
        `DTSTAMP:${now}`,
        `DTSTART:${session.start}`,
        `DTEND:${session.end}`,
        `SUMMARY:${icsEscape(session.title)}`,
        `LOCATION:${icsEscape("Apex Strength Lab, SoHo, New York, NY")}`,
        `DESCRIPTION:${icsEscape(session.description)}`,
        "STATUS:CONFIRMED",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function downloadCalendar(source = "unknown") {
    const blob = new Blob([buildCalendar()], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "apexfitness-masterclass-014.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    track("calendar_download", { source });
  }

  $$("[data-calendar]").forEach((button) => {
    button.addEventListener("click", () => {
      downloadCalendar(button.dataset.calendarSource || "success");
    });
  });

  /* -------------------------------------------------------
     FAQ analytics
     ------------------------------------------------------- */
  $$(".faq-item").forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      const summary = $("summary", item)?.innerText.trim().slice(0, 80) || "unknown";
      track("faq_open", { question: summary });
    });
  });

  /* -------------------------------------------------------
     Link & CTA analytics (delegated)
     ------------------------------------------------------- */
  document.addEventListener("click", (event) => {
    const element = event.target.closest("[data-track]");
    if (!element) return;
    track("cta_click", { id: element.dataset.track });
  });

  /* -------------------------------------------------------
     Escape handling & dialog state
     ------------------------------------------------------- */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (mobileMenu?.open) closeMobileMenu();
    if (reserveDialog?.open && !state.submitting) closeReserve();
  });

  /* -------------------------------------------------------
     Campaign deep links
     ?reserve=1 opens the reservation flow from ads or email.
     ?plan=installments preselects the payment plan.
     ------------------------------------------------------- */
  function applyDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    if (plan === "installments" || plan === "full") {
      applyPlan(plan, false);
    }
    const wantsReserve = ["1", "true", "yes"].includes(
      (params.get("reserve") || "").toLowerCase()
    );
    if (wantsReserve || window.location.hash === "#reserve") {
      window.setTimeout(() => {
        openReserve({ dataset: { track: "deep_link" } });
      }, 250);
    }
  }

  window.addEventListener("pageshow", scrollLock);
  applyDeepLink();
})();
