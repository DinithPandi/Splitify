/**
 * Splitify - Core Application Logic & State Controller
 * Handles Group management, Friend management, Expense CRUD,
 * transaction simplification calculations, and rendering routines.
 */

// Helper to generate UUID-like strings
function generateId() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
}

// Helper to hash strings for static-like seed values (e.g. avatars)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

// ==========================================================================
// Application State
// ==========================================================================
let state = {
  groups: [],
  activeGroupId: null
};

// Local Storage Keys
const STORAGE_KEY = 'splitify_data';

// Load State from Local Storage
function loadState() {
  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      state = JSON.parse(localData);
      // Fallback/Self-healing checks
      if (!Array.isArray(state.groups)) state.groups = [];
      state.groups.forEach(g => {
        if (!g.currency) g.currency = 'LKR';
      });
      if (state.groups.length > 0 && !state.activeGroupId) {
        state.activeGroupId = state.groups[0].id;
      }
    } catch (e) {
      console.error('Failed to parse local storage', e);
      initFallbackData();
    }
  } else {
    initFallbackData();
  }
}

// Save State to Local Storage
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Initialize fallback/default demo data to wow user on start
function initFallbackData() {
  const demoGroupId = generateId();
  const f1 = generateId();
  const f2 = generateId();
  const f3 = generateId();
  const f4 = generateId();

  state = {

  };
  saveState();
}

// Get active group object
function getActiveGroup() {
  return state.groups.find(g => g.id === state.activeGroupId) || null;
}

// Helper to format currency dynamically based on the group configuration
function formatMoney(amount, group) {
  const currency = group ? (group.currency || 'LKR') : 'LKR';
  return `${currency} ${Number(amount).toFixed(2)}`;
}

// ==========================================================================
// Calculations & Algorithms
// ==========================================================================

/**
 * Calculates net balances and generates simplified debt clearing list.
 */
function processGroupFinancials(group) {
  if (!group) return { totalSpent: 0, personBreakdown: {}, settlements: [] };

  const totalSpent = group.expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);

  // Initialize breakdown structure
  const breakdown = {};
  group.friends.forEach(f => {
    breakdown[f.id] = {
      id: f.id,
      name: f.name,
      totalPaid: 0,
      totalShare: 0,
      netBalance: 0
    };
  });

  // Calculate total paid & total share per friend
  group.expenses.forEach(exp => {
    const amt = Number(exp.amount);
    const payer = exp.paidBy;
    const parts = exp.participants || [];

    // Add paid total
    if (breakdown[payer]) {
      breakdown[payer].totalPaid += amt;
    }

    // Share calculations
    if (parts.length > 0) {
      const share = amt / parts.length;
      parts.forEach(pId => {
        if (breakdown[pId]) {
          breakdown[pId].totalShare += share;
        }
      });
    }
  });

  // Compute Net Balance
  group.friends.forEach(f => {
    const person = breakdown[f.id];
    person.netBalance = person.totalPaid - person.totalShare;
  });

  // Debt Simplification Algorithm (Greedy matching)
  let creditors = [];
  let debtors = [];

  group.friends.forEach(f => {
    const net = Math.round(breakdown[f.id].netBalance * 100) / 100;
    if (net > 0.01) {
      creditors.push({ id: f.id, name: f.name, balance: net });
    } else if (net < -0.01) {
      debtors.push({ id: f.id, name: f.name, balance: net });
    }
  });

  const settlements = [];

  // Greedy match creditors & debtors
  while (creditors.length > 0 && debtors.length > 0) {
    // Sort in place to find largest debtors/creditors
    creditors.sort((a, b) => b.balance - a.balance);
    debtors.sort((a, b) => a.balance - b.balance); // most negative (i.e. largest debt) first

    const c = creditors[0];
    const d = debtors[0];

    const transfer = Math.round(Math.min(c.balance, Math.abs(d.balance)) * 100) / 100;

    if (transfer > 0) {
      settlements.push({
        from: d.name,
        fromId: d.id,
        to: c.name,
        toId: c.id,
        amount: transfer
      });

      // Update remaining balance tracking
      c.balance = Math.round((c.balance - transfer) * 100) / 100;
      d.balance = Math.round((d.balance + transfer) * 100) / 100;
    }

    // Remove if settled
    if (c.balance <= 0.01) creditors.shift();
    if (Math.abs(d.balance) <= 0.01) debtors.shift();
  }

  return {
    totalSpent,
    personBreakdown: breakdown,
    settlements
  };
}

