/* =================================================================
   OMNI AI PROJECT GUIDE — Custom Chat Widget
   Demo / scripted version. Architecture supports drop-in LLM swap.

   To swap to live LLM later:
     - Replace `getBotResponse(state, userInput)` with an API call to
       OpenAI/Anthropic/GHL passing the system prompt + history
     - Replace `bookSlot(slot)` with GHL Calendar API call
     - Replace `submitLead(record)` with GHL contact-create webhook
   ================================================================= */

(function () {
  'use strict';

  // ----- IN-AREA CITY DETECTION (50-mi radius from Austin) ----------
  const IN_AREA = [
    'austin', 'round rock', 'cedar park', 'leander', 'pflugerville',
    'georgetown', 'hutto', 'lakeway', 'bee cave', 'west lake hills',
    'westlake', 'dripping springs', 'buda', 'kyle', 'manor', 'spicewood',
    'lago vista', 'jonestown', 'liberty hill', 'wimberley', 'driftwood',
    'bastrop', 'elgin', 'san marcos', 'new braunfels',
  ];
  const EDGE = ['marble falls', 'burnet', 'blanco', 'lockhart', 'smithville', 'taylor'];
  const OUT_OF_AREA = [
    'san antonio', 'houston', 'dallas', 'fort worth', 'dfw',
    'plano', 'frisco', 'arlington', 'irving', 'waco', 'fredericksburg',
    'college station', 'killeen', 'temple', 'el paso', 'lubbock',
    'corpus christi', 'galveston', 'tyler',
  ];

  function classifyLocation(text) {
    const t = text.toLowerCase().trim();
    for (const c of IN_AREA) if (t.includes(c)) return { status: 'in', city: c };
    for (const c of EDGE) if (t.includes(c)) return { status: 'edge', city: c };
    for (const c of OUT_OF_AREA) if (t.includes(c)) return { status: 'out', city: c };
    return { status: 'unknown', city: t };
  }

  // ----- LANE DETECTION FROM PROJECT TEXT ---------------------------
  function detectLane(text) {
    const t = text.toLowerCase();
    const newBuild = /\b(new (build|home|house|construction)|custom|ground.up|build.*home|teardown)\b/.test(t);
    const reno = /\b(remodel|renovat|reno|gut|whole.?home|whole.?house|update.*home|kitchen.*bath|primary suite)\b/.test(t);
    const addition = /\b(addition|casita|guest.?house|pool|pergola|outdoor|patio|deck|backyard|expansion|adu)\b/.test(t);
    if (newBuild) return 'new_build';
    if (reno) return 'reno';
    if (addition) return 'addition';
    return 'unclear';
  }

  // ----- LEAD RECORD ------------------------------------------------
  const lead = {
    lead_status: null,
    priority: 'Standard',
    lane: null,
    project_description: null,
    budget_band: null,
    budget_confidence: null,
    timeline: null,
    project_location: null,
    service_area_status: null,
    property_status: null,
    design_status: null,
    consult_booked: 'No',
    consult_time: null,
    meeting_platform: null,        // 'zoom' | 'google_meet' | 'phone'
    meeting_platform_label: null,  // human label
    referral_pending: 'No',
    referral_region: null,
    contact: { name: null, email: null, phone: null },
    transcript_summary: null,
    flags: [],
    transcript: [], // raw turn-by-turn
  };

  // ----- DOM SCAFFOLDING --------------------------------------------
  const launcher = document.createElement('button');
  launcher.className = 'chat-launcher';
  launcher.setAttribute('aria-label', 'Chat with Omni project guide');
  launcher.innerHTML = `
    <span class="launcher-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/>
        <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z"/>
      </svg>
      <span class="pulse-dot" aria-hidden="true"></span>
    </span>
    <span class="launcher-text">
      <span class="launcher-title">Talk to our Project Guide</span>
      <span class="launcher-sub">Friendly Instant Answers</span>
    </span>
  `;

  const panel = document.createElement('div');
  panel.className = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Omni project guide chat');
  panel.innerHTML = `
    <div class="chat-header">
      <div class="avatar" aria-hidden="true">O</div>
      <div class="meta">
        <span class="title">Omni Project Guide</span>
        <span class="status"><span class="dot"></span>Usually replies instantly</span>
      </div>
      <button class="close" aria-label="Close chat">×</button>
    </div>
    <div class="chat-messages" id="chatMessages" aria-live="polite"></div>
    <div class="chat-input">
      <textarea
        id="chatInput"
        placeholder="Type your answer…"
        rows="1"
        aria-label="Type your message"
      ></textarea>
      <button class="send-btn" id="chatSend" aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
    <div class="chat-footer-note">AI guide · Real conversation with Omni at the consult</div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('#chatMessages');
  const inputEl = panel.querySelector('#chatInput');
  const sendBtn = panel.querySelector('#chatSend');
  const closeBtn = panel.querySelector('.close');

  // ----- UI HELPERS -------------------------------------------------
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(text, who) {
    const div = document.createElement('div');
    div.className = `msg msg-${who}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
    lead.transcript.push({ role: who, text });
    return div;
  }

  function addRichMessage(html, who) {
    const div = document.createElement('div');
    div.className = `msg msg-${who}`;
    div.innerHTML = html;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'msg-typing';
    div.id = 'typingIndicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function clearTyping() {
    const t = document.getElementById('typingIndicator');
    if (t) t.remove();
  }

  function addChips(options, onPick) {
    const row = document.createElement('div');
    row.className = 'chip-row';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        // Disable all chips in this row
        row.querySelectorAll('.chip').forEach((c) => (c.disabled = true));
        row.style.opacity = '0.55';
        onPick(opt);
      });
      row.appendChild(btn);
    });
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function botSay(text, delay = 600) {
    return new Promise((resolve) => {
      const typing = showTyping();
      setTimeout(() => {
        clearTyping();
        addMessage(text, 'bot');
        resolve();
      }, delay);
    });
  }

  async function botSayMany(texts) {
    for (const t of texts) {
      await botSay(t, 700);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // ----- CONVERSATION STATE MACHINE ---------------------------------
  let stage = 'idle'; // idle → opened → t1_project → t2_budget → t3_timeline → t4_location → t4b_secondhome → t5_design → t6_book → t7_contact_name → t7_email → t7_phone → done

  // ----- HELPERS (intent / parsing) ---------------------------------
  // Recognize natural "end of conversation" phrases. Tolerant of contractions,
  // typos, leading filler ("ok", "yeah", "alright"), and trailing punctuation.
  function isGoodbye(text) {
    if (!text) return false;
    // Hard exclusions: never treat email-like or URL-like input as goodbye
    if (/[@]/.test(text) || /https?:\/\//i.test(text)) return false;
    // Normalize: lowercase, strip punctuation, collapse whitespace, expand common contractions
    let t = text.toLowerCase().trim();
    t = t.replace(/[.!?,;:—–]/g, ' ').replace(/\s+/g, ' ').trim();
    // Expand contractions and common typos
    t = t
      .replace(/\bi'?m\b|\bim\b/g, 'i am')
      .replace(/\bwe'?re\b|\bwere\b/g, 'we are')
      .replace(/\byou'?re\b/g, 'you are')
      .replace(/\bthat'?s\b|\bthats\b/g, 'that is')
      .replace(/\bit'?s\b|\bits\b/g, 'it is')
      .replace(/\bdon'?t\b|\bdont\b/g, 'do not')
      .replace(/\bain'?t\b/g, 'is not');
    // Strip very common filler prefixes once (not recursively, to avoid eating real content)
    t = t.replace(/^(yeah|yep|yup|yes|ok|okay|alright|alrighty|cool|great|sure|fine|well|hmm|umm?)\s+/, '');

    // 1. EXACT short responses (after stripping filler)
    const exact = new Set([
      'no', 'nope', 'nah', 'na', 'no thanks', 'no thank you', 'no thanks i am good',
      'thanks', 'thank you', 'thanks so much', 'thank you so much', 'thanks a lot',
      'thx', 'ty', 'tysm', 'thanx',
      'bye', 'goodbye', 'good bye', 'cya', 'see ya', 'see you', 'see you later',
      'later', 'talk later', 'talk to you later', 'ttyl', 'catch you later', 'peace',
      'goodnight', 'good night', 'have a good one', 'have a good day', 'have a great day',
      'k', 'kk', 'okay', 'ok', 'okie', 'okie dokie', 'cool', 'sweet', 'awesome',
      'sounds good', 'sounds great', 'perfect', 'great', 'good',
      'done', 'all done', 'i am done', 'we are done', 'we are done here',
      'all good', 'i am good', 'we are good', 'i am fine', 'we are fine', 'i am set', 'i am all set', 'we are all set', 'we are set',
      'good to go', 'ready to go', 'all set', 'set',
      'that is it', 'that is all', 'that will do', 'that should do it', 'that should do',
      'nothing', 'nothing else', 'nothing more', 'nothing for now',
      'no questions', 'no other questions', 'no more questions', 'no further questions',
      'i have no questions', 'i have no other questions', 'i have no more questions',
      'no not really', 'not really', 'not now', 'not at this time',
      'wrap', 'wrap it up', 'stop', 'end', 'exit', 'quit', 'close',
      'got it', 'got it thanks', 'understood', 'gotcha',
      'appreciate it', 'appreciate you', 'much appreciated',
      'sounds like a plan', 'works for me',
    ]);
    if (exact.has(t)) return true;

    // 2. PATTERN matches — phrases that compose freely
    const patterns = [
      // "i am done/good/set/fine/all set/finished/ready/cool" + optional trailing thanks/bye
      /^i am (done|good|set|fine|all set|finished|ready|cool|happy|satisfied)\b/,
      /^we are (done|good|set|fine|all set|finished|ready|cool)\b/,
      // "i think we are done/good/set"
      /^i think (we are|i am) (done|good|set|fine|all set|finished)\b/,
      // "that is (it|all|enough|good)" with optional trailing
      /^that is (it|all|enough|good|fine|plenty|the one|perfect)\b/,
      /^that will (do|work)\b/,
      /^that works\b/,
      // "no" + qualifier ("no thanks", "no I'm good", "no questions", "no more", "no other")
      /^no\b.*\b(thanks?|thank you|good|fine|set|done|questions?|more|other|further|else)\b/,
      /^nope\b/, /^nah\b/,
      // "goodbye" / "bye" / "thanks bye"
      /\b(bye|goodbye|cya|peace out|farewell)\b/,
      // "see you" / "see ya" / "talk to you later" / "later thanks"
      /^(see (you|ya)|talk (to you )?later|catch you later|ttyl)\b/,
      /^later\b.{0,20}$/,
      // pure thanks (any variation)
      /^(thanks?|thank you|thx|ty|tysm)\b.{0,30}$/,
      // "have a good/great ___"
      /^have a (good|great|nice) (one|day|night|evening|weekend)/,
      // "good night", "goodnight"
      /^good ?night\b/,
      // "alright", "alrighty" alone or with trailing thanks
      /^alright(y)?\b.{0,20}$/,
      // "all done/good/set" alone
      /^all (done|good|set|finished)\b/,
      // "got it (thanks)" alone
      /^got it\b.{0,15}$/,
      // "appreciate it/you"
      /^(i )?appreciate (it|you|your time|your help)\b/,
      // "sounds good/great"
      /^sounds (good|great|like a plan|fine)\b/,
      // "perfect" / "awesome" / "sweet" alone
      /^(perfect|awesome|sweet|excellent|wonderful)\b.{0,15}$/,
      // "ok/okay/k/kk/cool" alone
      /^(ok|okay|k|kk|cool)\b.{0,15}$/,
      // explicit close commands
      /^(stop|end|exit|quit|close|wrap|wrap it up|wrap up)\b/,
      // "not (now|really|at this time|today)"
      /^not (now|really|at this time|today|right now|at the moment)\b/,
      // "i have no (questions|other questions|more questions|further questions)"
      /^i have no (more |other |further )?questions?\b/,
      // "nothing (else|more|for now)"
      /^nothing\b.{0,20}$/,
      // "good to go" / "ready to go"
      /^(good|ready) to go\b/,
      // "works for me" / "that works"
      /^(that )?works for me\b/,
    ];
    return patterns.some((re) => re.test(t));
  }

  function firstName() {
    if (!lead.contact.name) return '';
    return lead.contact.name.trim().split(/\s+/)[0];
  }

  // ----- TURN HANDLERS ----------------------------------------------
  async function turn1_open() {
    stage = 't0_name';
    await botSay(
      "Hey — I'm Omni's project guide. I can usually tell in about 2 minutes if we're a good fit, and get you on the Omni calendar if so."
    );
    await botSay("Before we dive in — what's your name?");
  }

  async function handleInitialName(text) {
    // Lightweight validation — reject obvious non-names
    const cleaned = text.trim();
    if (cleaned.length < 2 || cleaned.length > 60 || /[@\d]/.test(cleaned)) {
      await botSay("Just your first name works — what should I call you?");
      return;
    }
    lead.contact.name = cleaned;
    stage = 't1_project';
    const fn = firstName();
    await botSay(`Nice to meet you, ${fn}.`);
    await botSay(
      `So tell me ${fn} — what are you dreaming about? A new build, a major remodel, or adding onto what you already have?`
    );
  }

  async function turn2_budget(projectText) {
    lead.project_description = projectText;
    const lane = detectLane(projectText);
    lead.lane = {
      addition: 'Additions/Casitas/Outdoor',
      reno: 'Major Reno',
      new_build: 'Custom New Build',
      unclear: 'Unclear',
    }[lane];

    // Reflect + seed range
    const reflections = {
      addition:
        "Love that — outdoor and addition projects are probably half of what we build right now. Most casita, pool, and addition projects land between $400K and $900K depending on size and finish level.",
      reno:
        "Got it — major reno territory. Those usually run $400K to $1.5M depending on whether we're moving walls and what the kitchen and primary suite look like.",
      new_build:
        "Nice. Custom builds are our most involved lane — typically $700K to $3M+ depending on lot, square footage, and finish.",
      unclear:
        "Got it. Tell me a little more if you want — but for now, every project we do generally lands somewhere between $300K and $3M depending on scope.",
    };
    await botSay(reflections[lane]);

    await botSay(
      "Most projects like yours land in one of these ranges. Where does your thinking fit — and totally fine if you don't know yet, that's actually what the consult is for."
    );

    stage = 't2_budget';
    addChips(
      [
        { label: '💭 Not sure yet', value: 'Not sure' },
        { label: 'Under $300K', value: 'Under $300K' },
        { label: '$300K–$700K', value: '$300K-$700K' },
        { label: '$700K–$1.5M', value: '$700K-$1.5M' },
        { label: '$1.5M+', value: '$1.5M+' },
      ],
      (opt) => handleBudget(opt)
    );
  }

  async function handleBudget(opt) {
    addMessage(opt.label, 'user');
    lead.budget_band = opt.value;
    lead.budget_confidence = 'Stated';

    const reactions = {
      'Not sure':
        "Smart answer — honestly, most people don't know until they've talked to a builder. Quick frame so it's not a mystery: our smallest projects start around $300K, most land between $400K and $900K, and full customs run $1M+. The consult is exactly where Omni helps you figure out where your scope realistically lands.",
      'Under $300K':
        "Appreciate you being upfront. Honest take: a lot of what we do at that range gets tight because of how we staff design + build in-house — but it's not always a no. Smaller outdoor projects or single-room renos can land here, and Omni will tell you straight whether your scope pencils.",
      '$300K-$700K':
        "Right in our sweet spot. About 40% of what we build lands here — usually casitas, pool + outdoor living packages, or major kitchen and primary suite remodels.",
      '$700K-$1.5M':
        "Premium range — we love these projects. Full additions, whole-home renos, smaller custom builds. This is where in-house design really pays off because the scope gets complex.",
      '$1.5M+':
        "Trophy range. We do a handful of these every year — typically full custom homes on Hill Country lots or whole-home transformations. Omni will want to talk with you personally, probably this week.",
    };
    if (opt.value === '$1.5M+') {
      lead.priority = 'High';
      lead.flags.push('High budget');
    }
    await botSay(reactions[opt.value]);
    await turn3_timeline();
  }

  async function turn3_timeline() {
    await botSay(
      "We just wrapped a similar project in Leander — pool, casita, and outdoor kitchen. From design kickoff to permit was about 9 weeks."
    );
    await botSay(
      "Where are you in your own timeline — ready to start in the next month or two, 3 to 6 months out, or just exploring?"
    );

    stage = 't3_timeline';
    addChips(
      [
        { label: 'Ready in 1-2 months', value: 'Ready now' },
        { label: '3-6 months out', value: '3-6 months' },
        { label: 'Just exploring', value: '6+ months / exploring' },
      ],
      (opt) => handleTimeline(opt)
    );
  }

  async function handleTimeline(opt) {
    addMessage(opt.label, 'user');
    lead.timeline = opt.value;
    const fn = firstName();
    if (opt.value === 'Ready now') {
      await botSay(`Good ${fn} — that's the window where we can do design right.`);
      if (lead.budget_band === '$700K-$1.5M' || lead.budget_band === '$1.5M+') {
        lead.priority = 'High';
        lead.flags.push('Hot lead — ready + premium budget');
      }
    } else if (opt.value === '3-6 months') {
      await botSay("Perfect window — that gives us time to get design right before you break ground.");
    } else {
      await botSay("Totally fine — exploration stage is when smart homeowners shop builders. No pressure to decide today.");
    }
    await turn4_location();
  }

  async function turn4_location() {
    const fn = firstName();
    await botSay(
      `Quick logistics question${fn ? ', ' + fn : ''}: where's the property? We work all across Austin metro and the Hill Country — about a 50-mile radius from Austin.`
    );
    stage = 't4_location';
  }

  async function handleLocation(text) {
    lead.project_location = text;
    const result = classifyLocation(text);

    if (result.status === 'in') {
      lead.service_area_status = 'In-area';
      await botSay(`Perfect — we work in ${capitalize(result.city)} a lot. Great area.`);
      await turn5_design();
    } else if (result.status === 'edge') {
      lead.service_area_status = 'Edge case';
      lead.flags.push('Edge of service area');
      await botSay(
        `${capitalize(result.city)} is right at the edge of our service area — we do work there but it depends on the project size. Worth a conversation with Omni so we can tell you whether it pencils with the drive time.`
      );
      await turn5_design();
    } else if (result.status === 'out') {
      lead.service_area_status = 'Out-of-area';
      // Second-home check
      stage = 't4b_secondhome';
      await botSay(
        `Ah, ${capitalize(result.city)} is outside our 50-mile service area. Quick check though — is the project actually in ${capitalize(result.city)}, or are you building or renovating somewhere closer to Austin?`
      );
      addChips(
        [
          { label: `Project is in ${capitalize(result.city)}`, value: 'truly_out' },
          { label: 'Project is closer to Austin', value: 'in_austin' },
        ],
        (opt) => handleSecondHome(opt, result.city)
      );
    } else {
      // Unknown — ask again
      await botSay("I didn't catch a city I recognize. Can you tell me the city or town the property's in?");
    }
  }

  async function handleSecondHome(opt, originalCity) {
    addMessage(opt.label, 'user');
    const fn = firstName();
    if (opt.value === 'in_austin') {
      lead.service_area_status = 'In-area';
      await botSay(`Got it ${fn} — much better. What city or area is the property in?`);
      stage = 't4_location';
    } else {
      // Out of area, route to referral. Name already captured at start.
      lead.service_area_status = 'Out-of-area';
      lead.lead_status = 'Referral Out';
      lead.referral_pending = 'Yes';
      lead.referral_region = capitalize(originalCity);
      await botSay(
        `Got it ${fn}. We stay focused around Austin so we can show up on-site weekly without the drive eating into your project.`
      );
      await botSay(
        `Here's what I can do: we keep a short list of trusted builders in the ${capitalize(originalCity)} area — folks who work the way we do. Drop your email and Omni will personally send you 2-3 names this week with a note on which one we'd recommend for your project.`
      );
      stage = 't_referral_email';
      await botSay("What's the best email for Omni to send the referrals to?");
    }
  }

  async function turn5_design() {
    await botSay(
      "One thing that might matter to you: we do design, engineering, and build all in-house. Most Austin builders make you hire an architect separately and play telephone between teams."
    );
    await botSay("Do you already have plans drawn up, or would you want our designer involved from the start?");

    stage = 't5_design';
    addChips(
      [
        { label: 'I have plans already', value: 'Has plans' },
        { label: 'I need design help', value: 'Needs design help' },
        { label: 'Somewhere in between', value: 'In between' },
      ],
      (opt) => handleDesign(opt)
    );
  }

  async function handleDesign(opt) {
    addMessage(opt.label, 'user');
    lead.design_status = opt.value;
    if (opt.value === 'Needs design help') {
      lead.flags.push('Needs design — Omni sweet spot');
      await botSay(
        "That's actually where we shine — most of our best projects start with a blank page and our designer."
      );
    } else if (opt.value === 'Has plans') {
      await botSay("Great — we can absolutely work from existing plans, and our team will pressure-test them before we price.");
    } else {
      await botSay("Most of our clients land there. We'll meet you wherever you are.");
    }
    await turn6_book();
  }

  async function turn6_book() {
    // Decide fit signal
    let fit = 'promising fit';
    if (
      (lead.budget_band === '$300K-$700K' || lead.budget_band === '$700K-$1.5M' || lead.budget_band === '$1.5M+') &&
      lead.service_area_status === 'In-area'
    ) {
      fit = 'strong fit';
    } else if (lead.budget_band === 'Under $300K') {
      fit = 'worth a conversation';
    }

    lead.lead_status = 'Qualified';
    const fn = firstName();

    await botSay(`Based on what you've shared ${fn}, I'd put this at a ${fit}.`);
    await botSay(
      "Want me to grab Omni 30 minutes? Here are the next open windows — pick whichever works:"
    );

    stage = 't6_book';
    showBookingCard(0); // 0 = next 3 days; 1 = days 4-7
  }

  function showBookingCard(window) {
    const slots = getSlotsForWindow(window);
    const card = document.createElement('div');
    card.className = 'booking-card';
    const headline = window === 0 ? 'Next 3 days with Omni' : 'Later this week';
    const moreLabel = window === 0 ? 'Show me later this week →' : '← Back to next 3 days';

    card.innerHTML = `
      <h4>${headline}</h4>
      <div class="slots slots-grid-3">
        ${slots.map((s, i) => `
          <button class="slot" data-slot="${i}">
            <strong>${s.label}</strong>
            ${s.time}
          </button>
        `).join('')}
      </div>
      <button class="more-times">${moreLabel}</button>
      <button class="none-work">None of these work →</button>
    `;
    messagesEl.appendChild(card);
    scrollToBottom();

    card.querySelectorAll('.slot').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        // disable all booking cards in the chat
        document.querySelectorAll('.booking-card').forEach((c) => {
          c.querySelectorAll('button').forEach((b) => (b.disabled = true));
          c.style.opacity = '0.55';
        });
        handleBooking(slots[idx]);
      });
    });
    card.querySelector('.more-times').addEventListener('click', () => {
      card.querySelectorAll('button').forEach((b) => (b.disabled = true));
      card.style.opacity = '0.55';
      // Toggle between window 0 and window 1
      showBookingCard(window === 0 ? 1 : 0);
    });
    card.querySelector('.none-work').addEventListener('click', () => {
      document.querySelectorAll('.booking-card').forEach((c) => {
        c.querySelectorAll('button').forEach((b) => (b.disabled = true));
        c.style.opacity = '0.55';
      });
      handleBooking({ label: 'Send more times', time: 'TBD', iso: null });
    });
  }

  function getSlotsForWindow(window) {
    // window 0: days 1-3 from now (next 3 days)
    // window 1: days 4-7 from now (rest of the week)
    const now = new Date();
    const slots = [];
    const dayStart = window === 0 ? 1 : 4;
    const dayEnd = window === 0 ? 3 : 7;
    const fmtDate = { weekday: 'short', month: 'short', day: 'numeric' };

    for (let offset = dayStart; offset <= dayEnd; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      // Skip Sundays — not a typical builder consult day
      if (d.getDay() === 0) continue;

      // Two slots per day: morning + afternoon
      const am = new Date(d); am.setHours(10, 0, 0, 0);
      const pm = new Date(d); pm.setHours(14, 0, 0, 0);
      const dateLabel = d.toLocaleDateString('en-US', fmtDate);
      slots.push({ label: dateLabel, time: '10:00 AM CT', iso: am.toISOString() });
      slots.push({ label: dateLabel, time: '2:00 PM CT', iso: pm.toISOString() });
    }
    // Cap to keep card compact: 6 for window 0, up to 8 for window 1
    return window === 0 ? slots.slice(0, 6) : slots.slice(0, 8);
  }

  async function handleBooking(slot) {
    const fn = firstName();
    if (slot.iso) {
      addMessage(`${slot.label} at ${slot.time}`, 'user');
      lead.consult_booked = 'Pending';
      lead.consult_time = slot.iso;
      await botSay(`Locked in${fn ? ', ' + fn : ''}. Just need your email and cell to send the calendar invite.`);
    } else {
      addMessage('Send me more times', 'user');
      lead.consult_booked = 'Pending';
      await botSay(`No problem${fn ? ', ' + fn : ''} — Omni will text you a few more options. Just need your email and cell first.`);
    }
    stage = 't7_email';
    await botSay("What's the best email?");
  }

  // ---- Contact capture turns ----
  async function handleContactEmail(text) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await botSay("Hmm, that doesn't look like a valid email. Try again?");
      return;
    }
    lead.contact.email = text;
    stage = 't7_phone';
    await botSay("Perfect. And the best cell number? (Omni will text the day before to confirm.)");
  }
  async function handleContactPhone(text) {
    const phoneClean = text.replace(/\D/g, '');
    if (phoneClean.length < 10) {
      await botSay("Need a 10-digit number — try again?");
      return;
    }
    lead.contact.phone = text;
    await finalizeBooked();
  }

  async function finalizeBooked() {
    stage = 'done';
    lead.lead_status = lead.lead_status || 'Qualified';
    lead.consult_booked = lead.consult_time ? 'Yes' : 'Pending';
    lead.transcript_summary = buildSummary();
    const fn = firstName();

    if (lead.consult_time) {
      const dt = new Date(lead.consult_time);
      const fmt = { weekday: 'long', month: 'long', day: 'numeric' };
      await botSay(
        `Done${fn ? ', ' + fn : ''}. ${dt.toLocaleDateString('en-US', fmt)} at ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. You'll get a calendar invite at ${lead.contact.email} and a confirmation text the day before.`
      );
    } else {
      await botSay(
        `Done${fn ? ', ' + fn : ''}. Omni will text ${lead.contact.phone} within one business hour with a few more time options.`
      );
    }
    await botSay("Anything specific you want Omni to come prepared with? Or you can just say 'all set' and we'll wrap.");
    submitLead(lead);
  }

  async function handleWrapUp(userText) {
    const fn = firstName();
    if (isGoodbye(userText)) {
      // Graceful end
      stage = 'closed';
      if (lead.lead_status === 'Referral Out') {
        await botSay(`Good luck${fn ? ', ' + fn : ''}. Watch your inbox for those builder picks.`);
      } else if (lead.consult_time) {
        const dt = new Date(lead.consult_time);
        const fmt = { weekday: 'long', month: 'short', day: 'numeric' };
        await botSay(
          `${fn ? fn + ' — ' : ''}you're all set. See Omni ${dt.toLocaleDateString('en-US', fmt)}.`
        );
      } else {
        await botSay(`Sounds good${fn ? ', ' + fn : ''}. Omni will be in touch shortly.`);
      }
      await botSay("You can close this window whenever. Thanks for reaching out to Omni.");
      return true;
    }
    return false;
  }

  // ---- Referral flow contact capture (name already captured at start) ----
  async function handleReferralEmail(text) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await botSay("That doesn't look like a valid email — try again?");
      return;
    }
    lead.contact.email = text;
    lead.lead_status = 'Referral Out';
    lead.transcript_summary = buildSummary();
    const fn = firstName();
    await botSay(
      `Got it${fn ? ', ' + fn : ''}. Omni will personally send you 2-3 builder recommendations within the next 2 business days.`
    );
    await botSay("Good luck with the project. Anything else, or are we good here?");
    stage = 'done';
    submitLead(lead);
  }

  // ----- USER INPUT HANDLER -----------------------------------------
  async function handleUserInput(text) {
    if (!text.trim()) return;
    addMessage(text, 'user');

    // Global goodbye detection — if user says wrap-up phrase mid-flow,
    // capture what we have and end gracefully (only after we have a name)
    if (lead.contact.name && stage !== 't0_name' && isGoodbye(text)) {
      // If we had a meaningful conversation, save it
      if (!lead.lead_status) {
        lead.lead_status = lead.contact.email ? 'Qualified' : 'Nurture';
        lead.transcript_summary = buildSummary();
        submitLead(lead);
      }
      const handled = await handleWrapUp(text);
      if (handled) return;
    }

    switch (stage) {
      case 't0_name':
        await handleInitialName(text);
        break;
      case 't1_project':
        await turn2_budget(text);
        break;
      case 't4_location':
        await handleLocation(text);
        break;
      case 't7_email':
        await handleContactEmail(text);
        break;
      case 't7_phone':
        await handleContactPhone(text);
        break;
      case 't_referral_email':
        await handleReferralEmail(text);
        break;
      case 'qb_name':
        await handleQuickBookName(text);
        break;
      case 'qb_email':
        await handleQuickBookEmail(text);
        break;
      case 'qb_phone':
        await handleQuickBookPhone(text);
        break;
      case 'qb_platform':
        await botSay("Tap one of the meeting options above — Zoom, Google Meet, or Phone.");
        break;
      case 'qb_slot':
        await botSay("Tap one of the time slots above to pick your consult time.");
        break;
      case 'done': {
        const ended = await handleWrapUp(text);
        if (!ended) {
          // They added a real prep note
          lead.flags.push(`Consult prep note: ${text.slice(0, 120)}`);
          await botSay(`Got it — I'll make sure the Omni team sees that. Anything else, or are you all set?`);
        }
        break;
      }
      case 'closed':
        // Conversation already wrapped — reopen if user types again
        await botSay("Want me to grab Omni for another time, or pass along a question?");
        stage = 'done';
        break;
      default:
        await botSay("Tap one of the options above to keep going.");
    }
  }

  // ----- HELPERS ----------------------------------------------------
  function capitalize(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function buildSummary() {
    const parts = [];
    if (lead.lane) parts.push(lead.lane);
    if (lead.project_description) parts.push(`"${lead.project_description.slice(0, 60)}"`);
    if (lead.budget_band) parts.push(`Budget: ${lead.budget_band}`);
    if (lead.timeline) parts.push(`Timeline: ${lead.timeline}`);
    if (lead.project_location) parts.push(`Location: ${lead.project_location}`);
    if (lead.design_status) parts.push(`Design: ${lead.design_status}`);
    return parts.join(' · ');
  }

  // ----- LEAD SUBMISSION (demo: in-memory log; prod: GHL API) --
  const _omniLeads = [];
  function submitLead(record) {
    console.log('[Omni Lead Captured]', record);
    try {
      _omniLeads.push({ ...record, captured_at: new Date().toISOString() });
    } catch (e) {}
    // PRODUCTION: replace with fetch to GHL contact-create webhook
    // fetch('https://services.leadconnectorhq.com/contacts/', { method: 'POST', ... })
  }

  // ===================================================================
  // QUICK-BOOK WIZARD (entry point: "Book a 30-min consult" buttons)
  // Streamlined flow: name → email → phone → slot → confirm → thank you
  // ===================================================================
  async function startQuickBook() {
    stage = 'qb_name';
    lead.lead_status = 'Booking';
    await botSay("Let's get you on the calendar with Omni — takes about 30 seconds.");
    await botSay("What's your name?");
  }

  async function handleQuickBookName(text) {
    const cleaned = text.trim();
    if (cleaned.length < 2 || cleaned.length > 60 || /[@\d]/.test(cleaned)) {
      await botSay("Just your first name works — what should I call you?");
      return;
    }
    lead.contact.name = cleaned;
    stage = 'qb_email';
    const fn = firstName();
    await botSay(`Thanks, ${fn}. What's the best email for the calendar invite?`);
  }

  async function handleQuickBookEmail(text) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
      await botSay("Hmm, that doesn't look like a valid email. Try again?");
      return;
    }
    lead.contact.email = text.trim();
    stage = 'qb_phone';
    await botSay("And the best cell number? (Omni will text the day before to confirm.)");
  }

  async function handleQuickBookPhone(text) {
    const phoneClean = text.replace(/\D/g, '');
    if (phoneClean.length < 10) {
      await botSay("Need a 10-digit number — try again?");
      return;
    }
    lead.contact.phone = text.trim();
    stage = 'qb_platform';
    await botSay("How would you like to meet? You can switch later if needed.");
    showPlatformPicker();
  }

  function showPlatformPicker() {
    const card = document.createElement('div');
    card.className = 'booking-card qb-platform-card';
    card.innerHTML = `
      <div class="platform-options">
        <button class="platform-opt" data-platform="zoom">
          <span class="platform-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#2D8CFF"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M17 9l5-3v12l-5-3z"/></svg>
          </span>
          <span class="platform-text">
            <strong>Zoom</strong>
            <em>Video call · link emailed</em>
          </span>
        </button>
        <button class="platform-opt" data-platform="google_meet">
          <span class="platform-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="13" height="10" rx="1.5" fill="#00832D"/><path d="M15 10l5-3v10l-5-3z" fill="#00AC47"/><rect x="15" y="10" width="3" height="4" fill="#FFBA00"/></svg>
          </span>
          <span class="platform-text">
            <strong>Google Meet</strong>
            <em>Video call · link emailed</em>
          </span>
        </button>
        <button class="platform-opt" data-platform="phone">
          <span class="platform-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5BC8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </span>
          <span class="platform-text">
            <strong>Phone call</strong>
            <em>Omni will call you</em>
          </span>
        </button>
      </div>
    `;
    messagesEl.appendChild(card);
    scrollToBottom();

    card.querySelectorAll('.platform-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        const labels = { zoom: 'Zoom', google_meet: 'Google Meet', phone: 'Phone call' };
        card.querySelectorAll('.platform-opt').forEach((b) => (b.disabled = true));
        btn.classList.add('selected');
        addMessage(labels[platform], 'user');
        lead.meeting_platform = platform;
        lead.meeting_platform_label = labels[platform];
        proceedToSlotPicker();
      });
    });
  }

  async function proceedToSlotPicker() {
    stage = 'qb_slot';
    await botSay("Great. Pick a time that works — these are the next 3 days. Hit “Show me later this week” if you'd rather see further out.");
    showQuickBookCard(0);
  }

  function showQuickBookCard(window) {
    const slots = getSlotsForWindow(window);
    const card = document.createElement('div');
    card.className = 'booking-card qb-card';
    const headline = window === 0 ? 'Next 3 days with Omni' : 'Later this week';
    const moreLabel = window === 0 ? 'Show me later this week →' : '← Back to next 3 days';

    card.innerHTML = `
      <h4>${headline}</h4>
      <div class="slots slots-grid-3">
        ${slots.map((s, i) => `
          <button class="slot" data-slot="${i}">
            <strong>${s.label}</strong>
            ${s.time}
          </button>
        `).join('')}
      </div>
      <button class="more-times">${moreLabel}</button>
    `;
    messagesEl.appendChild(card);
    scrollToBottom();

    card.querySelectorAll('.slot').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        // Lock the selected slot in card UI
        card.querySelectorAll('.slot').forEach((b) => (b.disabled = true));
        card.querySelector('.more-times').disabled = true;
        btn.classList.add('selected');
        showQuickBookConfirm(slots[idx]);
      });
    });
    card.querySelector('.more-times').addEventListener('click', () => {
      card.querySelectorAll('button').forEach((b) => (b.disabled = true));
      card.style.opacity = '0.55';
      showQuickBookCard(window === 0 ? 1 : 0);
    });
  }

  function showQuickBookConfirm(slot) {
    const fn = firstName();
    const dt = new Date(slot.iso);
    const fmt = { weekday: 'long', month: 'long', day: 'numeric' };
    const dateStr = dt.toLocaleDateString('en-US', fmt);
    const timeStr = slot.time;
    const platformLabel = lead.meeting_platform_label || 'Video call';

    addMessage(`${slot.label} at ${slot.time}`, 'user');

    // Confirmation summary card with submit button
    const card = document.createElement('div');
    card.className = 'booking-card qb-confirm-card';
    card.innerHTML = `
      <h4>Confirm your consult</h4>
      <ul class="qb-summary">
        <li><span>Name</span><strong>${escapeHtml(lead.contact.name)}</strong></li>
        <li><span>Email</span><strong>${escapeHtml(lead.contact.email)}</strong></li>
        <li><span>Phone</span><strong>${escapeHtml(lead.contact.phone)}</strong></li>
        <li><span>Meeting</span><strong>${escapeHtml(platformLabel)}</strong></li>
        <li><span>When</span><strong>${dateStr}<br>${timeStr}</strong></li>
      </ul>
      <button class="qb-submit">Confirm & Book →</button>
      <button class="qb-edit">← Pick a different time</button>
    `;
    messagesEl.appendChild(card);
    scrollToBottom();

    card.querySelector('.qb-submit').addEventListener('click', () => {
      card.querySelector('.qb-submit').disabled = true;
      card.querySelector('.qb-edit').disabled = true;
      card.querySelector('.qb-submit').textContent = 'Booking…';
      finalizeQuickBook(slot, dateStr, timeStr);
    });
    card.querySelector('.qb-edit').addEventListener('click', () => {
      card.remove();
      // Re-render the slot picker (window 0)
      stage = 'qb_slot';
      showQuickBookCard(0);
    });
  }

  async function finalizeQuickBook(slot, dateStr, timeStr) {
    lead.consult_time = slot.iso;
    lead.consult_booked = 'Yes';
    lead.lead_status = 'Booked';
    lead.transcript_summary = buildSummary() || `Quick book — ${dateStr} ${timeStr}`;
    stage = 'done';
    submitLead(lead);

    const fn = firstName();
    const platform = lead.meeting_platform;
    const platformLabel = lead.meeting_platform_label || 'Video call';
    let platformLine;
    if (platform === 'zoom') {
      platformLine = `A Zoom link and calendar invite are on the way to ${lead.contact.email}.`;
    } else if (platform === 'google_meet') {
      platformLine = `A Google Meet link and calendar invite are on the way to ${lead.contact.email}.`;
    } else if (platform === 'phone') {
      platformLine = `Omni will call you at ${lead.contact.phone}. A calendar invite is on the way to ${lead.contact.email}.`;
    } else {
      platformLine = `A calendar invite is on the way to ${lead.contact.email}.`;
    }

    await botSay(`🎉 You're booked, ${fn}.`);
    await botSay(`${dateStr} at ${timeStr} — ${platformLabel}.`);
    await botSay(`${platformLine} Omni will text ${lead.contact.phone} the day before to confirm.`);
    await botSay("Anything you'd like Omni to come prepared with? Or you can close this whenever — you're all set.");
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ----- WIDGET OPEN/CLOSE ------------------------------------------
  let started = false;
  function openChat(opts) {
    panel.classList.add('is-open');
    launcher.classList.add('is-hidden');
    if (!started) {
      started = true;
      if (opts && opts.mode === 'book') {
        setTimeout(() => startQuickBook(), 300);
      } else {
        setTimeout(() => turn1_open(), 300);
      }
    } else if (opts && opts.mode === 'book' && stage !== 'qb_slot' && stage !== 'done' && stage !== 'qb_email' && stage !== 'qb_phone' && stage !== 'qb_name') {
      // Already chatting in qualification mode — just bring panel to front, don't restart
    }
  }
  function closeChat() {
    panel.classList.remove('is-open');
    launcher.classList.remove('is-hidden');
  }

  launcher.addEventListener('click', () => openChat());
  closeBtn.addEventListener('click', closeChat);

  // Expose API so on-page CTAs can launch the booking wizard
  window.OmniChat = {
    openBooking: () => openChat({ mode: 'book' }),
    open: () => openChat(),
    close: closeChat,
  };

  // Auto-wire any element with [data-omni-book] or links pointing to #book
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-omni-book], a[href="#book"]');
    if (target) {
      e.preventDefault();
      window.OmniChat.openBooking();
    }
  });

  // Send button + Enter
  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleUserInput(text);
  }
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ----- AUTO-PROMPT (subtle nudge after the visitor scrolls into the page) --------------
  let nudged = false;
  window.addEventListener('scroll', () => {
    if (nudged) return;
    if (window.scrollY > 600) {
      nudged = true;
      launcher.classList.add('is-nudging');
      launcher.addEventListener('animationend', function onEnd(e) {
        if (e.animationName === 'launcherNudge') {
          launcher.classList.remove('is-nudging');
          launcher.removeEventListener('animationend', onEnd);
        }
      });
    }
  }, { passive: true });
})();
