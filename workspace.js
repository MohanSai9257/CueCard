(() => {
  if (new URLSearchParams(location.search).has('overlay')) return;
  const find = (selector) => document.querySelector(selector);
  const controls = find('.traffic-lights');
  const desktopDrag = find('.desktop-drag');
  let windowsTitlebar;
  function configureWindowControls(platform = window.cuecard.platform) {
    const windows = platform === 'win32';
    document.body.classList.toggle('windows-desktop', windows);
    const close = find('#desktopClose');
    const minimize = find('#desktopMinimize');
    const maximize = find('#desktopMaximize');
    if (windows) {
      if (!windowsTitlebar) {
        windowsTitlebar = document.createElement('div');
        windowsTitlebar.className = 'windows-titlebar';
        const name = document.createElement('span');
        name.textContent = 'CueCard';
        windowsTitlebar.append(name);
        document.querySelector('main').before(windowsTitlebar);
        windowsTitlebar.addEventListener('dblclick', (event) => {
          if (!event.target.closest('button')) window.cuecard.maximize();
        });
      }
      controls.setAttribute('aria-label', 'Window controls');
      controls.setAttribute('role', 'group');
      windowsTitlebar.append(controls);
      controls.append(minimize, maximize, close);
      minimize.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10"/></svg>';
      maximize.innerHTML =
        '<svg class="maximize-icon" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9"/></svg><svg class="restore-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5v-2h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/></svg>';
      close.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9"/></svg>';
      close.setAttribute('aria-label', 'Close CueCard');
      maximize.setAttribute(
        'aria-label',
        controls.classList.contains('is-maximized') ? 'Restore CueCard' : 'Maximize CueCard',
      );
    } else {
      desktopDrag.append(controls);
      controls.append(close, minimize, maximize);
      for (const button of [close, minimize, maximize]) button.replaceChildren();
      close.setAttribute('aria-label', 'Quit CueCard');
      maximize.setAttribute('aria-label', 'Resize CueCard');
      windowsTitlebar?.remove();
      windowsTitlebar = null;
    }
  }
  configureWindowControls();
  window.cuecard.onMaximized((maximized) => {
    controls.classList.toggle('is-maximized', maximized);
    if (document.body.classList.contains('windows-desktop'))
      find('#desktopMaximize').setAttribute('aria-label', maximized ? 'Restore CueCard' : 'Maximize CueCard');
  });
  const providers = window.CueProviders;
  let statuses = {};
  let sessions = [];
  let filter = 'all';
  const date = (value) =>
    value
      ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'Not saved yet';
  function notice(message) {
    find('#workspaceNotice').textContent = message;
    find('#workspaceNotice').classList.toggle('hidden', !message);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function summary() {
    const provider = find('#provider').value;
    const ready = statuses[provider]?.saved && statuses.deepgram?.saved;
    find('#sessionKeyDot').classList.toggle('ready', !!ready);
    find('#sessionKeyStatus').textContent = ready
      ? `${providers[provider].name} + Deepgram keys saved`
      : 'Add your AI provider and Deepgram keys in API Keys';
  }
  async function refreshKeys() {
    try {
      statuses = await window.cuecard.keysStatus();
      summary();
      renderKeys();
    } catch (error) {
      notice(error.message);
    }
  }
  function renderKeys() {
    const drafts = new Map(
      [...document.querySelectorAll('.key-input')].map((input) => [input.dataset.provider, input.value]),
    );
    const cards = find('#keyCards');
    cards.replaceChildren();
    for (const [provider, info] of Object.entries(providers)) {
      const state = statuses[provider] || {};
      const card = element('article', 'key-card');
      const heading = element('div', 'key-card-heading');
      const badge = element('span', `provider-badge ${provider}`, info.mark);
      const title = element('div', 'provider-title');
      title.append(element('h3', '', info.name), element('p', '', info.detail));
      const status = element(
        'span',
        `key-status ${state.saved ? 'saved' : ''}`,
        state.verified ? '● Connected' : state.saved ? '● Saved' : 'Not configured',
      );
      const updated = element('span', 'key-updated', `Last updated\n${date(state.updatedAt)}`);
      heading.append(badge, title, status, updated);
      const label = element(
        'label',
        'key-field',
        provider === 'deepgram' ? 'Live transcription key' : 'API key',
      );
      const row = element('div', 'key-entry-row');
      const inputBox = element('div', 'key-input-box');
      const input = element('input', 'key-input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.provider = provider;
      input.id = `savedKey-${provider}`;
      input.setAttribute('aria-label', `${info.name} API key`);
      input.placeholder = state.saved
        ? '••••••••••••••••••••••••••••••••'
        : `Paste your ${info.name} API key`;
      input.value = drafts.get(provider) || '';
      const reveal = element('button', 'reveal-key', '◉');
      reveal.type = 'button';
      reveal.setAttribute('aria-label', `Show ${info.name} key`);
      reveal.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
      let revealTimer;
      const hideKey = () => {
        input.type = 'password';
        if (input.dataset.revealed === 'true') input.value = '';
        delete input.dataset.revealed;
        reveal.setAttribute('aria-label', `Show ${info.name} key`);
      };
      input.addEventListener('input', () => {
        delete input.dataset.revealed;
      });
      reveal.addEventListener('click', async () => {
        try {
          clearTimeout(revealTimer);
          if (input.type === 'text') {
            hideKey();
            return;
          }
          if (!input.value && state.saved) {
            input.value = await window.cuecard.revealKey(provider);
            input.dataset.revealed = 'true';
          }
          input.type = 'text';
          reveal.setAttribute('aria-label', `Hide ${info.name} key`);
          revealTimer = setTimeout(hideKey, 30000);
        } catch (error) {
          notice(error.message);
        }
      });
      inputBox.append(input, reveal);
      const save = element('button', 'primary key-save', state.saved ? 'Replace key' : 'Save key');
      save.type = 'button';
      const test = element('button', 'secondary key-test', 'Test connection');
      test.type = 'button';
      test.disabled = !state.saved;
      const remove = element('button', 'key-remove', 'Remove');
      remove.type = 'button';
      remove.disabled = !state.saved;
      const result = element(
        'p',
        'key-result',
        state.testedAt
          ? `${state.verified ? '✓ Connection successful' : 'Connection not verified'} · Last tested ${date(state.testedAt)}`
          : state.saved
            ? 'Encrypted and saved on this device. Ready for your next session.'
            : 'Add a key to enable this provider.',
      );
      save.addEventListener('click', async () => {
        if (!input.value.trim()) {
          result.textContent = 'Paste a key before saving.';
          input.focus();
          return;
        }
        save.disabled = true;
        try {
          statuses = await window.cuecard.saveKey(provider, input.value);
          input.value = '';
          clearTimeout(revealTimer);
          notice('');
          summary();
          renderKeys();
        } catch (error) {
          result.textContent = error.message;
          save.disabled = false;
        }
      });
      test.addEventListener('click', async () => {
        test.disabled = true;
        result.textContent = 'Checking connection…';
        try {
          const response = await window.cuecard.testKey(provider);
          statuses = response.status;
          status.textContent = response.verified ? '● Connected' : '● Saved';
          result.textContent = response.message;
        } catch (error) {
          result.textContent = error.message;
        } finally {
          test.disabled = false;
        }
      });
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          statuses = await window.cuecard.removeKey(provider);
          input.value = '';
          clearTimeout(revealTimer);
          summary();
          renderKeys();
        } catch (error) {
          result.textContent = error.message;
          remove.disabled = false;
        }
      });
      row.append(inputBox, test, save, remove);
      label.append(row);
      const link = element('a', 'key-link', `Get a ${info.name} API key ↗`);
      link.href = info.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(heading, label, result, link);
      cards.append(card);
    }
  }
  function showPage(page) {
    document.querySelectorAll('.key-input').forEach((input) => {
      input.type = 'password';
      if (input.dataset.revealed === 'true') input.value = '';
      delete input.dataset.revealed;
    });
    for (const name of ['create', 'sessions', 'keys'])
      find(`#${name}Page`).classList.toggle('hidden', name !== page);
    document.querySelectorAll('[data-page]').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === page);
      button.setAttribute('aria-current', button.dataset.page === page ? 'page' : 'false');
    });
    find('.workspace-main').scrollTop = 0;
    if (page === 'keys') refreshKeys();
    if (page === 'sessions') loadSessions();
  }
  async function loadSessions() {
    try {
      sessions = await window.cuecard.listSessions();
      renderSessions();
    } catch (error) {
      notice(error.message);
    }
  }
  function renderSessions() {
    const visible = sessions.filter((session) => filter === 'all' || session.type === filter);
    find('#sessionCount').textContent = `${visible.length} ${visible.length === 1 ? 'session' : 'sessions'}`;
    const grid = find('#sessionCards');
    grid.replaceChildren();
    if (!visible.length) {
      const empty = element('div', 'empty-sessions');
      empty.append(
        element('span', 'empty-symbol', '▤'),
        element('h2', '', 'Your next chapter starts here'),
        element('p', '', 'Start a session and your questions and cues will be saved here.'),
      );
      const button = element('button', 'primary', 'Create session');
      button.addEventListener('click', () => {
        window.cueSessionForm.startNew();
        showPage('create');
      });
      empty.append(button);
      grid.append(empty);
      return;
    }
    for (const session of visible) {
      const card = element('article', 'session-card');
      const heading = element('div', 'session-company');
      const title = element('div');
      title.append(element('h3', '', session.company), element('p', '', session.role));
      heading.append(element('span', 'company-avatar', session.company.slice(0, 1).toUpperCase()), title);
      const type = element(
        'span',
        'session-type',
        session.type === 'regular'
          ? 'Regular call'
          : session.type === 'mock'
            ? 'Mock interview'
            : 'Interview',
      );
      const footer = element('div', 'session-card-footer');
      const count = element(
        'span',
        '',
        `${session.entries.length} ${session.entries.length === 1 ? 'cue' : 'cues'} saved`,
      );
      const button = element('button', 'secondary', 'View transcript');
      button.addEventListener('click', () => showTranscript(session));
      footer.append(count, button);
      const continueButton = element('button', 'primary continue-session', 'Continue session');
      continueButton.addEventListener('click', async () => {
        continueButton.disabled = true;
        try {
          await window.cueSessionForm.restore(session.id);
          notice('');
          showPage('create');
        } catch (error) {
          notice(error.message);
        } finally {
          continueButton.disabled = false;
        }
      });
      button.classList.add('view-transcript');
      const actions = element('div', 'session-actions');
      actions.append(continueButton, button);
      footer.replaceChildren(count);
      const rounds = (session.roundCount || 1) > 1 ? ` · ${session.roundCount} rounds` : '';
      card.append(
        element('time', 'session-date', date(session.lastActiveAt || session.startedAt)),
        heading,
        type,
        element('p', 'session-state', (session.endedAt ? '● Ended' : '● Session saved') + rounds),
        footer,
        actions,
      );
      grid.append(card);
    }
  }
  function showTranscript(session) {
    find('#transcriptTitle').textContent = `${session.company} · ${session.role}`;
    find('#transcriptMeta').textContent = `${date(session.startedAt)} · ${session.model}`;
    const entries = find('#transcriptEntries');
    entries.replaceChildren();
    if (!session.entries.length)
      entries.append(element('p', 'transcript-empty', 'No questions or cues were saved in this session.'));
    for (const [index, entry] of session.entries.entries()) {
      const item = element('article', 'transcript-entry');
      item.append(
        element('span', 'eyebrow', `ROUND ${entry.round || 1} · QUESTION ${index + 1}`),
        element('h3', '', entry.question),
        element('p', '', entry.answer),
      );
      entries.append(item);
    }
    find('#transcriptDialog').showModal();
  }
  document
    .querySelectorAll('[data-page]')
    .forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
  document.querySelectorAll('[data-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      document
        .querySelectorAll('[data-filter]')
        .forEach((item) => item.classList.toggle('selected', item === button));
      renderSessions();
    }),
  );
  find('#manageSessionKeys').addEventListener('click', () => showPage('keys'));
  find('#newSession').addEventListener('click', () => {
    window.cueSessionForm.startNew();
    showPage('create');
  });
  find('#closeTranscript').addEventListener('click', () => find('#transcriptDialog').close());
  find('#collapseSidebar').addEventListener('click', () => {
    const collapsed = find('#setupView').classList.toggle('sidebar-collapsed');
    find('#collapseSidebar').textContent = collapsed ? '»' : '«';
    find('#collapseSidebar').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  });
  find('#desktopClose').addEventListener('click', () => window.cuecard.close());
  find('#desktopMinimize').addEventListener('click', () => window.cuecard.minimize());
  find('#desktopMaximize').addEventListener('click', () => window.cuecard.maximize());
  find('#provider').addEventListener('change', summary);
  window.cuecard.onWorkspaceRefresh(() => {
    refreshKeys();
    loadSessions();
  });
  window.cuecard.onWorkspaceError(notice);
  window.addEventListener('blur', () => {
    document.querySelectorAll('.key-input').forEach((input) => {
      input.type = 'password';
      if (input.dataset.revealed === 'true') input.value = '';
      delete input.dataset.revealed;
    });
  });
  window.cueWorkspace = { refreshKeys, showPage, configureWindowControls };
  refreshKeys();
})();