// ==========================================================================
// DOM Cache & Modals Management
// ==========================================================================

// Main Workspace Sections
const emptyStateEl = document.getElementById('empty-state');
const dashboardEl = document.getElementById('group-dashboard');
const activeGroupNameEl = document.getElementById('active-group-name');
const metricTotalSpentEl = document.getElementById('metric-total-spent');

// Lists
const groupsListEl = document.getElementById('groups-list');
const friendsListEl = document.getElementById('friends-list');
const expensesListEl = document.getElementById('expenses-list');
const settlementsContainerEl = document.getElementById('settlements-container');
const balancesTableBodyEl = document.getElementById('balances-table-body');
const exportActionsWrapperEl = document.getElementById('export-actions-wrapper');
const btnExportImageEl = document.getElementById('btn-export-image');
const btnExportPdfEl = document.getElementById('btn-export-pdf');

// Stats Counters
const friendsCountEl = document.getElementById('friends-count');
const expensesCountEl = document.getElementById('expenses-count');

// Modals
const modalGroup = document.getElementById('modal-group');
const modalExpense = document.getElementById('modal-expense');
const modalConfirm = document.getElementById('modal-confirm');

// Modals Inner Form Controls
const formGroup = document.getElementById('form-group');
const groupModalTitle = document.getElementById('group-modal-title');
const groupModalId = document.getElementById('group-modal-id');
const groupNameInput = document.getElementById('group-name-input');

const formExpense = document.getElementById('form-expense');
const expenseModalTitle = document.getElementById('expense-modal-title');
const expenseModalId = document.getElementById('expense-modal-id');
const expenseDescInput = document.getElementById('expense-desc-input');
const expenseAmountInput = document.getElementById('expense-amount-input');
const expensePayerSelect = document.getElementById('expense-payer-select');
const expenseShareCheckboxes = document.getElementById('expense-share-checkboxes');
const expenseShareError = document.getElementById('expense-share-error');

// Triggers & Close buttons
const btnCreateGroupSidebar = document.getElementById('btn-create-group-sidebar');
const btnCreateGroupEmpty = document.getElementById('btn-create-group-empty');
const btnEditGroup = document.getElementById('btn-edit-group');
const btnDeleteGroup = document.getElementById('btn-delete-group');
const btnAddExpenseTrigger = document.getElementById('btn-add-expense-trigger');
const btnShareSelectAll = document.getElementById('btn-share-select-all');
const btnShareClearAll = document.getElementById('btn-share-clear-all');

// Confirm modal buttons
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmSubmit = document.getElementById('btn-confirm-submit');
const confirmModalText = document.getElementById('confirm-modal-text');

// Confirmation dialog state tracking
let confirmCallback = null;

// Opens a Modal
function openModal(modalEl) {
  modalEl.classList.add('open');
}

// Closes a Modal
function closeModal(modalEl) {
  modalEl.classList.remove('open');
  // Clean validation visual alerts
  const errorText = modalEl.querySelector('.error-text');
  if (errorText) errorText.style.display = 'none';
}

// Confirm Actions helper
function requestConfirmation(text, callback) {
  confirmModalText.textContent = text;
  confirmCallback = callback;
  openModal(modalConfirm);
}

// Register close events on close handles
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal(btn.closest('.modal-overlay'));
  });
});

// Setup Group Modals Trigger
btnCreateGroupSidebar.addEventListener('click', () => {
  groupModalTitle.textContent = 'Create New Group';
  groupModalId.value = '';
  groupNameInput.value = '';
  document.getElementById('group-currency-select').value = 'LKR';
  openModal(modalGroup);
});

btnCreateGroupEmpty.addEventListener('click', () => {
  groupModalTitle.textContent = 'Create New Group';
  groupModalId.value = '';
  groupNameInput.value = '';
  document.getElementById('group-currency-select').value = 'LKR';
  openModal(modalGroup);
});

