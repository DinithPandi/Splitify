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

// Load State from Server & Fallback to Local Storage
async function loadState() {
  try {
    const res = await fetch('/api/groups');
    if (res.ok) {
      const serverGroups = await res.json();
      state.groups = serverGroups;
      state.groups.forEach(g => {
        if (!g.groupType) g.groupType = 'split';
      });
      if (state.groups.length > 0) {
        if (!state.activeGroupId || !state.groups.some(g => g.id === state.activeGroupId)) {
          state.activeGroupId = state.groups[0].id;
        }
      } else {
        state.activeGroupId = null;
      }
      // Sync cache
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      console.error('Failed to load groups from server');
      loadStateLocalFallback();
    }
  } catch (err) {
    console.error('Error loading state from server:', err);
    loadStateLocalFallback();
  }
}

function loadStateLocalFallback() {
  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      state = JSON.parse(localData);
      if (!Array.isArray(state.groups)) state.groups = [];
      state.groups.forEach(g => {
        if (!g.currency) g.currency = 'LKR';
        if (!g.groupType) g.groupType = 'split';
      });
      if (state.groups.length > 0 && !state.activeGroupId) {
        state.activeGroupId = state.groups[0].id;
      }
    } catch (e) {
      console.error('Failed to parse local storage fallback', e);
    }
  }
}

// Save State to Server & Cache in Local Storage
async function saveState(deletedGroupId = null) {
  // Always update local cache instantly for responsive feel
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  try {
    if (deletedGroupId) {
      await fetch(`/api/groups/${deletedGroupId}`, {
        method: 'DELETE'
      });
    } else {
      const activeGroup = getActiveGroup();
      if (activeGroup) {
        await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(activeGroup)
        });
      }
    }
  } catch (err) {
    console.error('Failed to sync changes with MongoDB server:', err);
  }
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
    const participants = exp.participants || [];

    // Add paid total - only if payer is specified
    if (payer && breakdown[payer]) {
      breakdown[payer].totalPaid += amt;
    }

    // Share calculations
    if (participants.length > 0) {
      const share = amt / participants.length;
      participants.forEach(pId => {
        if (breakdown[pId]) {
          breakdown[pId].totalShare += share;
        }
      });
    }
  });

  // Compute Net Balance for each friend
  group.friends.forEach(f => {
    const person = breakdown[f.id];
    person.netBalance = person.totalPaid - person.totalShare;
  });

  const settlements = [];

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

  // Greedy match creditors & debtors
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort((a, b) => b.balance - a.balance);
    debtors.sort((a, b) => a.balance - b.balance);

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

      c.balance = Math.round((c.balance - transfer) * 100) / 100;
      d.balance = Math.round((d.balance + transfer) * 100) / 100;
    }

    if (c.balance <= 0.01) creditors.shift();
    if (Math.abs(d.balance) <= 0.01) debtors.shift();
  }

  return {
    totalSpent,
    personBreakdown: breakdown,
    settlements
  };
}

// Helpers for Category SVG icons
function getExpenseCategoryClass(description) {
  const desc = (description || '').toLowerCase();
  if (desc.includes('rent') || desc.includes('house') || desc.includes('room') || desc.includes('accommodation')) {
    return 'icon-rent';
  }
  if (desc.includes('grocery') || desc.includes('groceries') || desc.includes('market') || desc.includes('supermarket') || desc.includes('food') || desc.includes('dinner') || desc.includes('lunch') || desc.includes('restaurant') || desc.includes('cafe') || desc.includes('meal') || desc.includes('eat')) {
    if (desc.includes('grocery') || desc.includes('groceries')) {
      return 'icon-groceries';
    }
    return 'icon-food';
  }
  if (desc.includes('electricity') || desc.includes('water') || desc.includes('bill') || desc.includes('utility') || desc.includes('power') || desc.includes('gas') || desc.includes('wifi') || desc.includes('internet')) {
    return 'icon-utilities';
  }
  if (desc.includes('uber') || desc.includes('taxi') || desc.includes('transport') || desc.includes('travel') || desc.includes('fuel') || desc.includes('bus') || desc.includes('train')) {
    return 'icon-transport';
  }
  return 'icon-generic';
}

