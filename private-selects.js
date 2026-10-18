// Native select popups are OS-owned surfaces, not protected BrowserWindow content.
// Keep the select as the form/data source, but render all menus in this document.
(() => {
  const controls = [];
  const closeAll = () => controls.forEach((control) => control.close());
  for (const [id, label] of [
    ['provider', 'AI provider'],
    ['model', 'Model'],
    ['sessionType', 'Session type'],
  ]) {
    const select = document.getElementById(id);
    const wrapper = document.createElement('div');
    wrapper.className = 'private-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'private-select-trigger';
    button.id = `${id}-trigger`;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'private-select-menu hidden';
    menu.id = `${id}-menu`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label);
    button.setAttribute('aria-controls', menu.id);
    select.before(wrapper);
    wrapper.append(select, button, menu);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    let activeIndex = 0;
    const close = () => {
      menu.classList.add('hidden');
      wrapper.classList.remove('is-open', 'opens-up');
      button.setAttribute('aria-expanded', 'false');
    };
    const refresh = () => {
      button.textContent = `${select.selectedOptions[0]?.textContent || 'Select a model'} ▾`;
      button.disabled = select.disabled || !select.options.length;
      menu.replaceChildren();
      [...select.options].forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'private-select-option';
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.id = `${id}-option-${index}`;
        item.addEventListener('click', () => {
          select.value = option.value;
          close();
          select.dispatchEvent(new Event('change', { bubbles: true }));
          refresh();
          button.focus();
        });
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            close();
            if (event.key === 'Escape') {
              event.preventDefault();
              button.focus();
            }
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            const current = items.indexOf(item);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
        });
        menu.append(item);
      });
    };
    const open = () => {
      closeAll();
      refresh();
      menu.classList.remove('hidden');
      wrapper.classList.add('is-open');
      if (menu.getBoundingClientRect().bottom > innerHeight - 12) wrapper.classList.add('opens-up');
      button.setAttribute('aria-expanded', 'true');
      activeIndex = Math.max(0, select.selectedIndex);
      menu.children[activeIndex]?.focus();
    };
    button.addEventListener('click', () => (menu.classList.contains('hidden') ? open() : close()));
    button.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        open();
      }
      if (event.key === 'Escape') close();
    });
    wrapper.addEventListener('focusout', (event) => {
      if (!wrapper.contains(event.relatedTarget)) close();
    });
    select.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true });
    controls.push({ close, refresh });
    refresh();
  }
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.private-select')) closeAll();
  });
  window.addEventListener('blur', closeAll);
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  window.refreshPrivateSelects = () => controls.forEach((control) => control.refresh());
})();