// Settle Confirm modal bindings
btnConfirmCancel.addEventListener('click', () => {
  closeModal(modalConfirm);
  confirmCallback = null;
});

btnConfirmSubmit.addEventListener('click', () => {
  if (confirmCallback) {
    confirmCallback();
  }
  closeModal(modalConfirm);
  confirmCallback = null;
});

// ==========================================================================
// Friend Inline Editing Controller
// ==========================================================================
let editingFriendId = null;

function renderFriends(group, breakdown) {
  friendsListEl.innerHTML = '';
  if (!group || group.friends.length === 0) {
    friendsCountEl.textContent = '0';
    friendsListEl.innerHTML = `<li class="sub-empty-state" style="padding: 20px 10px;">No friends added yet</li>`;
    return;
  }

  friendsCountEl.textContent = group.friends.length;

  group.friends.forEach((friend, idx) => {
    const friendInfo = breakdown[friend.id] || { netBalance: 0 };
    const bal = friendInfo.netBalance;

    let balText = formatMoney(0, group);
    let balClass = 'friend-bal-neutral';
    if (bal > 0.009) {
      balText = `receives ${formatMoney(bal, group)}`;
      balClass = 'friend-bal-positive';
    } else if (bal < -0.009) {
      balText = `owes ${formatMoney(Math.abs(bal), group)}`;
      balClass = 'friend-bal-negative';
    }

    const li = document.createElement('li');

    // Avatar gradient index determined statically by hashing friend name
    const avatarGradientIdx = Math.abs(hashString(friend.name)) % 6;

    if (editingFriendId === friend.id) {
      // Inline edit mode template
      li.className = 'friend-edit-card';
      li.innerHTML = `
        <form class="friend-edit-form" id="form-edit-friend-inline">
          <input type="text" id="edit-friend-name-input" value="${escapeHTML(friend.name)}" required max="30">
          <button type="submit" class="btn-icon-small" title="Save">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </button>
          <button type="button" id="btn-cancel-edit-friend" class="btn-icon-small" title="Cancel">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--color-danger)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </form>
      `;
      friendsListEl.appendChild(li);

      // Event binding
      const editForm = li.querySelector('#form-edit-friend-inline');
      const editInput = li.querySelector('#edit-friend-name-input');
      const cancelBtn = li.querySelector('#btn-cancel-edit-friend');

      editInput.focus();
      editInput.select();

      cancelBtn.addEventListener('click', () => {
        editingFriendId = null;
        render();
      });

      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newName = editInput.value.trim();
        if (!newName) return;

        // Name unique check (excluding self)
        const duplicate = group.friends.some(f => f.id !== friend.id && f.name.toLowerCase() === newName.toLowerCase());
        if (duplicate) {
          alert('A friend with this name already exists in this group.');
          return;
        }

        friend.name = newName;
        editingFriendId = null;
        saveState();
        render();
      });

    } else {
      // View Card Mode
      li.className = 'friend-card';
      li.innerHTML = `
        <div class="friend-info">
          <div class="avatar friend-avatar-${avatarGradientIdx}">${escapeHTML(friend.name.charAt(0).toUpperCase())}</div>
          <div class="friend-details">
            <span class="name">${escapeHTML(friend.name)}</span>
            <span class="sub-bal ${balClass}">${balText}</span>
          </div>
        </div>
        <div class="friend-actions">
          <button class="btn-icon-small btn-edit-friend-trigger" data-id="${friend.id}" title="Edit Name">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn-icon-small btn-delete-friend-trigger danger" data-id="${friend.id}" title="Remove Friend">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;
      friendsListEl.appendChild(li);
    }
  });

  // Attach dynamic trigger buttons
  document.querySelectorAll('.btn-edit-friend-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      editingFriendId = btn.getAttribute('data-id');
      render();
    });
  });

  document.querySelectorAll('.btn-delete-friend-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const friendObj = group.friends.find(f => f.id === id);

      // Validation Check: Prevent deletion of friends involved in existing expenses
      const isPayer = group.expenses.some(exp => exp.paidBy === id);
      const isParticipant = group.expenses.some(exp => exp.participants.includes(id));

      if (isPayer || isParticipant) {
        requestConfirmation(
          `"${friendObj.name}" is involved in active expenses. Deleting them will automatically remove them from splits and reset their transactions. Do you wish to proceed?`,
          () => {
            // Remove friend
            group.friends = group.friends.filter(f => f.id !== id);

            // Clean up group expenses:
            // 1. Delete expenses where they are the Payer (since payer is missing)
            group.expenses = group.expenses.filter(exp => exp.paidBy !== id);
            // 2. Remove from participation in other expenses.
            group.expenses.forEach(exp => {
              exp.participants = exp.participants.filter(p => p !== id);
            });
            // 3. Remove expenses where there are no participants remaining
            group.expenses = group.expenses.filter(exp => exp.participants.length > 0);

            saveState();
            render();
          }
        );
      } else {
        requestConfirmation(`Remove ${friendObj.name} from the group?`, () => {
          group.friends = group.friends.filter(f => f.id !== id);
          saveState();
          render();
        });
      }
    });
  });
}

// ==========================================================================
// Render App Components
// ==========================================================================

function renderGroups() {
  groupsListEl.innerHTML = '';
  if (state.groups.length === 0) {
    groupsListEl.innerHTML = `<li class="sub-empty-state" style="padding: 10px;">No groups yet</li>`;
    return;
  }

  state.groups.forEach(g => {
    const li = document.createElement('li');
    const isActive = g.id === state.activeGroupId;

    li.innerHTML = `
      <button class="group-item ${isActive ? 'active' : ''}" data-id="${g.id}">
        <span class="group-name-text">${escapeHTML(g.name)}</span>
        <span class="badge">${g.friends.length}👤</span>
      </button>
    `;

    groupsListEl.appendChild(li);

    // Add activation click listener
    li.querySelector('button').addEventListener('click', () => {
      state.activeGroupId = g.id;
      editingFriendId = null; // reset friend edit
      
      // Reset active tab to activity tab
      const tabBtnAct = document.getElementById('tab-btn-activity');
      if (tabBtnAct) {
        tabBtnAct.classList.add('active');
        const tabBtnSett = document.getElementById('tab-btn-settlements');
        if (tabBtnSett) tabBtnSett.classList.remove('active');
        const tabContAct = document.getElementById('tab-content-activity');
        if (tabContAct) tabContAct.classList.add('active');
        const tabContSett = document.getElementById('tab-content-settlements');
        if (tabContSett) tabContSett.classList.remove('active');
      }
      
      saveState();
      render();
    });
  });
}

function renderExpenses(group) {
  expensesListEl.innerHTML = '';

  if (!group || group.expenses.length === 0) {
    document.getElementById('expenses-empty-state').style.display = 'flex';
    expensesCountEl.textContent = '0';
    return;
  }

  document.getElementById('expenses-empty-state').style.display = 'none';
  expensesCountEl.textContent = group.expenses.length;

  // Render expenses descending by date/creation order so new items are on top
  const sortedExpenses = [...group.expenses].reverse();

  sortedExpenses.forEach(exp => {
    const payerFriend = group.friends.find(f => f.id === exp.paidBy);
    const payerName = payerFriend ? payerFriend.name : 'Unknown';
    const splitCount = exp.participants ? exp.participants.length : 0;
    const costPerPerson = splitCount > 0 ? (exp.amount / splitCount) : 0;

    // Display initials in bullet lists
    const participantNames = exp.participants
      .map(pId => {
        const fr = group.friends.find(f => f.id === pId);
        return fr ? fr.name : 'Unknown';
      })
      .join(', ');

    const li = document.createElement('li');
    li.className = 'expense-item';
    li.innerHTML = `
      <div class="expense-row-top">
        <div class="expense-desc-block">
          <span class="expense-title">${escapeHTML(exp.description || 'Expense')}</span>
          <span class="expense-meta">
            <span>Paid by <strong>${escapeHTML(payerName)}</strong></span>
            <span class="bullet">•</span>
            <span>${escapeHTML(exp.date)}</span>
          </span>
        </div>
        <div class="expense-value-block">
          <span class="expense-price">${formatMoney(exp.amount, group)}</span>
          <div class="friend-actions">
            <button class="btn-icon-small btn-edit-expense-trigger" data-id="${exp.id}" title="Edit Expense">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button class="btn-icon-small btn-delete-expense-trigger danger" data-id="${exp.id}" title="Delete Expense">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="expense-row-bottom">
        <div class="expense-split-info">
          <span>Split between <span class="split-pill">${splitCount} friends</span></span>
        </div>
        <span class="txt-right" title="${escapeHTML(participantNames)}">
          ${formatMoney(costPerPerson, group)} each
        </span>
      </div>
    `;

    expensesListEl.appendChild(li);
  });

  // Attach trigger actions
  document.querySelectorAll('.btn-edit-expense-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openExpenseModal(id);
    });
  });

  document.querySelectorAll('.btn-delete-expense-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const expObj = group.expenses.find(e => e.id === id);
      requestConfirmation(`Delete expense "${expObj.description || 'Expense'}"?`, () => {
        group.expenses = group.expenses.filter(e => e.id !== id);
        saveState();
        render();
      });
    });
  });
}

function renderBalancesAndSettlements(breakdown, settlements, group) {
  balancesTableBodyEl.innerHTML = '';
  settlementsContainerEl.innerHTML = '';

  if (!group || group.friends.length === 0) {
    balancesTableBodyEl.innerHTML = `<tr><td colspan="4" class="sub-empty-state">No balances to calculate</td></tr>`;
    settlementsContainerEl.innerHTML = `<div class="settle-empty">Add friends and expenses to calculate settlements!</div>`;
    if (exportActionsWrapperEl) exportActionsWrapperEl.style.display = 'none';
    return;
  }

  if (exportActionsWrapperEl) exportActionsWrapperEl.style.display = 'flex';

  // Populate Balances Table
  group.friends.forEach(f => {
    const fInfo = breakdown[f.id] || { totalPaid: 0, totalShare: 0, netBalance: 0 };
    const net = fInfo.netBalance;
    let netClass = 'friend-bal-neutral';
    let prefix = '';

    if (net > 0.009) {
      netClass = 'friend-bal-positive';
      prefix = '+';
    } else if (net < -0.009) {
      netClass = 'friend-bal-negative';
      prefix = '-';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="balance-table-name" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</div></td>
      <td class="txt-right">${formatMoney(fInfo.totalPaid, group)}</td>
      <td class="txt-right">${formatMoney(fInfo.totalShare, group)}</td>
      <td class="txt-right ${netClass}"><strong>${prefix}${formatMoney(Math.abs(net), group)}</strong></td>
    `;
    balancesTableBodyEl.appendChild(tr);
  });

  // Populate Settlements
  if (settlements.length === 0) {
    settlementsContainerEl.innerHTML = `<div class="settle-empty">✨ All balances settled! No transfers needed.</div>`;
  } else {
    settlements.forEach(settle => {
      const settleEl = document.createElement('div');
      settleEl.className = 'settle-item';
      settleEl.innerHTML = `
        <div class="settle-party">
          <span title="${escapeHTML(settle.from)}">${escapeHTML(settle.from)}</span>
        </div>
        <div class="settle-arrow">
          <svg width="24" height="12" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 2L22 6L18 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 6H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="settle-val">${formatMoney(settle.amount, group)}</span>
        </div>
        <div class="settle-party txt-right" style="justify-content: flex-end;">
          <span title="${escapeHTML(settle.to)}">${escapeHTML(settle.to)}</span>
        </div>
      `;
      settlementsContainerEl.appendChild(settleEl);
    });
  }
}

