// 庫存管理系統：登入後才能使用，登入、匯入、查詢都在同一頁。
// 畫面上的分頁跟資料欄位，依登入者的角色顯示不同內容。
import { auth } from './firebase-config.js?v=1';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { subscribeToStock, replaceStockForWarehouses } from './inventory-service.js?v=1';
import { touchOwnProfile, subscribeToOwnProfile, subscribeToUsers, updateUserRoles } from './users-service.js?v=1';
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const loginBox = document.getElementById('loginBox');
const appContent = document.getElementById('appContent');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const userNav = document.getElementById('userNav');
const currentUserEmail = document.getElementById('currentUserEmail');
const logoutBtn = document.getElementById('logoutBtn');

const searchInput = document.getElementById('searchInput');
const stockTableHead = document.getElementById('stockTableHead');
const stockTableBody = document.getElementById('stockTableBody');
const stockSummary = document.getElementById('stockSummary');

const importDropZone = document.getElementById('importDropZone');
const importFileInput = document.getElementById('importFileInput');
const importMsg = document.getElementById('importMsg');

const usersTableBody = document.getElementById('usersTableBody');

const WAREHOUSES = ['泰山', '台中'];
const ROLES = ['泰山倉管', '台中倉管', '廠務', '會計', '管理員'];

// 每個角色能看到哪些倉庫的庫存欄位（品項查詢/匯入都依這個判斷）
const WAREHOUSE_VISIBILITY = {
  '泰山倉管': ['泰山', '台中'],
  '台中倉管': ['台中'],
  '管理員': ['泰山', '台中']
};

let currentUid = null;
let currentRoles = [];
let visibleWarehouses = [];
let isAdmin = false;

let currentStock = [];
let currentUsers = [];
let unsubscribeStock = null;
let unsubscribeOwnProfile = null;
let unsubscribeUsers = null;

// ---------- 登入 ----------

loginBtn.addEventListener('click', async () => {
  loginError.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
  } catch (err) {
    loginError.textContent = '登入失敗：' + describeAuthError(err);
  }
});

[emailInput, passwordInput].forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
  });
});

logoutBtn.addEventListener('click', () => signOut(auth));

function describeAuthError(err) {
  const map = {
    'auth/invalid-email': 'Email 格式不正確',
    'auth/invalid-credential': '帳號或密碼錯誤',
    'auth/wrong-password': '密碼錯誤',
    'auth/user-not-found': '找不到這個帳號',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試'
  };
  return map[err.code] || err.message;
}

onAuthStateChanged(auth, async user => {
  // 換帳號（不一定會先登出，例如上一個帳號的登入還留在瀏覽器裡）時，
  // 一定要先把舊帳號的訂閱全部關掉，不然畫面會殘留舊帳號的角色權限。
  if (unsubscribeOwnProfile) { unsubscribeOwnProfile(); unsubscribeOwnProfile = null; }
  if (unsubscribeStock) { unsubscribeStock(); unsubscribeStock = null; }
  if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  currentRoles = [];
  currentStock = [];
  currentUsers = [];
  applyRoleVisibility(); // 立刻把畫面收回「沒有任何角色」狀態，避免短暫殘留上一個帳號看到的東西

  if (user) {
    currentUid = user.uid;
    loginBox.style.display = 'none';
    appContent.style.display = 'block';
    userNav.style.display = 'flex';
    currentUserEmail.textContent = user.email;

    await touchOwnProfile(user.uid, user.email);

    unsubscribeOwnProfile = subscribeToOwnProfile(user.uid, profile => {
      currentRoles = profile.roles || [];
      applyRoleVisibility();
    });

    unsubscribeStock = subscribeToStock(
      stock => {
        currentStock = stock;
        renderStockTable();
      },
      err => {
        stockSummary.style.color = 'var(--color-danger)';
        stockSummary.textContent = '讀取庫存資料失敗：' + err.message;
      }
    );
  } else {
    currentUid = null;
    loginBox.style.display = 'block';
    appContent.style.display = 'none';
    userNav.style.display = 'none';
  }
});

