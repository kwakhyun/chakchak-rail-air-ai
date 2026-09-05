/** Preserve unfinished forms and disclosure state across asynchronous renders. */
export function captureUiState(root) {
  return {
    fields: [...root.querySelectorAll("dialog[open] input, dialog[open] select, #ai-guide-question")].map(el => ({ id: el.id, value: el.value, checked: el.checked })),
    details: [...root.querySelectorAll("details[id]")].map(el => ({ id: el.id, open: el.open })),
    focus: root.contains(document.activeElement) ? document.activeElement?.id : null,
    selection: document.activeElement?.selectionStart ?? null
  };
}

export function restoreUiState(root, snapshot) {
  for (const field of snapshot.fields) {
    const el = root.querySelector(`#${field.id}`);
    if (!el) continue;
    el.value = field.value;
    if (field.checked !== undefined) el.checked = field.checked;
  }
  for (const detail of snapshot.details) {
    const el = root.querySelector(`#${detail.id}`);
    if (el) el.open = detail.open;
  }
  const ticket = root.querySelector("#ticket-setup-details");
  if (ticket) ticket.hidden = !root.querySelector("#journey-has-ticket")?.checked;
  const focus = snapshot.focus && root.querySelector(`#${snapshot.focus}`);
  if (focus) {
    focus.focus({ preventScroll: true });
    if (snapshot.selection !== null && ["text", "search"].includes(focus.type)) focus.setSelectionRange(snapshot.selection, snapshot.selection);
  }
}