// Master Render Function
function render() {
  renderGroups();

  const activeGroup = getActiveGroup();

  if (!activeGroup) {
    emptyStateEl.style.display = 'flex';
    dashboardEl.style.display = 'none';
    return;
  }

  emptyStateEl.style.display = 'none';
  dashboardEl.style.display = 'flex';

  activeGroupNameEl.textContent = activeGroup.name;

  // Process data calculations
  const analysis = processGroupFinancials(activeGroup);

  // Update total metrics
  metricTotalSpentEl.textContent = formatMoney(analysis.totalSpent, activeGroup);

  // Render components
  renderFriends(activeGroup, analysis.personBreakdown);
  renderExpenses(activeGroup);
  renderBalancesAndSettlements(analysis.personBreakdown, analysis.settlements, activeGroup);
}

// ==========================================================================
// Add / Edit Group Events
// ==========================================================================

formGroup.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = groupNameInput.value.trim();
  const id = groupModalId.value;
  const currency = document.getElementById('group-currency-select').value;

  if (!name) return;

  if (id) {
    // Editing existing group name & currency
    const group = state.groups.find(g => g.id === id);
    if (group) {
      group.name = name;
      group.currency = currency;
    }
  } else {
    // Create new group
    const newGroup = {
      id: generateId(),
      name: name,
      currency: currency,
      friends: [],
      expenses: []
    };
    state.groups.push(newGroup);
    state.activeGroupId = newGroup.id;
  }

  saveState();
  closeModal(modalGroup);
  render();
});