// ---------- 角色可視範圍 ----------

function applyRoleVisibility() {
  const whSet = new Set();
  currentRoles.forEach(r => (WAREHOUSE_VISIBILITY[r] || []).forEach(w => whSet.add(w)));
  visibleWarehouses = WAREHOUSES.filter(w => whSet.has(w));
  isAdmin = currentRoles.includes('管理員');

  const searchBtn = document.querySelector('.tab-btn[data-tab="search"]');
  const importBtn = document.querySelector('.tab-btn[data-tab="import"]');
  const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');

  const canSeeStock = visibleWarehouses.length > 0;
  searchBtn.style.display = canSeeStock ? '' : 'none';
  importBtn.style.display = canSeeStock ? '' : 'none';
  usersBtn.style.display = isAdmin ? '' : 'none';

  // 如果目前開著的分頁被隱藏了，自動切到第一個看得到的分頁
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn && activeBtn.style.display === 'none') {
    const firstVisible = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.style.display !== 'none');
    if (firstVisible) firstVisible.click();
  }

  renderStockTableHead();
  renderStockTable();

  if (isAdmin && !unsubscribeUsers) {
    unsubscribeUsers = subscribeToUsers(users => {
      currentUsers = users;
      renderUsersTable();
    });
  } else if (!isAdmin && unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }
}

// ---------- 分頁切換 ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.style.display === 'none') return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).style.display = '';
  });
});

// ---------- 品項查詢 ----------

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatExpiry(raw) {
  if (!raw) return '-';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

function renderStockTableHead() {
  stockTableHead.innerHTML = `
    <tr>
      <th>品號</th>
      <th>品名</th>
      ${visibleWarehouses.map(w => `<th>${w}庫存</th><th>${w}最短效期</th>`).join('')}
    </tr>
  `;
}

function renderStockTable() {
  if (visibleWarehouses.length === 0) return;
  const keyword = searchInput.value.trim().toLowerCase();

  // 依品號分組，把有權限看到的倉庫庫存併成同一列
  const byItem = new Map();
  currentStock.forEach(s => {
    if (!visibleWarehouses.includes(s.warehouse)) return;
    if (!byItem.has(s.itemCode)) {
      byItem.set(s.itemCode, { itemCode: s.itemCode, itemName: s.itemName, warehouses: {} });
    }
    byItem.get(s.itemCode).warehouses[s.warehouse] = s;
  });

  let items = Array.from(byItem.values());
  if (keyword) {
    items = items.filter(it =>
      (it.itemCode || '').toLowerCase().includes(keyword) ||
      (it.itemName || '').toLowerCase().includes(keyword)
    );
  }
  items.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));

  const colCount = 2 + visibleWarehouses.length * 2;

  stockSummary.style.color = '';
  stockSummary.textContent = byItem.size
    ? (keyword ? `共 ${byItem.size} 個品項，篩選後 ${items.length} 筆` : `共 ${byItem.size} 個品項`)
    : '目前沒有庫存資料，請先到「匯入資料」上傳 ERP 檔案';

  if (items.length === 0) {
    stockTableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#6b7280;">沒有符合的品項</td></tr>`;
    return;
  }

  stockTableBody.innerHTML = items.map(it => {
    const cells = visibleWarehouses.map(w => {
      const s = it.warehouses[w];
      return `<td>${s ? s.qty : '-'}</td><td>${s ? formatExpiry(s.nearestExpiry) : '-'}</td>`;
    }).join('');
    return `
    <tr>
      <td>${escapeHTML(it.itemCode)}</td>
      <td>${escapeHTML(it.itemName)}</td>
      ${cells}
    </tr>
  `;
  }).join('');
}

searchInput.addEventListener('input', renderStockTable);

// ---------- 使用者管理 ----------

