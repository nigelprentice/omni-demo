/* ============================================================
   BOOK PAGE — standalone consult booking
   Mirrors the chat wizard's slot-generation logic (book.html)
   - Skips Sundays (not a typical builder consult day)
   - Two slots/day: 10:00 AM CT / 2:00 PM CT
   - Window 0: next 1–3 days · Window 1: 4–7 days from now
   - Submits to Web3Forms (replace ACCESS_KEY when ready)
   - Designed to be GHL-webhook ready: drop your URL into GHL_WEBHOOK_URL
   ============================================================ */
(function () {
  'use strict';

  // -----------------------------------------------------------
  // CONFIG
  // -----------------------------------------------------------
  // Replace with the user's Web3Forms access key (free, https://web3forms.com)
  // Until set, the form will NOT actually email — it will show a friendly
  // message in the console and still display the confirmation screen so
  // demos work end-to-end.
  const WEB3FORMS_KEY = 'REPLACE_WITH_WEB3FORMS_ACCESS_KEY';

  // Optional: set this to a GHL inbound webhook URL to also push the lead
  // straight into GHL. Leave blank to disable.
  const GHL_WEBHOOK_URL = '';

  // -----------------------------------------------------------
  // ELEMENTS
  // -----------------------------------------------------------
  const form = document.getElementById('bookForm');
  const slotsCard = document.getElementById('slotsCard');
  const slotsGrid = document.getElementById('slotsGrid');
  const moreBtn = document.getElementById('moreTimesBtn');
  const noneBtn = document.getElementById('noneWorkBtn');
  const isoInput = document.getElementById('consultTimeIso');
  const labelInput = document.getElementById('consultTimeLabel');
  const submitBtn = document.getElementById('submitBtn');
  const errorEl = document.getElementById('formError');
  const w3fKey = document.getElementById('w3fKey');

  if (w3fKey && WEB3FORMS_KEY) w3fKey.value = WEB3FORMS_KEY;

  // -----------------------------------------------------------
  // SLOT GENERATION (mirrors chatbot.js getSlotsForWindow)
  // -----------------------------------------------------------
  function getSlotsForWindow(win) {
    // win 0: days 1–3, win 1: days 4–7
    const now = new Date();
    const out = [];
    const start = win === 0 ? 1 : 4;
    const end = win === 0 ? 3 : 7;
    const fmt = { weekday: 'short', month: 'short', day: 'numeric' };

    for (let off = start; off <= end; off++) {
      const d = new Date(now);
      d.setDate(now.getDate() + off);
      // Skip Sundays — not a typical builder consult day
      if (d.getDay() === 0) continue;

      const am = new Date(d); am.setHours(10, 0, 0, 0);
      const pm = new Date(d); pm.setHours(14, 0, 0, 0);
      const dateLabel = d.toLocaleDateString('en-US', fmt);
      out.push({ label: dateLabel, time: '10:00 AM CT', iso: am.toISOString() });
      out.push({ label: dateLabel, time: '2:00 PM CT', iso: pm.toISOString() });
    }
    return win === 0 ? out.slice(0, 6) : out.slice(0, 8);
  }

  let currentWindow = 0;

  function renderSlots(win) {
    const slots = getSlotsForWindow(win);
    slotsGrid.innerHTML = '';
    slots.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.iso = s.iso;
      btn.dataset.label = `${s.label} at ${s.time}`;
      btn.innerHTML = `<strong>${s.label}</strong>${s.time}`;
      btn.addEventListener('click', () => selectSlot(btn));
      slotsGrid.appendChild(btn);
    });

    // Update header
    const h4 = slotsCard.querySelector('h4');
    if (h4) h4.textContent = win === 0 ? 'This week' : 'Next week';

    // Toggle "more times" button
    moreBtn.style.display = win === 0 ? '' : 'none';
  }

  function selectSlot(btn) {
    slotsCard.classList.remove('tbd-mode');
    // Restore card body if it was replaced
    if (!document.getElementById('slotsGrid')) {
      // Rebuild — we replaced it earlier with the TBD message
      restoreSlotsCard();
      // re-find the button (no longer exists), re-render and abort this click
      renderSlots(currentWindow);
      return;
    }
    document.querySelectorAll('.booking-card .slot').forEach((b) => {
      b.classList.remove('selected');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('selected');
    btn.setAttribute('aria-checked', 'true');
    isoInput.value = btn.dataset.iso || '';
    labelInput.value = btn.dataset.label || '';
  }

  function restoreSlotsCard() {
    slotsCard.classList.remove('tbd-mode');
    slotsCard.innerHTML = `
      <h4>This week</h4>
      <div id="slotsGrid" class="slots slots-grid-3" role="radiogroup" aria-label="Available time slots"></div>
      <button type="button" class="more-times" id="moreTimesBtn">Show more times →</button>
      <button type="button" class="none-work" id="noneWorkBtn">None of these work — send me more options</button>
    `;
    // Re-bind references and listeners
    rebindSlotControls();
  }

  function rebindSlotControls() {
    const newMore = document.getElementById('moreTimesBtn');
    const newNone = document.getElementById('noneWorkBtn');
    if (newMore) newMore.addEventListener('click', onMore);
    if (newNone) newNone.addEventListener('click', onNone);
  }

  function onMore() {
    currentWindow = 1;
    renderSlots(1);
  }

  function onNone() {
    // Mirror chat behavior: clear iso, mark as TBD
    isoInput.value = '';
    labelInput.value = 'Send me more time options';
    slotsCard.classList.add('tbd-mode');
    slotsCard.innerHTML = `
      <h4>Got it</h4>
      <p class="tbd-msg">
        Omni will text you a few more options within one business hour.
        <strong>Just finish the form below</strong> so we have your contact info.
      </p>
      <button type="button" class="more-times" id="resetSlotsBtn">← Pick a time instead</button>
    `;
    const reset = document.getElementById('resetSlotsBtn');
    if (reset) reset.addEventListener('click', () => {
      restoreSlotsCard();
      currentWindow = 0;
      renderSlots(0);
    });
  }

  // Initial render + bindings
  renderSlots(0);
  if (moreBtn) moreBtn.addEventListener('click', onMore);
  if (noneBtn) noneBtn.addEventListener('click', onNone);

  // -----------------------------------------------------------
  // VALIDATION
  // -----------------------------------------------------------
  function validateForm(fd) {
    const errors = [];
    const name = (fd.get('name') || '').toString().trim();
    const email = (fd.get('email') || '').toString().trim();
    const phone = (fd.get('phone') || '').toString().trim();
    const desc = (fd.get('description') || '').toString().trim();
    const lane = (fd.get('lane') || '').toString().trim();

    if (!name) errors.push('Add your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Add a valid email.');
    if (phone.replace(/\D/g, '').length < 10) errors.push('Add a 10-digit cell number.');
    if (!desc) errors.push('Tell Omni what you\u2019re picturing.');
    if (!lane) errors.push('Pick a lane.');
    return errors;
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() { if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; } }

  // -----------------------------------------------------------
  // SUBMIT
  // -----------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const fd = new FormData(form);

    // Honeypot
    if (fd.get('botcheck')) return;

    const errs = validateForm(fd);
    if (errs.length) { showError(errs.join(' ')); return; }

    // Build a pretty consult-time field for Web3Forms email body
    const iso = isoInput.value;
    let consultPretty = labelInput.value || 'Send more time options';
    if (iso) {
      const dt = new Date(iso);
      const fmtDate = { weekday: 'long', month: 'long', day: 'numeric' };
      const fmtTime = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
      consultPretty = `${dt.toLocaleDateString('en-US', fmtDate)} · ${dt.toLocaleTimeString('en-US', fmtTime)}`;
    }
    fd.set('requested_time', consultPretty);
    fd.set('source', 'omni_homepage / book.html');
    fd.set('submitted_at', new Date().toISOString());

    // Loading state
    submitBtn.disabled = true;
    submitBtn.querySelector('.submit-default').hidden = true;
    submitBtn.querySelector('.submit-loading').hidden = false;

    let emailOk = false;
    let ghlOk = false;
    const keyConfigured = w3fKey.value && w3fKey.value !== 'REPLACE_WITH_WEB3FORMS_ACCESS_KEY';

    // ---- Web3Forms email ----
    if (keyConfigured) {
      try {
        const r = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          body: fd,
        });
        const j = await r.json().catch(() => ({}));
        emailOk = !!(j && j.success);
      } catch (err) {
        emailOk = false;
        console.warn('[book] Web3Forms submit failed', err);
      }
    } else {
      // Demo mode: skip email, just log payload
      console.info('[book] Demo mode — Web3Forms key not set. Payload:', Object.fromEntries(fd.entries()));
      emailOk = true; // treat as success so confirmation still shows
    }

    // ---- Optional GHL webhook (parallel push for future use) ----
    if (GHL_WEBHOOK_URL) {
      try {
        const payload = Object.fromEntries(fd.entries());
        const r = await fetch(GHL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        ghlOk = r.ok;
      } catch (err) {
        ghlOk = false;
        console.warn('[book] GHL webhook failed', err);
      }
    }

    // Restore button state (in case we need to retry)
    submitBtn.disabled = false;
    submitBtn.querySelector('.submit-default').hidden = false;
    submitBtn.querySelector('.submit-loading').hidden = true;

    if (!emailOk && keyConfigured) {
      showError('Something went wrong sending your request. Please try again, or call (512) 555-0100.');
      return;
    }

    // ---- Confirmation ----
    showConfirmation(fd, consultPretty, { emailOk, ghlOk, demo: !keyConfigured });
  });

  function showConfirmation(fd, consultPretty, status) {
    const name = (fd.get('name') || 'friend').toString().trim().split(' ')[0];
    const email = (fd.get('email') || '').toString().trim();
    const phone = (fd.get('phone') || '').toString().trim();
    const lane = (fd.get('lane') || '').toString().trim();
    const meeting = (fd.get('meeting_format') || '').toString().trim();

    document.getElementById('confirmName').textContent = name;

    const detail = document.getElementById('confirmDetail');
    if (isoInput.value) {
      detail.innerHTML = `Omni has your <strong style="color:var(--chrome)">${consultPretty}</strong> request. ` +
        `A calendar invite is on the way to <strong style="color:var(--cyan)">${escapeHtml(email)}</strong>, ` +
        `and you'll get a confirmation text the day before.`;
    } else {
      detail.innerHTML = `Omni will text <strong style="color:var(--cyan)">${escapeHtml(phone)}</strong> ` +
        `within one business hour with a few more time options.`;
    }

    // Build summary
    const summary = document.getElementById('confirmSummary');
    summary.innerHTML = '';
    const rows = [
      ['Name', fd.get('name')],
      ['Email', email],
      ['Phone', phone],
      ['Lane', lane],
      ['Budget', fd.get('budget')],
      ['Timeline', fd.get('timeline')],
      ['Location', fd.get('location')],
      ['Meeting', meeting],
      ['Requested time', consultPretty],
    ];
    rows.forEach(([k, v]) => {
      if (!v) return;
      const li = document.createElement('li');
      const isTime = k === 'Requested time';
      li.innerHTML = `<span class="k">${escapeHtml(k)}</span><span class="v ${isTime ? 'cyan' : ''}">${escapeHtml(String(v))}</span>`;
      summary.appendChild(li);
    });

    // If demo mode, append a small note (only visible on screen, not emailed)
    if (status.demo) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="k">Note</span><span class="v" style="color:var(--ink-soft)">Demo mode — email delivery not yet configured. Wire your Web3Forms key or GHL webhook to go live.</span>`;
      summary.appendChild(li);
    }

    form.hidden = true;
    document.getElementById('bookConfirm').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
})();