btnEditGroup.addEventListener('click', () => {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;

  groupModalTitle.textContent = 'Rename & Edit Group';
  groupModalId.value = activeGroup.id;
  groupNameInput.value = activeGroup.name;
  document.getElementById('group-currency-select').value = activeGroup.currency || 'LKR';
  openModal(modalGroup);
});

btnDeleteGroup.addEventListener('click', () => {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;

  requestConfirmation(`Are you sure you want to delete the group "${activeGroup.name}"? This will delete all its friends and expense records.`, () => {
    state.groups = state.groups.filter(g => g.id !== activeGroup.id);

    // Switch to first remaining group or empty state
    state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;

    saveState();
    render();
  });
});

// ==========================================================================
// Friend Form Event
// ==========================================================================

const formAddFriend = document.getElementById('form-add-friend');
const friendNameInput = document.getElementById('friend-name-input');

formAddFriend.addEventListener('submit', (e) => {
  e.preventDefault();
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;

  const name = friendNameInput.value.trim();
  if (!name) return;

  // Duplicate name check
  const isDuplicate = activeGroup.friends.some(f => f.name.toLowerCase() === name.toLowerCase());
  if (isDuplicate) {
    alert('A friend with this name is already in the group.');
    return;
  }

  const newFriend = {
    id: generateId(),
    name: name
  };

  activeGroup.friends.push(newFriend);
  friendNameInput.value = '';

  saveState();
  render();
});