function renderUsersTable() {
  if (!currentUsers.length) {
    usersTableBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#6b7280;">還沒有人登入過</td></tr>`;
    return;
  }
  const sorted = [...currentUsers].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  usersTableBody.innerHTML = sorted.map(u => `
    <tr>
      <td>${escapeHTML(u.email)}</td>
      <td>
        <div class="role-checkboxes">
          ${ROLES.map(role => `
            <label class="role-checkbox">
              <input type="checkbox" data-uid="${u.id}" data-role="${escapeHTML(role)}" ${((u.roles || []).includes(role)) ? 'checked' : ''} />
              ${escapeHTML(role)}
            </label>
          `).join('')}
        </div>
      </td>
    </tr>
  `).join('');

  usersTableBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const uid = cb.dataset.uid;
      const user = currentUsers.find(u => u.id === uid);
      const roles = new Set(user.roles || []);
      if (cb.checked) roles.add(cb.dataset.role);
      else roles.delete(cb.dataset.role);
      cb.disabled = true;
      try {
        await updateUserRoles(uid, Array.from(roles));
      } catch (err) {
        alert('更新角色失敗：' + err.message);
      } finally {
        cb.disabled = false;
      }
    });
  });
}

// ---------- 匯入資料 ----------

function findColumnIndex(headerRow, names) {
  for (const name of names) {
    const idx = headerRow.findIndex(h => (h || '').toString().trim() === name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseWarehouseSheet(sheet, warehouse) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = rows[0];

  const idxCode = findColumnIndex(header, ['品號']);
  const idxName = findColumnIndex(header, ['品名']);
  const idxLoc = findColumnIndex(header, ['庫別名稱']);
  const idxQty = findColumnIndex(header, ['結存數量']);
  const idxExpiry = findColumnIndex(header, ['最短效期']);
  const idxNote = findColumnIndex(header, ['備註']);

  if (idxCode === -1 || idxQty === -1) {
    throw new Error(`「${warehouse}」分頁找不到「品號」或「結存數量」欄位，格式可能跟預期不同`);
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = (row[idxCode] || '').toString().trim();
    if (!itemCode) continue;
    records.push({
      itemCode,
      itemName: idxName !== -1 ? (row[idxName] || '').toString().trim() : '',
      warehouse,
      warehouseLocation: idxLoc !== -1 ? (row[idxLoc] || '').toString().trim() : '',
      qty: idxQty !== -1 ? Number(row[idxQty]) || 0 : 0,
      nearestExpiry: idxExpiry !== -1 ? (row[idxExpiry] || '').toString().trim() : '',
      note: idxNote !== -1 ? (row[idxNote] || '').toString().trim() : ''
    });
  }
  return records;
}

async function handleImportFile(file) {
  importMsg.style.color = 'var(--color-text-muted)';
  importMsg.textContent = '讀取檔案中...';
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const allRecords = [];
    const foundWarehouses = [];
    for (const warehouse of WAREHOUSES) {
      const sheet = workbook.Sheets[warehouse];
      if (!sheet) continue;
      const records = parseWarehouseSheet(sheet, warehouse);
      allRecords.push(...records);
      foundWarehouses.push(warehouse);
    }

    if (foundWarehouses.length === 0) {
      throw new Error('這份檔案裡找不到「泰山」或「台中」分頁，確認上傳的是正確的 ERP 匯出檔');
    }

    importMsg.textContent = `解析完成，共 ${allRecords.length} 筆，正在寫入資料庫...`;
    const result = await replaceStockForWarehouses(allRecords, foundWarehouses);

    importMsg.style.color = 'var(--color-success)';
    importMsg.textContent = `匯入成功！已更新「${foundWarehouses.join('、')}」共 ${result.written} 筆庫存資料（清除舊資料 ${result.deleted} 筆）`;
  } catch (err) {
    importMsg.style.color = 'var(--color-danger)';
    importMsg.textContent = '匯入失敗：' + err.message;
  }
}

importDropZone.addEventListener('click', () => importFileInput.click());

importDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  importDropZone.classList.add('dragover');
});

importDropZone.addEventListener('dragleave', () => {
  importDropZone.classList.remove('dragover');
});

importDropZone.addEventListener('drop', e => {
  e.preventDefault();
  importDropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files[0];
  if (file) handleImportFile(file);
  importFileInput.value = '';
});
