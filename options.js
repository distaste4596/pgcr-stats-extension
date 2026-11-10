chrome.storage.sync.get(DEFAULT_SETTINGS).then(settings => {
  for (const input of document.querySelectorAll('input[type=checkbox]')) {
    input.checked = settings[input.id]
    input.addEventListener('change', () => chrome.storage.sync.set({ [input.id]: input.checked }))
  }
})
