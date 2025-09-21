(() => {
  const settings = window.DevataCabinetsSettings || {};

  function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) {
      el.className = options.className;
    }
    if (options.text != null) {
      el.textContent = options.text;
    }
    if (options.html != null) {
      el.innerHTML = options.html;
    }
    return el;
  }

  function renderError(container, message) {
    container.innerHTML = '';
    container.appendChild(
      createElement('div', {
        className: 'devata-cabinet__error',
        text: message || settings.i18n?.error || 'Произошла ошибка',
      })
    );
  }

  function renderLoading(container) {
    container.innerHTML = '';
    container.appendChild(
      createElement('div', {
        className: 'devata-cabinet__loading',
        text: settings.i18n?.loading || 'Загрузка...',
      })
    );
  }

  function fetchJSON(path, options = {}) {
    const url = (settings.restUrl || '') + path.replace(/^\//, '');
    const headers = Object.assign({ 'X-WP-Nonce': settings.nonce || '' }, options.headers || {});
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, Object.assign({}, options, { headers }))
      .then((response) => {
        if (!response.ok) {
          return response.json().catch(() => ({})).then((payload) => {
            const error = new Error(payload?.message || payload?.error || 'Request failed');
            error.status = response.status;
            throw error;
          });
        }
        return response.json();
      });
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString();
  }

  function formatAmount(value) {
    if (value == null) return '';
    const amount = typeof value === 'number' ? value : parseFloat(String(value));
    if (Number.isNaN(amount)) {
      return String(value);
    }
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount);
  }

  function renderProfile(container, payload) {
    const card = createElement('div', { className: 'devata-card devata-card--profile' });
    const header = createElement('div', { className: 'devata-card__header' });

    if (payload.avatar) {
      const avatar = createElement('img', { className: 'devata-card__avatar' });
      avatar.src = payload.avatar;
      avatar.alt = payload.displayName || '';
      header.appendChild(avatar);
    }

    const title = createElement('div', { className: 'devata-card__title' });
    title.textContent = payload.displayName || payload.email || '';
    header.appendChild(title);

    const roles = createElement('div', { className: 'devata-card__subtitle' });
    roles.textContent = (payload.roles || []).join(', ');
    header.appendChild(roles);

    card.appendChild(header);

    const profileList = createElement('dl', { className: 'devata-card__list' });
    const entries = {
      email: payload.email,
      phone: payload.profile?.phone,
      telegram: payload.profile?.telegram,
    };

    Object.entries(entries).forEach(([key, value]) => {
      if (!value) return;
      const term = createElement('dt', { text: key });
      const description = createElement('dd', { text: value });
      profileList.appendChild(term);
      profileList.appendChild(description);
    });

    if (profileList.children.length) {
      card.appendChild(profileList);
    }

    container.appendChild(card);
  }

  function renderTableSection(container, title, items, columns, emptyText) {
    const section = createElement('section', { className: 'devata-card' });
    section.appendChild(createElement('h3', { className: 'devata-card__title', text: title }));

    if (!items || !items.length) {
      section.appendChild(
        createElement('p', {
          className: 'devata-card__empty',
          text: emptyText || settings.i18n?.empty || 'Нет данных',
        })
      );
      container.appendChild(section);
      return;
    }

    const table = createElement('table', { className: 'devata-table' });
    const thead = createElement('thead');
    const headRow = createElement('tr');
    columns.forEach((column) => {
      headRow.appendChild(createElement('th', { text: column.label }));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = createElement('tbody');
    items.forEach((item) => {
      const row = createElement('tr');
      columns.forEach((column) => {
        const cell = createElement('td');
        let value = item[column.key];
        if (column.type === 'date') {
          value = formatDate(value);
        } else if (column.type === 'amount') {
          value = formatAmount(value);
        } else if (column.format) {
          value = column.format(item[column.key], item);
        }
        cell.textContent = value != null && value !== '' ? String(value) : '—';
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
  }

  function determineColumns(view) {
    const defaults = {
      bookings: [
        { key: 'reference', label: 'Номер' },
        { key: 'service', label: 'Услуга' },
        { key: 'slotStart', label: 'Дата', type: 'date' },
        { key: 'status', label: 'Статус' },
        { key: 'payment', label: 'Оплата' },
      ],
      orders: [
        { key: 'orderId', label: 'Заказ' },
        { key: 'amount', label: 'Сумма', type: 'amount' },
        { key: 'status', label: 'Статус' },
        { key: 'updatedAt', label: 'Обновлено', type: 'date' },
      ],
      courses: [
        { key: 'course', label: 'Курс' },
        { key: 'progress', label: 'Прогресс' },
        { key: 'accessUntil', label: 'Доступ до', type: 'date' },
        { key: 'status', label: 'Статус' },
      ],
      network: [
        { key: 'level', label: 'Линия' },
        { key: 'name', label: 'Партнёр' },
        { key: 'role', label: 'Роль' },
        { key: 'joinedAt', label: 'Присоединился', type: 'date' },
        { key: 'active', label: 'Активен' },
      ],
      payouts: [
        { key: 'period', label: 'Период' },
        { key: 'amount', label: 'Сумма', type: 'amount' },
        { key: 'status', label: 'Статус' },
        { key: 'availableAt', label: 'Доступно', type: 'date' },
      ],
    };
    return defaults[view] || [];
  }

  function renderCabinet(container, data) {
    container.innerHTML = '';
    container.classList.add('devata-cabinet--ready');

    renderProfile(container, data.me);

    const view = container.getAttribute('data-devata-view') || settings.view || 'dashboard';
    const sections = [];

    if (view === 'dashboard') {
      sections.push('bookings', 'orders', 'courses', 'payouts');
      if (Array.isArray(data.network?.items) && data.network.items.length) {
        sections.push('network');
      }
    } else if (view === 'partner') {
      sections.push('network', 'payouts', 'orders');
    } else if (view === 'student') {
      sections.push('courses', 'bookings');
    } else if (view === 'staff') {
      sections.push('bookings', 'orders');
    } else if (view === 'branch') {
      sections.push('bookings', 'payouts');
    }

    const containerFragment = document.createDocumentFragment();
    sections.forEach((section) => {
      const dataset = data[section] || { items: [] };
      renderTableSection(
        containerFragment,
        titleForSection(section),
        dataset.items || [],
        determineColumns(section),
        null
      );
    });

    container.appendChild(containerFragment);
  }

  function titleForSection(section) {
    switch (section) {
      case 'bookings':
        return 'Мои записи';
      case 'orders':
        return 'Оплаты и заказы';
      case 'courses':
        return 'Курсы';
      case 'network':
        return 'Партнёрская сеть';
      case 'payouts':
        return 'Выплаты';
      default:
        return section;
    }
  }

  function loadCabinet(container) {
    renderLoading(container);
    Promise.all([
      fetchJSON('me'),
      fetchJSON('me/bookings').catch(() => ({ items: [] })),
      fetchJSON('me/orders').catch(() => ({ items: [] })),
      fetchJSON('me/courses').catch(() => ({ items: [] })),
      fetchJSON('me/network').catch(() => ({ items: [] })),
      fetchJSON('me/payouts').catch(() => ({ items: [] })),
    ])
      .then(([me, bookings, orders, courses, network, payouts]) => {
        renderCabinet(container, { me, bookings, orders, courses, network, payouts });
      })
      .catch((error) => {
        if (error.status === 401) {
          renderError(container, 'Сессия истекла. Обновите страницу и войдите заново.');
          return;
        }
        renderError(container, error.message || settings.i18n?.error);
      });
  }

  function init() {
    const nodes = document.querySelectorAll('.devata-cabinet');
    nodes.forEach((node) => loadCabinet(node));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