// ==========================================================================
// Expense Dialog Form Processing & Custom Modals
// ==========================================================================

function openExpenseModal(expenseId = null) {
  const group = getActiveGroup();
  if (!group) return;

  if (group.friends.length === 0) {
    alert('Please add friends to the group first before posting expenses.');
    return;
  }

  // Set local currency label dynamically
  const currency = group.currency || 'LKR';
  const amountLabel = document.querySelector('label[for="expense-amount-input"]');
  if (amountLabel) {
    amountLabel.innerHTML = `Amount (${currency}) <span class="required">*</span>`;
  }

  // Clear Payer selector & share grid
  expensePayerSelect.innerHTML = '';
  expenseShareCheckboxes.innerHTML = '';
  expenseShareError.style.display = 'none';

  // Fill Payer selector options
  group.friends.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    expensePayerSelect.appendChild(opt);
  });

  // Fill Splitting checkbox grids
  group.friends.forEach(f => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.innerHTML = `
      <input type="checkbox" name="split-participants" value="${f.id}" checked>
      <span>${escapeHTML(f.name)}</span>
    `;
    expenseShareCheckboxes.appendChild(label);
  });

  if (expenseId) {
    // Edit existing expense setup
    expenseModalTitle.textContent = 'Edit Expense';
    expenseModalId.value = expenseId;

    const exp = group.expenses.find(e => e.id === expenseId);
    if (exp) {
      expenseDescInput.value = exp.description;
      expenseAmountInput.value = exp.amount;
      expensePayerSelect.value = exp.paidBy;

      // Uncheck everyone first
      const checkBoxes = expenseShareCheckboxes.querySelectorAll('input[type="checkbox"]');
      checkBoxes.forEach(cb => {
        cb.checked = exp.participants.includes(cb.value);
      });
    }
  } else {
    // Clean fields for new entry
    expenseModalTitle.textContent = 'Add Expense';
    expenseModalId.value = '';
    expenseDescInput.value = '';
    expenseAmountInput.value = '';
    // Select first friend as default payer
    if (group.friends.length > 0) {
      expensePayerSelect.value = group.friends[0].id;
    }
  }

  openModal(modalExpense);
}