function getCategorySVG(catClass) {
  switch (catClass) {
    case 'icon-rent':
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
    case 'icon-groceries':
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
    case 'icon-utilities':
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
    case 'icon-food':
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
    case 'icon-transport':
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="3" width="15" height="13" rx="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
  }
}

// Settle Up Actions
function recordSettlementPayment(fromId, toId, amount) {
  const group = getActiveGroup();
  if (!group) return;

  const fromFriend = group.friends.find(f => f.id === fromId);
  const toFriend = group.friends.find(f => f.id === toId);
  const fromName = fromFriend ? fromFriend.name : 'Debtor';
  const toName = toFriend ? toFriend.name : 'Creditor';

  const todayStr = new Date().toISOString().split('T')[0];
  const newExpense = {
    id: generateId(),
    description: `Settle: ${fromName} to ${toName}`,
    amount: Number(amount),
    paidBy: fromId,
    participants: [toId],
    date: todayStr
  };

  group.expenses.push(newExpense);
  saveState();
  closeModal(document.getElementById('modal-settle-up'));
  render();
}

function renderSettleUpModal() {
  const group = getActiveGroup();
  const modalList = document.getElementById('settlements-list-modal');
  if (!group || !modalList) return;

  modalList.innerHTML = '';
  const analysis = processGroupFinancials(group);
  const settlements = analysis.settlements;

  if (settlements.length === 0) {
    modalList.innerHTML = `<div class="settle-empty" style="text-align:center; padding: 20px; color: var(--text-muted);">✨ All balances settled! No transfers needed.</div>`;
    return;
  }

  settlements.forEach((settle, index) => {
    const div = document.createElement('div');
    div.className = 'settle-item-modal';
    div.innerHTML = `
      <div class="settle-party-modal">
        <span>${escapeHTML(settle.from)}</span>
        <svg class="settle-party-modal-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
        <span>${escapeHTML(settle.to)}</span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="settle-amount-modal">${formatMoney(settle.amount, group)}</span>
        <button class="btn-mark-settled" data-index="${index}">Settle</button>
      </div>
    `;
    modalList.appendChild(div);
  });

  modalList.querySelectorAll('.btn-mark-settled').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      const s = settlements[idx];
      recordSettlementPayment(s.fromId, s.toId, s.amount);
    });
  });
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

// Modals
const modalGroup = document.getElementById('modal-group');
const modalExpense = document.getElementById('modal-expense');
const modalConfirm = document.getElementById('modal-confirm');
const modalSettleUp = document.getElementById('modal-settle-up');

// Modals Inner Form Controls
const formGroup = document.getElementById('form-group');
const groupModalTitle = document.getElementById('group-modal-title');
const groupModalId = document.getElementById('group-modal-id');
const groupNameInput = document.getElementById('group-name-input');
const groupDescInput = document.getElementById('group-desc-input');

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
const btnSettleUp = document.getElementById('btn-settle-up');
const btnWhatsappShareModal = document.getElementById('btn-whatsapp-share-modal');
const btnExportImageModalEl = document.getElementById('btn-export-image-modal');
const btnAddFriendTrigger = document.getElementById('btn-add-friend-trigger');

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
  groupDescInput.value = '';
  document.getElementById('group-currency-select').value = 'LKR';
  openModal(modalGroup);
});

