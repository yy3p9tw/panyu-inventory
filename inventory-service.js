// 庫存資料存取層：讀寫 Firestore 的 stock collection。
// 一筆文件 = 一個品項在一個倉庫的庫存現況（品號 + 倉庫 唯一決定一筆）。

import { db } from './firebase-config.js?v=33';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  getDocs,
  query,
  where,
  increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const stockCol = collection(db, 'stock');

// Firestore 文件 ID 不能包含「/」，品號理論上不該有但保險起見還是處理掉
function sanitizeIdPart(s) {
  return (s || '').toString().replace(/\//g, '-');
}

function stockDocId(itemCode, warehouse) {
  return `${sanitizeIdPart(itemCode)}__${warehouse}`;
}

// 後台之前每個 collection 都用即時監聽(onSnapshot)，但單一帳號自己開著頁面，手機/筆電
// 背景重連一樣會整個collection重讀一次，一樣會把Firestore免費讀取額度衝爆（跟前台2026-10-16
// 那次是同一個機制，不是只有前台有這個問題）。改成讀一次就好，見下面的 fetchCollectionOnce，
// 搭配 app.js 的 loadScopedData()：登入時、角色改變時、自己寫入資料後、或偵測到 meta/lastUpdate
// 變了（可能是別的分頁/裝置寫入的）才重讀一次，不再保持長連線。
// 寄庫(consignment)的ERP原始數量是0的品項，畫面上本來就會被過濾掉不顯示（見app.js的
// renderConsignmentTable聯集邏輯——這種品項如果進出紀錄裡有紀錄，會從consignmentLedger補一筆
// 回來；完全沒紀錄的話，本來就是「這個客戶這個品項目前沒有寄庫中的貨」，不顯示是對的），
// 所以乾脆用where查詢直接不讀，不用整份拉下來自己再篩掉。
export async function fetchCollectionOnce(name) {
  const col = collection(db, name);
  const q = name === 'consignment' ? query(col, where('qty', '!=', 0)) : col;
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 匯入用：整批覆蓋「這次匯入的倉庫」資料。
// records: [{ itemCode, itemName, warehouse, qty }]
// 批號是在畫面上跟 batchList collection 即時對出來的，不在匯入這步驟處理
// （庫存.xlsx 跟批號.xlsx 現在是分開匯入的兩個檔案，匯入當下沒辦法互相對照）。
// lockedQty/expired/remark/isSplit 這些欄位目前 ERP 原始匯出檔沒有對應資料，先留著欄位、預設空值，
// 之後如果拿到鎖庫/參照這些資料來源再回頭補上。
// 同一個倉庫舊資料會被完全取代（品項下架/歸零時，舊的庫存文件也要跟著消失，不能只靠覆蓋殘留）。
export async function replaceStockForWarehouses(records, warehouses) {
  // 1. 先刪掉這些倉庫目前在 Firestore 裡的所有舊資料——用where查詢只拿這幾個倉庫的文件，
  // 不要把整個stock collection(含廠務的資料)都讀出來，省掉不相干倉庫那份讀取量
  const existingSnap = await getDocs(query(stockCol, where('warehouse', 'in', warehouses)));
  const toDelete = existingSnap.docs;

  const chunks = [];
  const all = [...toDelete];
  while (all.length) chunks.push(all.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. 寫入新資料
  const recordChunks = [];
  const remaining = [...records];
  while (remaining.length) recordChunks.push(remaining.splice(0, 450));
  for (const chunk of recordChunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'stock', stockDocId(r.itemCode, r.warehouse));
      batch.set(ref, {
        itemCode: r.itemCode,
        itemName: r.itemName,
        warehouse: r.warehouse,
        warehouseLocation: r.warehouseLocation || '',
        qty: r.qty || 0,
        nearestExpiry: r.nearestExpiry || null,
        note: r.note || '',
        lockedQty: r.lockedQty || 0,
        qtyBeforeLock: r.qtyBeforeLock ?? null,
        expired: r.expired || '',
        remark: r.remark || '',
        hiddenFromTaishanManager: !!r.hiddenFromTaishanManager,
        isSplit: !!r.isSplit,
        batches: r.batches || [],
        updatedAt: Date.now()
      });
    });
    await batch.commit();
  }

  return { deleted: toDelete.length, written: records.length };
}

export async function updateStockNote(itemCode, warehouse, note) {
  const ref = doc(db, 'stock', stockDocId(itemCode, warehouse));
  await setDoc(ref, { note }, { merge: true });
}