// Add Expense Trigger click
btnAddExpenseTrigger.addEventListener('click', () => {
  openExpenseModal();
});

// Helper buttons to toggle checkbox grids
btnShareSelectAll.addEventListener('click', () => {
  const checkBoxes = expenseShareCheckboxes.querySelectorAll('input[type="checkbox"]');
  checkBoxes.forEach(cb => cb.checked = true);
  expenseShareError.style.display = 'none';
});

btnShareClearAll.addEventListener('click', () => {
  const checkBoxes = expenseShareCheckboxes.querySelectorAll('input[type="checkbox"]');
  checkBoxes.forEach(cb => cb.checked = false);
});

// Watch checking checkboxes to remove validation alert in real-time
expenseShareCheckboxes.addEventListener('change', () => {
  const checkBoxes = expenseShareCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
  if (checkBoxes.length > 0) {
    expenseShareError.style.display = 'none';
  }
});

// Form submission for Expenses
formExpense.addEventListener('submit', (e) => {
  e.preventDefault();
  const group = getActiveGroup();
  if (!group) return;

  const id = expenseModalId.value;
  const desc = expenseDescInput.value.trim() || 'Expense';
  const amount = parseFloat(expenseAmountInput.value);
  const paidBy = expensePayerSelect.value;

  // Retrieve checked participants
  const checkedBoxes = expenseShareCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
  const participants = Array.from(checkedBoxes).map(cb => cb.value);

  // Validation routines
  if (isNaN(amount) || amount <= 0) {
    alert('Please enter a positive numeric value.');
    return;
  }

  if (participants.length === 0) {
    expenseShareError.style.display = 'block';
    return;
  }

  // Get current date formatted
  const todayStr = new Date().toISOString().split('T')[0];

  if (id) {
    // Edit existing expense
    const exp = group.expenses.find(e => e.id === id);
    if (exp) {
      exp.description = desc;
      exp.amount = amount;
      exp.paidBy = paidBy;
      exp.participants = participants;
      // keep original date, or optionally update it. Let's keep original date or format
    }
  } else {
    // Add new expense
    const newExpense = {
      id: generateId(),
      description: desc,
      amount: amount,
      paidBy: paidBy,
      participants: participants,
      date: todayStr
    };
    group.expenses.push(newExpense);
  }

  saveState();
  closeModal(modalExpense);
  render();
});

// ==========================================================================
// Security & Utilities
// ==========================================================================

// Escape input HTML helper to block basic XSS
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Settlements Export Controller
// ==========================================================================