btnCreateGroupEmpty.addEventListener('click', () => {
  groupModalTitle.textContent = 'Create New Group';
  groupModalId.value = '';
  groupNameInput.value = '';
  groupDescInput.value = '';
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
    friendsListEl.innerHTML = `<li class="sub-empty-state" style="padding: 20px 10px; width: 100%;">No members added yet</li>`;
    return;
  }

  group.friends.forEach((friend, idx) => {
    const isMe = state.username && friend.name.toLowerCase() === state.username.toLowerCase();
    
    // Status text and active dot
    let statusText = '';
    let isOnline = false;
    
    if (isMe) {
      statusText = 'Admin';
      isOnline = true;
    } else {
      // Mock status
      const hashVal = Math.abs(hashString(friend.name));
      isOnline = hashVal % 2 === 0;
      statusText = isOnline ? 'Active now' : `Last seen ${(hashVal % 10) + 1}h ago`;
    }

    const li = document.createElement('li');

    if (editingFriendId === friend.id) {
      // Inline edit mode template
      li.className = 'friend-edit-card';
      li.style.width = '100%';
      li.innerHTML = `
        <form class="friend-edit-form" id="form-edit-friend-inline" style="width: 100%;">
          <input type="text" id="edit-friend-name-input" value="${escapeHTML(friend.name)}" required max="30" style="padding: 6px 10px; font-size: 0.8rem;">
          <button type="submit" class="btn-icon-minimal" title="Save">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </button>
          <button type="button" id="btn-cancel-edit-friend" class="btn-icon-minimal" title="Cancel">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--color-danger)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </form>
      `;
      friendsListEl.appendChild(li);

      // Event binding
      const editForm = li.querySelector('#form-edit-friend-inline');
      const editInput = li.querySelector('#edit-friend-name-input');
      const cancelBtn = li.querySelector('#btn-cancel-edit-friend');

      if (editInput) {
        editInput.focus();
        editInput.select();
      }

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          editingFriendId = null;
          render();
        });
      }

      if (editForm) {
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
      }

    } else {
      // View Card Mode
      li.className = 'member-item-new';
      
      const avatarGradientIdx = Math.abs(hashString(friend.name)) % 6;
      const displayName = isMe ? 'You' : friend.name;

      li.innerHTML = `
        <div class="member-info-new">
          <div class="avatar-wrapper-new">
            <div class="avatar friend-avatar-${avatarGradientIdx}">${escapeHTML(displayName.charAt(0).toUpperCase())}</div>
            <div class="status-dot-new ${isOnline ? 'active' : ''}"></div>
          </div>
          <div class="member-meta-new">
            <span class="member-name-new">${escapeHTML(displayName)}</span>
            <span class="member-status-new">${escapeHTML(statusText)}</span>
          </div>
        </div>
        <div class="friend-actions">
          <button class="btn-icon-minimal btn-edit-friend-trigger" data-id="${friend.id}" title="Edit Name">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn-icon-minimal btn-delete-friend-trigger danger" data-id="${friend.id}" title="Remove Friend">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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
    const badgeText = `${g.friends.length}👤`;

    li.innerHTML = `
      <button class="group-item ${isActive ? 'active' : ''}" data-id="${g.id}">
        <span class="group-name-text">${escapeHTML(g.name)}</span>
        <span class="badge">${badgeText}</span>
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
    return;
  }

  document.getElementById('expenses-empty-state').style.display = 'none';

  // Render expenses descending by date/creation order so new items are on top
  const sortedExpenses = [...group.expenses].reverse();

  sortedExpenses.forEach(exp => {
    const payerFriend = group.friends.find(f => f.id === exp.paidBy);
    const payerName = payerFriend ? (state.username && payerFriend.name.toLowerCase() === state.username.toLowerCase() ? 'You' : payerFriend.name) : 'Unknown';
    const splitCount = exp.participants ? exp.participants.length : 0;
    
    const catClass = getExpenseCategoryClass(exp.description);
    const svgIcon = getCategorySVG(catClass);
    
    // Format Date
    let displayDate = exp.date;
    if (exp.date) {
      try {
        const parts = exp.date.split('-');
        if (parts.length === 3) {
          const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
          displayDate = dObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        }
      } catch (err) {}
    }

    const li = document.createElement('li');
    li.className = 'expense-item';
    li.innerHTML = `
      <div class="expense-left-side">
        <div class="expense-category-icon-wrapper ${catClass}">
          ${svgIcon}
        </div>
        <div class="expense-info-block">
          <h4>${escapeHTML(exp.description || 'Expense')}</h4>
          <span>Paid by ${escapeHTML(payerName)}</span>
        </div>
      </div>
      <div class="expense-right-side">
        <div class="expense-financial-block">
          <span class="price">${formatMoney(exp.amount, group)}</span>
          <span class="date">${escapeHTML(displayDate)}</span>
        </div>
        <div class="friend-actions">
          <button class="btn-icon-minimal btn-edit-expense-trigger" data-id="${exp.id}" title="Edit Expense">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn-icon-minimal btn-delete-expense-trigger danger" data-id="${exp.id}" title="Delete Expense">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
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
  const customSettlementsContainer = document.getElementById('settlements-container');
  const balancesEmptyState = document.getElementById('balances-empty-state');
  
  if (!customSettlementsContainer) return;
  customSettlementsContainer.innerHTML = '';

  if (!group || group.friends.length === 0 || settlements.length === 0) {
    if (balancesEmptyState) balancesEmptyState.style.display = 'block';
    return;
  }

  if (balancesEmptyState) balancesEmptyState.style.display = 'none';

  settlements.forEach(settle => {
    const li = document.createElement('div');
    
    // Check if the logged-in user is involved in this settlement
    const isFromMe = state.username && settle.from.toLowerCase() === state.username.toLowerCase();
    const isToMe = state.username && settle.to.toLowerCase() === state.username.toLowerCase();
    
    const displayFrom = isFromMe ? 'You' : settle.from;
    const displayTo = isToMe ? 'You' : settle.to;
    
    let balanceClass = 'neutral';
    let isOwedByMe = false;
    let isOwedToMe = false;
    
    if (isFromMe) {
      balanceClass = 'negative';
      isOwedByMe = true;
    } else if (isToMe) {
      balanceClass = 'positive';
      isOwedToMe = true;
    }

    let svgArrow = '';
    if (isOwedByMe) {
      svgArrow = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
    } else if (isOwedToMe) {
      svgArrow = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;
    } else {
      svgArrow = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    }

    li.className = `balance-item-custom ${balanceClass}`;
    li.innerHTML = `
      <div class="arrow-badge">
        ${svgArrow}
      </div>
      <div class="balance-details-custom">
        <span>${escapeHTML(displayFrom)} owes ${escapeHTML(displayTo)}</span>
        <strong class="${balanceClass}">${formatMoney(settle.amount, group)}</strong>
      </div>
    `;
    customSettlementsContainer.appendChild(li);
  });
}

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
  
  const activeSubtitleEl = document.getElementById('active-group-subtitle');
  if (activeSubtitleEl) {
    activeSubtitleEl.textContent = activeGroup.description || 'Shared rent, utility bills and groceries';
  }

  // Process data calculations
  const analysis = processGroupFinancials(activeGroup);

  // Update total spent
  metricTotalSpentEl.textContent = formatMoney(analysis.totalSpent, activeGroup);

  // Calculate user share and net balance
  let myFriendId = null;
  if (state.username && activeGroup.friends.length > 0) {
    const me = activeGroup.friends.find(f => f.name.toLowerCase() === state.username.toLowerCase() || f.name.toLowerCase() === 'you' || f.name.toLowerCase() === 'me');
    if (me) myFriendId = me.id;
  }

  let yourShare = 0;
  let netBalance = 0;
  if (myFriendId && analysis.personBreakdown[myFriendId]) {
    yourShare = analysis.personBreakdown[myFriendId].totalShare;
    netBalance = analysis.personBreakdown[myFriendId].netBalance;
  }

  const yourShareEl = document.getElementById('metric-your-share');
  if (yourShareEl) {
    yourShareEl.textContent = formatMoney(yourShare, activeGroup);
  }

  const netLabelEl = document.getElementById('metric-net-label');
  const netBalanceEl = document.getElementById('metric-net-balance');
  if (netBalanceEl && netLabelEl) {
    netBalanceEl.classList.remove('green-text', 'red-text');
    if (netBalance > 0.009) {
      netLabelEl.textContent = 'YOU ARE OWED';
      netBalanceEl.textContent = formatMoney(netBalance, activeGroup);
      netBalanceEl.classList.add('green-text');
    } else if (netBalance < -0.009) {
      netLabelEl.textContent = 'YOU OWE';
      netBalanceEl.textContent = formatMoney(Math.abs(netBalance), activeGroup);
      netBalanceEl.classList.add('red-text');
    } else {
      netLabelEl.textContent = 'YOU ARE OWED';
      netBalanceEl.textContent = formatMoney(0, activeGroup);
    }
  }

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
    // Editing existing group name & currency & description
    const group = state.groups.find(g => g.id === id);
    if (group) {
      group.name = name;
      group.description = groupDescInput.value.trim();
      group.currency = currency;
    }
  } else {
    // Create new group
    const newGroup = {
      id: generateId(),
      name: name,
      description: groupDescInput.value.trim(),
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
  groupDescInput.value = activeGroup.description || '';
  document.getElementById('group-currency-select').value = activeGroup.currency || 'LKR';

  openModal(modalGroup);
});

btnDeleteGroup.addEventListener('click', () => {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;

  requestConfirmation(`Are you sure you want to delete the group "${activeGroup.name}"? This will delete all its friends and expense records.`, () => {
    const idToDelete = activeGroup.id;
    state.groups = state.groups.filter(g => g.id !== activeGroup.id);

    // Switch to first remaining group or empty state
    state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;

    saveState(idToDelete);
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
  formAddFriend.style.display = 'none';

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

  if (expenseDescInput) {
    expenseDescInput.placeholder = 'e.g. Dinner, Uber, Groceries, Hotel';
  }

  // Clear Payer selector & share grid
  expensePayerSelect.innerHTML = '';
  expenseShareCheckboxes.innerHTML = '';
  expenseShareError.style.display = 'none';

  // Default option for unassigned payer (budget item)
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- Not paid yet (Budget item) --';
  expensePayerSelect.appendChild(defaultOpt);

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
      expensePayerSelect.value = exp.paidBy || '';

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
    expensePayerSelect.value = '';
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
  const paidBy = expensePayerSelect.value ? expensePayerSelect.value : null;

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

// Helper to share text summary and download image to WhatsApp
function fallbackWhatsAppShare(settlements, activeGroup, blob) {
  // 1. Download the image so the user has it ready
  const safeGroupName = activeGroup.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dataUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${safeGroupName}_settlements.png`;
  link.href = dataUrl;
  link.click();
  URL.revokeObjectURL(dataUrl);

  // 2. Prepare text message
  let text = `*Splitify Settlements for "${activeGroup.name}"*\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n\n`;
  if (settlements.length === 0) {
    text += `✨ All balances settled! No transfers needed.`;
  } else {
    settlements.forEach(settle => {
      const amountStr = formatMoney(settle.amount, activeGroup);
      text += `• *${settle.from}*  👉  *${settle.to}*:  _${amountStr}_\n`;
    });
  }
  text += `\n_Image settlements saved to your downloads._`;

  // 3. Open WhatsApp link
  const encodedText = encodeURIComponent(text);
  const waUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
  window.open(waUrl, '_blank');
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
      } else if (format === 'whatsapp') {
        canvas.toBlob(blob => {
          if (!blob) {
            alert('Failed to generate settlements image.');
            return;
          }
          const file = new File([blob], `${safeGroupName}_settlements.png`, { type: 'image/png' });
          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
              files: [file],
              title: `${activeGroup.name} Settlements`,
              text: 'Check out our settlements!'
            }).catch(err => {
              console.error('Web Share failed:', err);
              fallbackWhatsAppShare(settlements, activeGroup, blob);
            });
          } else {
            fallbackWhatsAppShare(settlements, activeGroup, blob);
          }
        }, 'image/png');
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