// ---------- 共用：整批覆蓋一個 collection（可用 whereField+whereValues 只覆蓋其中一部分） ----------

// whereField/whereValues 不給的話就是整個 collection 全部覆蓋；有給的話只刪掉 whereField 的值
// 在 whereValues 裡的那部分（例如未核完調整分好幾個來源檔案各自匯入，不能匯入銷貨就把異動的
// 資料也洗掉）。用 Firestore 的 where查詢直接篩，不要整個collection全部讀出來自己篩——
// 不然像未核完調整這種6種來源分開匯入的，每匯一種就把整個collection重讀一次，很浪費。
async function replaceWholeCollection(collectionName, docs, whereField, whereValues) {
  const col = collection(db, collectionName);
  const existingSnap = whereField
    ? await getDocs(query(col, where(whereField, 'in', whereValues)))
    : await getDocs(col);

  const toDeleteSource = existingSnap.docs;
  const deletedCount = toDeleteSource.length;
  const deleteChunks = [];
  const toDelete = [...toDeleteSource];
  while (toDelete.length) deleteChunks.push(toDelete.splice(0, 450));
  for (const chunk of deleteChunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  const writeChunks = [];
  const remaining = [...docs];
  while (remaining.length) writeChunks.push(remaining.splice(0, 450));
  for (const chunk of writeChunks) {
    const batch = writeBatch(db);
    chunk.forEach(({ id, data }) => batch.set(doc(db, collectionName, id), data));
    await batch.commit();
  }

  return { deleted: deletedCount, written: docs.length };
}

// records: [{ itemCode, itemName, qty }] — 批號、最短效期是在畫面上跟 batchList（廠務）即時對出來的，不存在這裡
export async function replaceFactoryMaterial(records) {
  const docs = records.map(r => ({
    id: sanitizeIdPart(r.itemCode),
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('factoryMaterial', docs);
}

// ---------- 品項參照主檔（品名/產地/單位/採購/類別/大類/淨重/毛重/公司別/標記/散裝/註記）：
// ERP 沒有這份資料，是人工維護的品項主檔，逐欄位編輯；也可以從組合檔的「參照(新)」分頁批次匯入當初始值 ----------

// 表格裡單一欄位編輯，改一欄存一欄，不影響其他欄位
export async function setItemReferenceField(itemCode, field, value) {
  const ref = doc(db, 'itemReference', sanitizeIdPart(itemCode));
  await setDoc(ref, { itemCode, [field]: value, updatedAt: Date.now() }, { merge: true });
}

// 組合檔「參照(新)」分頁可以整批匯入當初始值：只 set/merge，不刪除，
// 這樣才不會把使用者之後手動改過的其他品項資料洗掉（跟其他 collection 的整批覆蓋不一樣）。
// records: [{ itemCode, itemName, origin, unit, purchaseType, category, majorCategory,
//             netWeight, grossWeight, companyType, tag, isSplit, note }]
export async function importItemReferenceFromMaster(records) {
  const chunks = [];
  const remaining = [...records];
  while (remaining.length) chunks.push(remaining.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'itemReference', sanitizeIdPart(r.itemCode));
      batch.set(ref, { ...r, updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();
  }
  return { written: records.length };
}

// 每天匯入庫存.xlsx時，遇到參照裡還沒有的新品號（例如最近新進的品項）自動補一筆最基本的紀錄
// （只有品號/品名），讓它會出現在「參照」分頁讓使用者手動填分類欄位——呼叫端只傳「參照裡真的
// 還沒有」的品項，merge寫入不會動到任何已存在的欄位。
export async function addItemReferenceStubs(items) {
  if (!items.length) return { written: 0 };
  const chunks = [];
  const remaining = [...items];
  while (remaining.length) chunks.push(remaining.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(({ itemCode, itemName }) => {
      const ref = doc(db, 'itemReference', sanitizeIdPart(itemCode));
      batch.set(ref, { itemCode, itemName: itemName || '', updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();
  }
  return { written: items.length };
}

// ---------- 批號：每次匯入完全覆蓋 ----------

// records: [{ itemCode, itemName, warehouse, batchNo, qty }]
export async function replaceBatchList(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${r.warehouse}__${sanitizeIdPart(r.batchNo) || 'nobatch'}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      warehouse: r.warehouse,
      batchNo: r.batchNo || '',
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('batchList', docs);
}

// 泰山/台中庫存、廠務用料、批號都是每天從ERP重新拉的資料，開始新的一天、要匯入新檔案之前，
// 可以先一鍵清空，不用等匯入才刪掉舊資料。可用原料(泰山)不用另外清，它是從泰山庫存即時算出來的，
// 泰山清空它自然就跟著空了。
export async function clearDailyErpData() {
  const [stock, factoryMaterial, batchList, pendingAdjustments] = await Promise.all([
    replaceWholeCollection('stock', []),
    replaceWholeCollection('factoryMaterial', []),
    replaceWholeCollection('batchList', []),
    replaceWholeCollection('pendingAdjustments', [])
  ]);
  return {
    stock: stock.deleted,
    factoryMaterial: factoryMaterial.deleted,
    batchList: batchList.deleted,
    pendingAdjustments: pendingAdjustments.deleted
  };
}

// ---------- 寄庫：每次匯入完全覆蓋 ----------

// records: [{ itemCode, itemName, customer, qty }]
export async function replaceConsignment(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${sanitizeIdPart(r.customer)}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      customer: r.customer,
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('consignment', docs);
}

// ---------- 寄庫的倉庫分配：ERP的寄庫數量是客戶+品項的總數，沒有泰山/台中的細分。
// 對照過0805庫存YU的「寄庫」分頁，真實的做法是逐日記錄進出（一欄一天，正數=當天寄入、負數=當天出庫），
// 目前數量是全部加總、寄庫日期是最近一筆的日期——這裡改成資料庫版本：每筆進出各自一筆帶日期的紀錄，
// 不是一欄一天，畫面上即時加總算出目前數量跟最近日期。同一個客戶+品項+倉庫可以有很多筆，逐筆新增/刪除。

// ---------- 寄庫餘額（consignmentBalance）：每個客戶+品項一筆，記錄目前加總數量 ----------
// 寄庫數量本來是每次顯示都把這個客戶+品項「從有紀錄以來的所有進出紀錄」整個讀出來加總算出來的，
// consignmentLedger只會越存越多、從不清空，久了這個加總動作變得很花讀取量。改成另外存一份
// 已經算好的餘額，平常顯示只讀這份小很多的餘額表；新增/刪除一筆進出紀錄時用Firestore的increment()
// 把變動量加/減到餘額上，不用重新整個重算。只有使用者點進某個客戶品項看明細時，才會另外查
// 那一筆的完整進出紀錄（見app.js的loadConsignLedgerDetail，只查那一筆，不是整個collection）。
function consignmentBalanceDocId(customer, itemCode) {
  return `${sanitizeIdPart(customer)}__${sanitizeIdPart(itemCode)}`;
}

async function applyConsignmentBalanceDelta(customer, itemCode, itemName, warehouse, deltaQty) {
  if (!deltaQty) return;
  const ref = doc(db, 'consignmentBalance', consignmentBalanceDocId(customer, itemCode));
  const updates = {
    customer, itemCode, itemName: itemName || '',
    total: increment(deltaQty),
    updatedAt: Date.now()
  };
  if (warehouse === '泰山') updates.taishanTotal = increment(deltaQty);
  else if (warehouse === '台中') updates.taichungTotal = increment(deltaQty);
  await setDoc(ref, updates, { merge: true });
}

// 從頭把consignmentBalance整個重算一次（讀一次完整的consignmentLedger）。只在兩種情況呼叫：
// 1. 匯入整批歷史進出紀錄之後（因為整個collection可能被換掉，不能只用增量更新）
// 2. 後台手動按「重建寄庫餘額」（第一次導入這個功能時的初始化，或懷疑餘額跟實際兜不起來時的保險）
export async function rebuildConsignmentBalance() {
  const ledgerSnap = await getDocs(collection(db, 'consignmentLedger'));
  const balances = new Map();
  ledgerSnap.docs.forEach(d => {
    const data = d.data();
    const key = consignmentBalanceDocId(data.customer, data.itemCode);
    if (!balances.has(key)) {
      balances.set(key, { customer: data.customer, itemCode: data.itemCode, itemName: data.itemName || '', total: 0, taishanTotal: 0, taichungTotal: 0 });
    }
    const b = balances.get(key);
    const qty = Number(data.deltaQty) || 0;
    b.total += qty;
    if (data.warehouse === '泰山') b.taishanTotal += qty;
    else if (data.warehouse === '台中') b.taichungTotal += qty;
    if (data.itemName && !b.itemName) b.itemName = data.itemName;
  });

  const oldBalanceSnap = await getDocs(collection(db, 'consignmentBalance'));
  const deleteChunks = [];
  const toDelete = [...oldBalanceSnap.docs];
  while (toDelete.length) deleteChunks.push(toDelete.splice(0, 450));
  for (const chunk of deleteChunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  const entries = [...balances.entries()];
  const writeChunks = [];
  while (entries.length) writeChunks.push(entries.splice(0, 450));
  for (const chunk of writeChunks) {
    const batch = writeBatch(db);
    chunk.forEach(([key, b]) => {
      batch.set(doc(db, 'consignmentBalance', key), { ...b, updatedAt: Date.now() });
    });
    await batch.commit();
  }

  return { balances: balances.size, ledgerEntries: ledgerSnap.docs.length };
}

// entry: { customer, itemCode, itemName, warehouse, date('YYYY-MM-DD'), deltaQty(正=寄入/負=出庫), remark }
export async function addConsignmentLedgerEntry(entry) {
  await addDoc(collection(db, 'consignmentLedger'), { ...entry, updatedAt: Date.now() });
  await applyConsignmentBalanceDelta(entry.customer, entry.itemCode, entry.itemName, entry.warehouse, entry.deltaQty);
}

export async function deleteConsignmentLedgerEntry(id) {
  const ref = doc(db, 'consignmentLedger', id);
  const snap = await getDoc(ref);
  await deleteDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    await applyConsignmentBalanceDelta(data.customer, data.itemCode, data.itemName, data.warehouse, -(Number(data.deltaQty) || 0));
  }
}

// 查某個客戶+品項+倉庫的完整進出紀錄明細——只在使用者點開明細面板時才呼叫，只查這一筆，
// 不是整個consignmentLedger collection
export async function fetchConsignmentLedgerEntries(customer, itemCode, warehouse) {
  const snap = await getDocs(query(
    collection(db, 'consignmentLedger'),
    where('customer', '==', customer),
    where('itemCode', '==', itemCode),
    where('warehouse', '==', warehouse)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 從組合檔「寄庫」分頁批次匯入歷史進出紀錄（該分頁一欄一天，這裡已經在 app.js 解析成一筆一筆帶日期的紀錄）。
// 用「客戶+品號+倉庫+日期」當文件ID（不是隨機ID）：同一天在原始表格裡本來就只有一個數字，
// 用日期當ID可以讓同一份檔案重複匯入時是覆蓋、不是產生重複資料。跟畫面上手動新增的單筆紀錄
// （用隨機ID，允許同一天有好幾筆）是不同的ID規則，兩種紀錄會共存在同一個 collection 裡。
function consignmentLedgerImportDocId(customer, itemCode, warehouse, date) {
  return `${sanitizeIdPart(customer)}__${sanitizeIdPart(itemCode)}__${warehouse}__${date}`;
}

// 整個 consignmentLedger collection 清空再寫入（不是只覆蓋這次檔案裡有的客戶+品項）——
// 使用者確認過要這樣做：如果試算表裡刪掉/改掉了某一列，重新匯入才會真的反映出來，
// 不然舊的merge寫法只會一直疊加，刪掉的列永遠不會消失。連手動在進出明細面板新增的紀錄
// 也會被這個動作一起清掉，呼叫端要在按下確認前講清楚這個風險。
export async function importConsignmentLedgerEntries(records) {
  const docs = records.map(r => ({
    id: consignmentLedgerImportDocId(r.customer, r.itemCode, r.warehouse, r.date),
    data: { ...r, updatedAt: Date.now() }
  }));
  const result = await replaceWholeCollection('consignmentLedger', docs);
  // 整個collection被取代了，餘額不能只用增量更新，要整個重算一次
  await rebuildConsignmentBalance();
  return result;
}

// ---------- 未核完調整（銷貨/銷退/進貨/退貨/組合/異動/調撥）：每次匯入完全覆蓋 ----------
// 泰山/台中庫存數字只反映「已核完」的單據，這裡存的是還沒核完、需要另外加減回庫存數字的部分。

// records: [{ itemCode, itemName, warehouse, deltaQty, source }]
// sources：這次匯入來源涵蓋哪幾種（例如匯入「銷貨」時傳 ['銷貨']），只會覆蓋這些來源舊資料，
// 不會動到其他來源檔案（異動/轉撥/...）之前匯入的部分——因為現在每種都是分開的檔案各自匯入。
// itemName：如果這筆調整是全新品項（庫存.xlsx還沒出現過），泰山/台中/廠務用料/可用原料要能
// 顯示一個沒有base資料的品項時，就得靠這裡存的品名，不能只有品號。
export async function replacePendingAdjustments(records, sources) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${r.warehouse}__${sanitizeIdPart(r.source)}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName || '',
      warehouse: r.warehouse,
      deltaQty: r.deltaQty || 0,
      source: r.source || '',
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('pendingAdjustments', docs, 'source', sources);
}

// ---------- 彙總（會計角色用）：每次匯入完全覆蓋 ----------

// records: [{ itemCode, itemName, taishanQty, taichungQty, totalQty, unitWeight, totalWeight,
//             purchaseType, category, majorCategory, origin, vendors: [{ label, qty, weight }] }]
export async function replaceSummary(records) {
  const docs = records.map(r => ({
    id: sanitizeIdPart(r.itemCode),
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      taishanQty: r.taishanQty || 0,
      taichungQty: r.taichungQty || 0,
      totalQty: r.totalQty || 0,
      unitWeight: r.unitWeight || 0,
      totalWeight: r.totalWeight || 0,
      purchaseType: r.purchaseType || '',
      category: r.category || '',
      majorCategory: r.majorCategory || '',
      origin: r.origin || '',
      vendors: r.vendors || [],
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('summary', docs);
}

// ---------- 鎖庫：ERP 沒有這份資料，是老闆口頭決定要鎖起來的品項，人工維護 ----------
// 同一個品項可以同時有好幾筆鎖庫紀錄（例如同一品項一部分鎖給不同客戶/廠務），
// 所以不是「品號+倉庫」對一筆，而是每筆自己一個文件（用 Firestore 自動 ID），
// 可以隨時新增/編輯/刪除單一筆，不是整批匯入覆蓋。

// record: { itemCode, itemName, warehouse, tag, lockedQty, remark }
// warehouse：泰山或台中，決定這筆鎖庫算在哪個倉庫的庫存標籤上
// tag：對應組合檔「鎖庫」分頁的「庫別名稱」細分——客戶名字、"廠務鎖庫"，或留空代表就是倉庫本身的貨
export async function addLockedStock(record) {
  await addDoc(collection(db, 'lockedStock'), { ...record, updatedAt: Date.now() });
}

export async function updateLockedStock(id, record) {
  await setDoc(doc(db, 'lockedStock', id), { ...record, updatedAt: Date.now() }, { merge: true });
}

export async function deleteLockedStock(id) {
  await deleteDoc(doc(db, 'lockedStock', id));
}

// ---------- 每日快照：手動存檔「今天最終版本」，之後可以按日期回頭查 ----------
// 每天匯入的資料（庫存/批號/寄庫/廠務用料/未核完調整）都是整批覆蓋，舊的一天過去就消失了。
// 使用者要留存「當天最終結果」的歷史記錄，用「今天完成」按鈕手動存檔（不是每次匯入自動存，
// 因為當天可能匯入好幾次還沒定案）。一個日期一種資料類型各自一份文件，避免單一文件塞太多資料。

// 寄庫進出紀錄(consignmentLedger)不放進快照——它本身就是一筆一筆帶日期、永久累積的紀錄，
// 從來不會被整批覆蓋，不需要另外每天複製一份，不然天數×筆數會越滾越大，白白佔空間。
// 要查某天的寄庫進出，直接查 consignmentLedger 本身（照日期篩選）就有，不需要透過這裡的快照。
const SNAPSHOT_TYPES = ['stock', 'batchList', 'consignment', 'factoryMaterial', 'pendingAdjustments', 'lockedStock'];

function snapshotDocId(date, type) {
  return `${date}__${type}`;
}

// date: 'YYYY-MM-DD'；data: { stock, batchList, consignment, factoryMaterial, pendingAdjustments, lockedStock }（畫面上目前訂閱到的即時資料）
export async function saveDailySnapshot(date, data) {
  const batch = writeBatch(db);
  SNAPSHOT_TYPES.forEach(type => {
    const ref = doc(db, 'dailySnapshots', snapshotDocId(date, type));
    batch.set(ref, { date, type, records: data[type] || [], savedAt: Date.now() });
  });
  await batch.commit();
}

// 回傳 { stock, batchList, consignment, factoryMaterial, pendingAdjustments }，
// 某個類型那天沒存過快照就是 null（跟「有存但是空陣列」分開，畫面上可以分辨兩種情況）
export async function loadDailySnapshot(date) {
  const result = {};
  for (const type of SNAPSHOT_TYPES) {
    const snap = await getDoc(doc(db, 'dailySnapshots', snapshotDocId(date, type)));
    result[type] = snap.exists() ? (snap.data().records || []) : null;
  }
  return result;
}

// 這個專案沒有後端排程，沒辦法真的「每天自動」跑清理——跟著使用者實際會做的「今天完成」動作
// 順便清掉超過保留期限的舊快照，是最務實的觸發時機。cutoffDate 是 'YYYY-MM-DD'，
// 早於這個日期的快照全部刪掉。Firestore 單一批次最多500筆，超過就分批刪。
export async function deleteOldSnapshots(cutoffDate) {
  const q = query(collection(db, 'dailySnapshots'), where('date', '<', cutoffDate));
  const snap = await getDocs(q);
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 500) {
    const batch = writeBatch(db);
    refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return { deleted: refs.length };
}

// ---------- 盤點：一次實體盤點產生一個 session，底下每個品項各一筆 stocktakeItems 文件 ----------
// 盤點表要帶去倉庫手寫，盤完才回來打進系統，所以品項清單是「產生盤點表」當下就鎖定快照（連同系統數量），
// 不是即時跟著庫存變動——不然盤點期間如果又匯入新的一天資料，表單對不上，使用者會搞混。

// items: [{ itemCode, itemName, customer(寄庫品項才有，一般庫存是''), systemQty }]
// 系統數量在產生當下就鎖定存起來，盤點數量(countedQty)留null等使用者之後填，備註(remark)是差異原因
export async function createStocktakeSession(warehouse, items) {
  const sessionRef = doc(collection(db, 'stocktakeSessions'));
  await setDoc(sessionRef, { warehouse, itemCount: items.length, createdAt: Date.now() });
  const chunks = [];
  const remaining = [...items];
  while (remaining.length) chunks.push(remaining.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(it => {
      const ref = doc(collection(db, 'stocktakeItems'));
      batch.set(ref, {
        sessionId: sessionRef.id,
        itemCode: it.itemCode,
        itemName: it.itemName || '',
        customer: it.customer || '',
        systemQty: it.systemQty || 0,
        countedQty: null,
        remark: '',
        updatedAt: Date.now()
      });
    });
    await batch.commit();
  }
  return { sessionId: sessionRef.id };
}

export async function updateStocktakeItem(itemDocId, fields) {
  const ref = doc(db, 'stocktakeItems', itemDocId);
  await setDoc(ref, { ...fields, updatedAt: Date.now() }, { merge: true });
}

// 刪除整個盤點session（連同底下所有品項），盤錯一次重來用
export async function deleteStocktakeSession(sessionId) {
  await deleteDoc(doc(db, 'stocktakeSessions', sessionId));
  const snap = await getDocs(query(collection(db, 'stocktakeItems'), where('sessionId', '==', sessionId)));
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 500) {
    const batch = writeBatch(db);
    refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return { deleted: refs.length };
}

// 前台頁面只有一個文件在監聽（見 front-common.js 的 subscribeLastUpdate），用來知道「後台資料
// 有更新」要自動重新整理，不用整個collection開著即時監聽（那樣背景重連很花讀取量，見2026-10-16的
// 額度超標事件）。
// 重要：只在「整批」動作呼叫這個（匯入ERP檔、新增/刪除一整筆鎖庫/寄庫紀錄、建立/刪除整份盤點），
// 不要在逐欄位編輯（鎖庫/參照/盤點數量這種一次改很多欄位的場景）呼叫——每呼叫一次，所有開著
// 前台/後台頁面的裝置都會整批重讀一次，逐欄位編輯等於每改一欄就觸發全體連鎖重讀，2026-10-19
// 曾經因為這樣一天衝到49萬次讀取，比修之前的即時監聽還糟。
export async function touchLastUpdate(ts = Date.now()) {
  await setDoc(doc(db, 'meta', 'lastUpdate'), { updatedAt: ts });
  return ts;
}

// 後台自己寫入資料時會直接重新載入（見 app.js 的 loadScopedData），這個監聽是給「同一個帳號
// 同時開好幾個分頁/裝置」這種情況用的保險——別的分頁寫入後，這裡偵測到時間變了就跟著重讀一次。
// 只監聽這一份文件（成本1筆），不是整個collection。
export function subscribeToLastUpdate(onChange) {
  let first = true;
  return onSnapshot(
    doc(db, 'meta', 'lastUpdate'),
    snap => {
      if (first) { first = false; return; }
      onChange(snap.exists() ? snap.data().updatedAt : null);
    },
    err => console.error('讀取更新時間失敗', err)
  );
}
