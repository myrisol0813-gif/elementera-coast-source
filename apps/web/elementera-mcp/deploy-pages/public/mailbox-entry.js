const entryButton = document.querySelector('#mailboxEntryButton');
const modal = document.querySelector('#mailboxEntryModal');
const closeButton = document.querySelector('#mailboxEntryClose');
const entryTitle = document.querySelector('#mailbox-entry-title');
const choices = document.querySelector('#mailboxEntryChoices');
const loginForm = document.querySelector('#mailboxLoginForm');
const registerForm = document.querySelector('#mailboxRegisterForm');

function setPane(name = 'choices') {
  modal.dataset.mailboxPane = name;
  choices.hidden = name !== 'choices';
  loginForm.hidden = name !== 'login';
  registerForm.hidden = name !== 'register';
  if (entryTitle) entryTitle.textContent = {
    choices: '访客信箱',
    login: '输入暗号',
    register: '填记名册',
  }[name] || '访客信箱';
  modal.querySelectorAll('[data-mailbox-error]').forEach((node) => { node.textContent = ''; });
  const form = name === 'login' ? loginForm : name === 'register' ? registerForm : null;
  if (modal.open) (form?.querySelector('input') || choices.querySelector('[data-mailbox-choice]'))?.focus();
}

function openEntry() {
  setPane('choices');
  modal.showModal();
  choices.querySelector('[data-mailbox-choice]')?.focus();
}

async function request(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data?.error?.message || '信箱入口暂时没有回应。');
  }
  return data;
}

async function submit(form, path, value) {
  const errorNode = form.querySelector('[data-mailbox-error]');
  const submitButton = form.querySelector('[type="submit"]');
  errorNode.textContent = '';
  submitButton.disabled = true;
  try {
    await request(path, value);
    window.location.assign('/mailbox');
  } catch (error) {
    errorNode.textContent = error.message || '没有进入信箱，请稍后再试。';
  } finally {
    submitButton.disabled = false;
  }
}

entryButton?.addEventListener('click', openEntry);
closeButton?.addEventListener('click', () => modal.close());
modal?.addEventListener('close', () => setPane('choices'));

modal?.querySelectorAll('[data-mailbox-choice]').forEach((button) => {
  button.addEventListener('click', () => setPane(button.dataset.mailboxChoice));
});

modal?.querySelectorAll('[data-mailbox-back]').forEach((button) => {
  button.addEventListener('click', () => setPane('choices'));
});

loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  submit(loginForm, '/api/mailbox/login', {
    passphrase: data.get('passphrase'),
  });
});

registerForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(registerForm);
  submit(registerForm, '/api/mailbox/register', {
    display_name: data.get('display_name'),
    passphrase: data.get('passphrase'),
    preferred_name: data.get('preferred_name'),
    allow_memory: data.get('allow_memory') === 'on',
  });
});

const mailboxEntryRequested = new URLSearchParams(window.location.search).get('mailbox') === '1';
if (mailboxEntryRequested) {
  queueMicrotask(openEntry);
}