if (btnSettleUp) {
  btnSettleUp.addEventListener('click', () => {
    renderSettleUpModal();
    openModal(modalSettleUp);
  });
}

if (btnWhatsappShareModal) {
  btnWhatsappShareModal.addEventListener('click', () => {
    shareGroupSettlementsWhatsApp();
  });
}

if (btnExportImageModalEl) {
  btnExportImageModalEl.addEventListener('click', () => {
    exportSettlements('image');
  });
}

if (btnAddFriendTrigger) {
  btnAddFriendTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = formAddFriend.style.display === 'none' || !formAddFriend.style.display;
    formAddFriend.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      document.getElementById('friend-name-input').focus();
    }
  });
}

function shareGroupSettlementsWhatsApp() {
  const group = getActiveGroup();
  if (!group) return;
  const analysis = processGroupFinancials(group);
  const settlements = analysis.settlements;

  let text = `*Splitify Settlements for "${group.name}"*\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n\n`;
  if (settlements.length === 0) {
    text += `✨ All balances settled! No transfers needed.`;
  } else {
    settlements.forEach(settle => {
      const amountStr = formatMoney(settle.amount, group);
      text += `• *${settle.from}*  👉  *${settle.to}*:  _${amountStr}_\n`;
    });
  }

  const encodedText = encodeURIComponent(text);
  const waUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
  window.open(waUrl, '_blank');
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

// ==========================================================================
// Authentication & Sync Flow Controller
// ==========================================================================

const authContainerEl = document.getElementById('auth-container');
const appContainerEl = document.getElementById('app-container');
const userProfileNameEl = document.getElementById('user-profile-name');
const btnLogoutEl = document.getElementById('btn-logout');

const tabLoginBtn = document.getElementById('tab-login');
const tabSignupBtn = document.getElementById('tab-signup');
const formLoginEl = document.getElementById('form-login');
const formSignupEl = document.getElementById('form-signup');

const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const signupUsernameInput = document.getElementById('signup-username');
const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');

const loginErrorEl = document.getElementById('login-error');
const signupErrorEl = document.getElementById('signup-error');

// Verify current session
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        // Authenticated view
        authContainerEl.style.display = 'none';
        appContainerEl.style.display = 'flex';
        userProfileNameEl.textContent = data.username;
        state.username = data.username;
        
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl && data.username) {
          avatarEl.textContent = data.username.charAt(0).toUpperCase();
        }

        // Load groups from server and render
        await loadState();
        render();
        return;
      }
    }
  } catch (err) {
    console.error('Session check failed:', err);
  }

  // Unauthenticated view
  appContainerEl.style.display = 'none';
  authContainerEl.style.display = 'flex';
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) avatarEl.textContent = 'G';
}