function exportSettlements(format) {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;

  const analysis = processGroupFinancials(activeGroup);
  const settlements = analysis.settlements;

  // Format today's date
  const todayStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Create temporary container
  const exportCard = document.createElement('div');
  exportCard.id = 'splitify-export-card';
  
  // Apply beautiful inline styles matching Splitify's premium UI
  exportCard.style.position = 'absolute';
  exportCard.style.left = '-9999px';
  exportCard.style.top = '0';
  exportCard.style.width = '480px';
  exportCard.style.padding = '32px';
  exportCard.style.borderRadius = '16px';
  exportCard.style.background = 'linear-gradient(135deg, #111827 0%, #030712 100%)';
  exportCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
  exportCard.style.color = '#f8fafc';
  exportCard.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
  exportCard.style.boxSizing = 'border-box';
  exportCard.style.display = 'flex';
  exportCard.style.flexDirection = 'column';
  exportCard.style.gap = '24px';

  // Build header HTML
  let cardHtml = `
    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; color: #8b5cf6;">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="currentColor"/>
        </svg>
        <span style="font-weight: 800; font-size: 1.1rem; letter-spacing: -0.025em; color: #f8fafc;">Splitify</span>
      </div>
      <span style="font-size: 0.75rem; color: #64748b; font-weight: 500;">${todayStr}</span>
    </div>

    <!-- Title and Group Info -->
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b5cf6; font-weight: 700;">Group Balance Settlements</span>
      <h2 style="font-size: 1.5rem; font-weight: 800; color: #f8fafc; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(activeGroup.name)}</h2>
    </div>

    <!-- Settlements Container -->
    <div style="display: flex; flex-direction: column; gap: 10px;">
  `;

  if (settlements.length === 0) {
    cardHtml += `
      <div style="text-align: center; padding: 32px 20px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; color: #10b981; font-weight: 600; font-size: 0.95rem;">
        ✨ All balances settled! No transfers needed.
      </div>
    `;
  } else {
    settlements.forEach(settle => {
      cardHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: rgba(124, 58, 237, 0.05); border: 1px solid rgba(124, 58, 237, 0.12); border-radius: 10px; font-size: 0.85rem;">
          <div style="display: flex; align-items: center; font-weight: 600; max-width: 40%;">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(settle.from)}">${escapeHTML(settle.from)}</span>
          </div>
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1; padding: 0 8px;">
            <svg width="24" height="12" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: #8b5cf6;">
              <path d="M18 2L22 6L18 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 6H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span style="font-size: 0.65rem; font-weight: 700; background: rgba(124, 58, 237, 0.2); padding: 2px 6px; border-radius: 4px; color: #f8fafc; border: 1px solid rgba(124, 58, 237, 0.3); margin-top: 4px; white-space: nowrap;">${formatMoney(settle.amount, activeGroup)}</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: flex-end; font-weight: 600; max-width: 40%; text-align: right;">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(settle.to)}">${escapeHTML(settle.to)}</span>
          </div>
        </div>
      `;
    });
  }

  cardHtml += `
    </div>

    <!-- Footer -->
    <div style="border-top: 1px dashed rgba(255, 255, 255, 0.1); padding-top: 16px; display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
      <span style="font-size: 0.7rem; color: #64748b;">Keep track & split bills effortlessly</span>
      <span style="font-size: 0.75rem; font-weight: 700; color: #8b5cf6;">splitify.app</span>
    </div>
  `;

  exportCard.innerHTML = cardHtml;
  document.body.appendChild(exportCard);

  // Set loading cursor
  document.body.style.cursor = 'wait';

  // Wait a small delay to make sure rendering is finished
  setTimeout(() => {
    html2canvas(exportCard, {
      scale: 2,
      backgroundColor: null,
      useCORS: true,
      logging: false
    }).then(canvas => {
      document.body.style.cursor = 'default';
      const safeGroupName = activeGroup.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      if (format === 'image') {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${safeGroupName}_settlements.png`;
        link.href = dataUrl;
        link.click();
      } else if (format === 'pdf') {
        const imgData = canvas.toDataURL('image/png');
        const pdfWidth = 480;
        const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'pt',
          format: [pdfWidth, pdfHeight]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`${safeGroupName}_settlements.pdf`);
      }

      // Cleanup
      document.body.removeChild(exportCard);
    }).catch(err => {
      console.error('Failed to export settlements:', err);
      document.body.style.cursor = 'default';
      alert('An error occurred during export.');
      if (document.getElementById('splitify-export-card')) {
        document.body.removeChild(exportCard);
      }
    });
  }, 100);
}

if (btnExportImageEl) {
  btnExportImageEl.addEventListener('click', () => exportSettlements('image'));
}
if (btnExportPdfEl) {
  btnExportPdfEl.addEventListener('click', () => exportSettlements('pdf'));
}

// ==========================================================================
// App Bootstrapping
// ==========================================================================

// Tab Switching Event Listeners
const tabBtnActivity = document.getElementById('tab-btn-activity');
const tabBtnSettlements = document.getElementById('tab-btn-settlements');
const tabContentActivity = document.getElementById('tab-content-activity');
const tabContentSettlements = document.getElementById('tab-content-settlements');

if (tabBtnActivity && tabBtnSettlements) {
  tabBtnActivity.addEventListener('click', () => {
    tabBtnActivity.classList.add('active');
    tabBtnSettlements.classList.remove('active');
    tabContentActivity.classList.add('active');
    tabContentSettlements.classList.remove('active');
  });

  tabBtnSettlements.addEventListener('click', () => {
    tabBtnSettlements.classList.add('active');
    tabBtnActivity.classList.remove('active');
    tabContentSettlements.classList.add('active');
    tabContentActivity.classList.remove('active');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadState();
  render();
});