// Upload existing localStorage data to user account (Migration Helper)
async function migrateLocalStorageData() {
  const localData = localStorage.getItem(STORAGE_KEY);
  if (!localData) return;

  try {
    const parsed = JSON.parse(localData);
    if (parsed && Array.isArray(parsed.groups) && parsed.groups.length > 0) {
      console.log('Migrating guest groups to MongoDB...');
      for (const group of parsed.groups) {
        await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(group)
        });
      }
      // Clear local storage data so it doesn't double migrate
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }
}

// Bind auth UI events
function initAuth() {
  // Tab Switching
  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabSignupBtn.classList.remove('active');
    formLoginEl.classList.add('active');
    formSignupEl.classList.remove('active');
    loginErrorEl.style.display = 'none';
  });

  tabSignupBtn.addEventListener('click', () => {
    tabSignupBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    formSignupEl.classList.add('active');
    formLoginEl.classList.remove('active');
    signupErrorEl.style.display = 'none';
  });

  // Login Form Submission
  formLoginEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorEl.style.display = 'none';

    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Successful login
        loginEmailInput.value = '';
        loginPasswordInput.value = '';
        await checkAuth();
      } else {
        loginErrorEl.textContent = data.error || 'Invalid credentials';
        loginErrorEl.style.display = 'block';
      }
    } catch (err) {
      console.error('Login submit error:', err);
      loginErrorEl.textContent = 'Server connection failed';
      loginErrorEl.style.display = 'block';
    }
  });

  // Signup Form Submission
  formSignupEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupErrorEl.style.display = 'none';

    const username = signupUsernameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Successful registration, check if guest data exists to migrate
        signupUsernameInput.value = '';
        signupEmailInput.value = '';
        signupPasswordInput.value = '';
        
        await migrateLocalStorageData();
        await checkAuth();
      } else {
        signupErrorEl.textContent = data.error || 'Failed to create account';
        signupErrorEl.style.display = 'block';
      }
    } catch (err) {
      console.error('Signup submit error:', err);
      signupErrorEl.textContent = 'Server connection failed';
      signupErrorEl.style.display = 'block';
    }
  });

  // Logout Click
  btnLogoutEl.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        state = { groups: [], activeGroupId: null };
        localStorage.removeItem(STORAGE_KEY);
        await checkAuth();
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  });

  // Toggle Logout Dropdown
  const userAvatar = document.getElementById('user-avatar');
  const logoutDropdown = document.getElementById('logout-dropdown');

  if (userAvatar && logoutDropdown) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      logoutDropdown.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      logoutDropdown.classList.remove('show');
    });
  }

  // Perform initial session validation
  checkAuth();
}

// Theme Controller
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeTextLabel = document.getElementById('theme-text-label');
  if (themeTextLabel) {
    themeTextLabel.textContent = theme === 'light' ? 'Light' : 'Dark';
  }
}

function initTheme() {
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const savedTheme = localStorage.getItem('splitify_theme') || 'dark';
  applyTheme(savedTheme);

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
      localStorage.setItem('splitify_theme', newTheme);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
});
